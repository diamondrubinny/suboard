import type { BoardDetail } from '@suboard/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loggedIn, setup, type Client, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let m: Client;
let e: Client;
let v: Client;
let o: Client;
let ids: Record<'m' | 'e' | 'v' | 'o', string>;
let board: BoardDetail;
const col = (t: string, b: BoardDetail = board) => b.columns.find((c) => c.title === t)!;
const refresh = async () => (board = (await m.get(`/api/boards/${board.id}`)).json().board);

beforeEach(async () => {
  ctx = await setup();
  const mm = await loggedIn(ctx, 'manager@x.org', 'manager');
  const ee = await loggedIn(ctx, 'editor@x.org', 'member');
  const vv = await loggedIn(ctx, 'viewer@x.org', 'member');
  const oo = await loggedIn(ctx, 'outsider@x.org', 'member');
  [m, e, v, o] = [mm.client, ee.client, vv.client, oo.client];
  ids = { m: mm.user.id, e: ee.user.id, v: vv.user.id, o: oo.user.id };
  board = (await m.post('/api/boards', { name: 'פעולות מתקנות', templateKey: 'capa' })).json().board;
  await m.put(`/api/boards/${board.id}/members`, { userId: ids.e, role: 'editor' });
  await m.put(`/api/boards/${board.id}/members`, { userId: ids.v, role: 'viewer' });
});
afterEach(async () => ctx.close());

const newItem = async (name: string, extra: Record<string, unknown> = {}, client = m) => {
  const r = await client.post(`/api/boards/${board.id}/items`, { groupId: board.groups[0]!.id, name, ...extra });
  expect(r.statusCode, r.body).toBe(201);
  return r.json().item as { id: string; seq: number; parentId: string | null; groupId: string; values: Record<string, unknown> };
};

