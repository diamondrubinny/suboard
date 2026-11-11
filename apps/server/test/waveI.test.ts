import type { BoardDetail, Column } from '@suboard/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loggedIn, setup, type Client, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let m: Client; // manager, board owner
let m2: Client; // another manager
let a: Client; // admin
let e: Client; // member (editor)
let ids: Record<'m' | 'm2' | 'a' | 'e', string>;
let board: BoardDetail;

beforeEach(async () => {
  ctx = await setup();
  const mm = await loggedIn(ctx, 'manager@x.org', 'manager');
  const mm2 = await loggedIn(ctx, 'manager2@x.org', 'manager');
  const aa = await loggedIn(ctx, 'admin@x.org', 'admin');
  const ee = await loggedIn(ctx, 'editor@x.org', 'member');
  [m, m2, a, e] = [mm.client, mm2.client, aa.client, ee.client];
  ids = { m: mm.user.id, m2: mm2.user.id, a: aa.user.id, e: ee.user.id };
  board = (await m.post('/api/boards', { name: 'סקרים', templateKey: 'lab_surveys' })).json().board;
  await m.put(`/api/boards/${board.id}/members`, { userId: ids.e, role: 'editor' });
});
afterEach(async () => ctx.close());

describe('I1 organisation board templates', () => {
  it('saves structure only, drops cross-board links, creates boards from it, and guards deletion', async () => {
    // wire a checklist to a corrective-action board, and add data that must not travel
    const capa = (await m.post('/api/boards', { name: 'פעולות', templateKey: 'capa' })).json().board as BoardDetail;
    const cl = board.columns.find((c: Column) => c.type === 'checklist')!;
    expect((await m.patch(`/api/columns/${cl.id}`, { settings: { checklist: { ...cl.settings.checklist!, capaBoardId: capa.id, capaGroupId: capa.groups[0]!.id } } })).statusCode).toBe(200);
    await m.post(`/api/boards/${board.id}/items`, { groupId: board.groups[0]!.id, name: 'סקר מעבדה 214' });
    await m.post(`/api/boards/${board.id}/groups`, { name: 'קבוצה נוספת' });

    // who may save
    expect((await e.post(`/api/boards/${board.id}/save-as-template`, { name: 'x' })).statusCode).toBe(403);
    expect((await m2.post(`/api/boards/${board.id}/save-as-template`, { name: 'x' })).statusCode).toBe(404); // not on the board
    const saved = await m.post(`/api/boards/${board.id}/save-as-template`, { name: 'סקר מעבדות — תבנית יחידה', description: 'מבנה בלבד' });
    expect(saved.statusCode, saved.body).toBe(201);
    const tpl = saved.json().template;
    expect(tpl).toMatchObject({ baseKey: 'lab_surveys', groupCount: board.groups.length + 1, columnCount: board.columns.length, createdByName: 'manager' });

    // visible to managers/admins only
    expect((await m2.get('/api/templates')).json().custom.map((t: { id: string }) => t.id)).toEqual([tpl.id]);
    expect((await e.get('/api/templates')).json().custom).toEqual([]);
    const stored = ctx.db.prepare('SELECT groups_json, columns_json FROM board_templates').get() as { groups_json: string; columns_json: string };
    expect(stored.columns_json).not.toContain(capa.id);
    expect(stored.groups_json + stored.columns_json).not.toContain('סקר מעבדה 214');

    // another manager creates a board from it
    const res = await m2.post('/api/boards', { name: 'סקרים — פקולטה ב', customTemplateId: tpl.id });
    expect(res.statusCode, res.body).toBe(201);
    const nb = res.json().board as BoardDetail;
    expect(nb.templateKey).toBe('lab_surveys');
    expect(nb.items).toHaveLength(0);
    expect(nb.members.map((x) => x.userId)).toEqual([ids.m2]);
    expect(nb.groups.map((g) => g.name)).toEqual([...board.groups.map((g) => g.name), 'קבוצה נוספת']);
    expect(nb.columns.map((c) => [c.title, c.type])).toEqual(board.columns.map((c: Column) => [c.title, c.type]));
    const ncl = nb.columns.find((c) => c.type === 'checklist')!;
    expect(ncl.settings.checklist?.items).toEqual(cl.settings.checklist!.items);
    expect(ncl.settings.checklist?.capaBoardId ?? null).toBeNull();

    // members cannot create from it; unknown template id is a validation error
    expect((await e.post('/api/boards', { name: 'x', customTemplateId: tpl.id })).statusCode).toBe(403);
    expect((await m.post('/api/boards', { name: 'x', customTemplateId: '00000000-0000-4000-8000-000000000000' })).statusCode).toBe(400);

    // deletion: creator or admin
    expect((await m2.del(`/api/templates/custom/${tpl.id}`)).statusCode).toBe(403);
    expect((await e.del(`/api/templates/custom/${tpl.id}`)).statusCode).toBe(404);
    expect((await a.del(`/api/templates/custom/${tpl.id}`)).statusCode).toBe(200);
    expect((await m.get('/api/templates')).json().custom).toEqual([]);
    expect(ctx.app.services.audit.list({ event: 'template_created' })).toHaveLength(1);
    expect(ctx.app.services.audit.list({ event: 'template_deleted' })).toHaveLength(1);
  });
});