describe('A1 new column types', () => {
  it('adds typed columns and validates their values server-side', async () => {
    const add = (title: string, type: string, settings?: unknown) => m.post(`/api/boards/${board.id}/columns`, { title, type, settings });
    expect((await add('מזהה', 'auto_id', { prefix: 'CAPA' })).statusCode).toBe(201);
    expect((await add('תגיות', 'tags', { options: [{ id: 'fire', label: 'אש', color: 'red' }, { id: 'chem', label: 'כימיה', color: 'purple' }] })).statusCode).toBe(201);
    for (const [t, ty] of [['טווח', 'date_range'], ['התקדמות', 'progress'], ['דירוג', 'rating'], ['קישור', 'link'], ['מייל', 'email'], ['טלפון', 'phone']]) {
      expect((await add(t!, ty!)).statusCode).toBe(201);
    }
    expect((await add('בעייתי', 'text', { prefix: 'X' })).statusCode).toBe(400);
    await refresh();
    const it = await newItem('בדיקה');
    const patch = (values: Record<string, unknown>) => m.patch(`/api/items/${it.id}`, { values });

    expect((await patch({ [col('קישור').id]: 'javascript:alert(1)' })).statusCode).toBe(400);
    expect((await patch({ [col('תגיות').id]: ['nope'] })).statusCode).toBe(400);
    expect((await patch({ [col('מזהה').id]: 'CAPA-9999' })).statusCode).toBe(400);
    expect((await patch({ [col('טווח').id]: { from: '2026-02-01', to: '2026-01-01' } })).statusCode).toBe(400);
    const ok = await patch({
      [col('קישור').id]: 'https://example.org/sds.pdf',
      [col('תגיות').id]: ['fire', 'fire', 'chem'],
      [col('התקדמות').id]: 40,
      [col('דירוג').id]: 4,
      [col('מייל').id]: 'A@B.org',
      [col('טלפון').id]: '04-829-0000',
      [col('טווח').id]: { from: '2026-01-01', to: '2026-01-31' },
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const vals = ok.json().item.values;
    expect(vals[col('תגיות').id]).toEqual(['fire', 'chem']);
    expect(vals[col('מייל').id]).toBe('a@b.org');

    // Removing a tag option strips it from every item.
    const tags = col('תגיות');
    await m.patch(`/api/columns/${tags.id}`, { settings: { options: tags.settings.options!.filter((x) => x.id !== 'fire') } });
    await refresh();
    expect(board.items.find((i) => i.id === it.id)!.values[tags.id]).toEqual(['chem']);
  });

  it('gives every item a stable running number per board', async () => {
    const a = await newItem('א');
    const b = await newItem('ב');
    expect(b.seq).toBe(a.seq + 1);
    await m.del(`/api/items/${a.id}`);
    const c = await newItem('ג');
    expect(c.seq).toBe(b.seq + 1); // numbers are never reused
  });
});

describe('A2 sub-items', () => {
  it('creates sub-items that follow their parent', async () => {
    const parent = await newItem('תחקיר');
    const child = await newItem('ראיון עדים', { parentId: parent.id }, e);
    expect(child.parentId).toBe(parent.id);
    // Wave J: two levels are allowed, a third is not.
    const grand = await m.post(`/api/boards/${board.id}/items`, { groupId: board.groups[0]!.id, name: 'נכד', parentId: child.id });
    expect(grand.statusCode).toBe(201);
    expect((await m.post(`/api/boards/${board.id}/items`, { groupId: board.groups[0]!.id, name: 'נין', parentId: grand.json().item.id })).statusCode).toBe(400);
    await m.del(`/api/items/${grand.json().item.id}`);
    expect((await v.post(`/api/boards/${board.id}/items`, { groupId: board.groups[0]!.id, name: 'x', parentId: parent.id })).statusCode).toBe(403);

    await m.patch(`/api/items/${parent.id}`, { groupId: board.groups[1]!.id });
    await refresh();
    expect(board.items.find((i) => i.id === child.id)!.groupId).toBe(board.groups[1]!.id);
    expect((await m.patch(`/api/items/${child.id}`, { groupId: board.groups[0]!.id })).statusCode).toBe(400);
  });

  it('cannot attach a sub-item to an item of another board', async () => {
    const other = (await m.post('/api/boards', { name: 'אחר', templateKey: 'blank' })).json().board as BoardDetail;
    const foreign = (await m.post(`/api/boards/${other.id}/items`, { groupId: other.groups[0]!.id, name: 'זר' })).json().item;
    const r = await m.post(`/api/boards/${board.id}/items`, { groupId: board.groups[0]!.id, name: 'x', parentId: foreign.id });
    expect(r.statusCode).toBe(400);
  });
});

describe('A7 trash', () => {
  it('soft-deletes with sub-items, hides everywhere, and restores together', async () => {
    const parent = await newItem('פריט', { values: { [col('תאריך יעד').id]: '2020-01-01', [col('אחראי ביצוע').id]: [ids.e] } });
    const child = await newItem('תת', { parentId: parent.id });
    await m.post(`/api/items/${parent.id}/updates`, { body: 'עדכון' });

    expect((await e.del(`/api/items/${parent.id}`)).statusCode).toBe(200);
    await refresh();
    expect(board.items.map((i) => i.id)).not.toContain(child.id);
    expect((await m.get(`/api/items/${parent.id}/updates`)).statusCode).toBe(404);
    expect((await m.patch(`/api/items/${child.id}`, { name: 'x' })).statusCode).toBe(404);
    expect((await e.get('/api/dashboard')).json().dashboard.overdue).toHaveLength(0);
    expect((await m.get('/api/search?q=פריט')).json().hits).toHaveLength(0);

    const trash = (await e.get(`/api/boards/${board.id}/trash`)).json().items;
    expect(trash.map((t: { id: string }) => t.id)).toEqual([parent.id]); // the sub-item travels with its parent
    expect((await v.get(`/api/boards/${board.id}/trash`)).statusCode).toBe(403);
    expect((await o.post(`/api/items/${parent.id}/restore`)).statusCode).toBe(404);

    expect((await e.post(`/api/items/${parent.id}/restore`)).statusCode).toBe(200);
    await refresh();
    expect(board.items.map((i) => i.id)).toEqual(expect.arrayContaining([parent.id, child.id]));
  });

  it('purges only items older than the retention period', async () => {
    const a = await newItem('ישן');
    await m.del(`/api/items/${a.id}`);
    expect(ctx.app.services.items.purgeTrash()).toBe(0);
    ctx.db.prepare("UPDATE items SET deleted_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(a.id);
    expect(ctx.app.services.items.purgeTrash()).toBe(1);
  });
});

describe('A6 duplicate and move', () => {
  it('duplicates an item with its sub-items and a new running number', async () => {
    const p = await newItem('מקור', { values: { [col('סטטוס').id]: 'open' } });
    await newItem('תת', { parentId: p.id });
    const r = await e.post(`/api/items/${p.id}/duplicate`);
    expect(r.statusCode).toBe(201);
    const copy = r.json().item;
    expect(copy.name).toBe('מקור (עותק)');
    expect(copy.seq).toBeGreaterThan(p.seq);
    expect(copy.values[col('סטטוס').id]).toBe('open');
    await refresh();
    expect(board.items.filter((i) => i.parentId === copy.id)).toHaveLength(1);
  });

  it('moves to another board, mapping columns by title/type and reporting what was dropped', async () => {
    const target = (await m.post('/api/boards', { name: 'יעד', templateKey: 'blank' })).json().board as BoardDetail;
    const p = await newItem('להעביר', {
      values: { [col('סטטוס').id]: 'done', [col('תאריך יעד').id]: '2026-12-01', [col('עדיפות').id]: 'high', [col('אחראי ביצוע').id]: [ids.e] },
    });
    await newItem('תת', { parentId: p.id });

    // editor of the source but not of the target → hidden target board
    expect((await e.post(`/api/items/${p.id}/move`, { boardId: target.id, groupId: target.groups[0]!.id })).statusCode).toBe(404);

    const r = await m.post(`/api/items/${p.id}/move`, { boardId: target.id, groupId: target.groups[0]!.id });
    expect(r.statusCode, r.body).toBe(200);
    const { item, dropped } = r.json();
    expect(item.boardId).toBe(target.id);
    const t = (await m.get(`/api/boards/${target.id}`)).json().board as BoardDetail;
    expect(item.values[col('סטטוס', t).id]).toBe('done'); // "הושלם" label exists in both
    expect(item.values[col('תאריך יעד', t).id]).toBe('2026-12-01');
    expect(dropped).toEqual(expect.arrayContaining(['עדיפות', 'אחראי ביצוע'])); // no such column / not a member
    expect(t.items.filter((i) => i.parentId === p.id)).toHaveLength(1);
    await refresh();
    expect(board.items.find((i) => i.id === p.id)).toBeUndefined();
  });
});

describe('A5 bulk actions', () => {
  it('applies one validated change to many items, all-or-nothing on foreign ids', async () => {
    const a = await newItem('א');
    const b = await newItem('ב');
    const status = col('סטטוס').id;
    const ok = await e.post(`/api/boards/${board.id}/items/bulk`, { action: 'set_value', itemIds: [a.id, b.id], columnId: status, value: 'in_progress' });
    expect(ok.json().affected).toBe(2);
    expect((await e.post(`/api/boards/${board.id}/items/bulk`, { action: 'set_value', itemIds: [a.id], columnId: status, value: 'bogus' })).statusCode).toBe(400);

    const other = (await m.post('/api/boards', { name: 'אחר', templateKey: 'blank' })).json().board as BoardDetail;
    const foreign = (await m.post(`/api/boards/${other.id}/items`, { groupId: other.groups[0]!.id, name: 'זר' })).json().item;
    const mixed = await m.post(`/api/boards/${board.id}/items/bulk`, { action: 'delete', itemIds: [a.id, foreign.id] });
    expect(mixed.statusCode).toBe(404);
    await refresh();
    expect(board.items.map((i) => i.id)).toContain(a.id); // nothing deleted

    expect((await v.post(`/api/boards/${board.id}/items/bulk`, { action: 'delete', itemIds: [a.id] })).statusCode).toBe(403);
    await e.post(`/api/boards/${board.id}/items/bulk`, { action: 'move_group', itemIds: [a.id, b.id], groupId: board.groups[1]!.id });
    await e.post(`/api/boards/${board.id}/items/bulk`, { action: 'delete', itemIds: [a.id, b.id] });
    await refresh();
    expect(board.items).toHaveLength(0);
  });
});

describe('A11 import', () => {
  it('creates valid rows and reports invalid ones by row number', async () => {
    const r = await e.post(`/api/boards/${board.id}/import`, {
      groupId: board.groups[0]!.id,
      rows: [
        { name: 'שורה טובה', values: { [col('סטטוס').id]: 'open', [col('תאריך יעד').id]: '2026-12-31' } },
        { name: 'סטטוס שגוי', values: { [col('סטטוס').id]: 'nope' } },
        { name: 'שורה טובה 2' },
      ],
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toEqual({ created: 2, errors: [{ row: 2, message: expect.stringContaining('סטטוס') }] });
    expect((await v.post(`/api/boards/${board.id}/import`, { groupId: board.groups[0]!.id, rows: [{ name: 'x' }] })).statusCode).toBe(403);
    expect((await e.post(`/api/boards/${board.id}/import`, { groupId: board.groups[0]!.id, rows: Array.from({ length: 1001 }, () => ({ name: 'x' })) })).statusCode).toBe(400);
  });

  it('exports xlsx (a real zip container) to viewers only', async () => {
    await newItem('=SUM(A1)');
    const r = await v.get(`/api/boards/${board.id}/export.xlsx`);
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('spreadsheetml');
    expect(r.rawPayload.subarray(0, 2).toString()).toBe('PK');
    expect((await o.get(`/api/boards/${board.id}/export.xlsx`)).statusCode).toBe(404);
  });
});

describe('A3 saved views', () => {
  it('keeps personal views private; only owners share; others cannot touch them', async () => {
    const config = { view: 'kanban', sort: { by: col('תאריך יעד').id, dir: 'asc' }, hidden: [col('מקור').id, '00000000-0000-4000-8000-000000000000'] };
    const mine = (await e.post(`/api/boards/${board.id}/views`, { name: 'שלי', config })).json().view;
    expect(mine.config.hidden).toEqual([col('מקור').id]); // unknown column ids dropped
    expect((await e.post(`/api/boards/${board.id}/views`, { name: 'משותף', config, shared: true })).statusCode).toBe(403);
    const shared = (await m.post(`/api/boards/${board.id}/views`, { name: 'לצוות', config, shared: true })).json().view;

    const seenByViewer = (await v.get(`/api/boards/${board.id}/views`)).json().views.map((x: { id: string }) => x.id);
    expect(seenByViewer).toEqual([shared.id]);
    expect((await v.patch(`/api/views/${mine.id}`, { name: 'x' })).statusCode).toBe(404);
    expect((await v.del(`/api/views/${shared.id}`)).statusCode).toBe(404);
    expect((await o.get(`/api/boards/${board.id}/views`)).statusCode).toBe(404);
    expect((await e.del(`/api/views/${mine.id}`)).statusCode).toBe(200);
  });
});

describe('A8 global search', () => {
  it('finds names, text values and updates only in accessible boards', async () => {
    const a = await newItem('מטף לא תקין בלובי');
    await newItem('אחר', { values: { [col('תיאור הפעולה').id]: 'להחליף מטף בקומה 2' } });
    await m.post(`/api/items/${a.id}/updates`, { body: 'המטף הוחלף' });
    const hits = (await v.get(`/api/search?q=${encodeURIComponent('מטף')}`)).json().hits as { kind: string; itemName: string }[];
    expect(hits.map((h) => h.kind)).toEqual(expect.arrayContaining(['item', 'update']));
    expect(hits.length).toBe(3);
    expect((await o.get(`/api/search?q=${encodeURIComponent('מטף')}`)).json().hits).toHaveLength(0);
    // LIKE wildcards are literal characters, not patterns
    expect((await v.get(`/api/search?q=${encodeURIComponent('%%')}`)).json().hits).toHaveLength(0);
    expect((await v.get('/api/search?q=a')).statusCode).toBe(400);
  });
});

describe('A10 mentions', () => {
  it('notifies mentioned board members only', async () => {
    const it = await newItem('פריט');
    const r = await m.post(`/api/items/${it.id}/updates`, { body: '@editor תבדוק', mentions: [ids.e, ids.m] });
    expect(r.statusCode).toBe(201);
    const n = (await e.get('/api/notifications')).json().notifications;
    expect(n[0]).toMatchObject({ kind: 'mentioned', itemId: it.id });
    expect((await m.get('/api/notifications')).json().unread).toBe(0); // no self-mention
    expect((await m.post(`/api/items/${it.id}/updates`, { body: 'x', mentions: [ids.o] })).statusCode).toBe(400);
  });
});