describe('I3 computed columns: created by / last updated', () => {
  it('are read-only, computed from the item, sortable in exports', async () => {
    const add = (title: string, type: string) => m.post(`/api/boards/${board.id}/columns`, { title, type });
    const by = (await add('נוצר ע"י', 'created_by')).json().column as Column;
    const upd = (await add('עודכן לאחרונה', 'updated_at')).json().column as Column;
    const item = (await e.post(`/api/boards/${board.id}/items`, { groupId: board.groups[0]!.id, name: 'סקר' })).json().item;
    expect((await m.patch(`/api/items/${item.id}`, { values: { [by.id]: 'x' } })).statusCode).toBe(400);
    expect((await m.patch(`/api/items/${item.id}`, { values: { [upd.id]: '2026-01-01' } })).statusCode).toBe(400);
    expect((await m.post(`/api/boards/${board.id}/items`, { groupId: board.groups[0]!.id, name: 'y', values: { [by.id]: ids.m } })).statusCode).toBe(400);
    const csv = (await m.get(`/api/boards/${board.id}/export.csv`)).body;
    const header = csv.split('\n')[0]!;
    expect(header).toContain('"נוצר ע""י"'); // CSV-escaped quote
    const row = csv.split('\n')[1]!; // the only item
    expect(row).toContain('editor');
    expect(row).toMatch(/\d{2}[./]\d{2}[./]\d{4}/);
    // automations may not target them
    const rule = await m.post(`/api/boards/${board.id}/automations`, {
      name: 'x',
      trigger: { type: 'item_created' },
      conditions: [],
      actions: [{ type: 'clear', columnId: by.id }],
    });
    expect(rule.statusCode).toBe(400);
  });
});

describe('I2 column widths in saved views', () => {
  it('accepts widths within bounds and rejects others', async () => {
    const col = board.columns[0]!.id;
    const ok = await m.post(`/api/boards/${board.id}/views`, { name: 'רחב', config: { view: 'table', widths: { name: 320, [col]: 200 } } });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json().view.config.widths).toEqual({ name: 320, [col]: 200 });
    expect((await m.post(`/api/boards/${board.id}/views`, { name: 'x', config: { view: 'table', widths: { name: 20 } } })).statusCode).toBe(400);
    expect((await m.post(`/api/boards/${board.id}/views`, { name: 'x', config: { view: 'table', widths: { '<script>': 200 } } })).statusCode).toBe(400);
  });
});
