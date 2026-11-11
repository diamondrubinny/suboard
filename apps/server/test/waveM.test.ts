import type { BoardDetail, Column } from '@suboard/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loggedIn, setup, type Client, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let m: Client; // manager, owner
let e: Client; // editor
let v: Client; // viewer
let o: Client; // outsider
let ids: Record<'m' | 'e' | 'v' | 'o', string>;
let board: BoardDetail;
const col = (type: string) => board.columns.find((c: Column) => c.type === type)!;

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

const add = async (name: string, parentId?: string, values: Record<string, unknown> = {}) =>
  (await m.post(`/api/boards/${board.id}/items`, { groupId: board.groups[0]!.id, name, values, ...(parentId ? { parentId } : {}) })).json().item as { id: string };
const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

describe('M1 personal reminders / M2 private note', () => {
  it('are private to their owner, validated, and delivered once when due', async () => {
    const item = await add('החלפת אטם');
    expect((await o.post(`/api/items/${item.id}/reminders`, { remindAt: inHours(1) })).statusCode).toBe(404);
    expect((await v.post(`/api/items/${item.id}/reminders`, { remindAt: inHours(-1) })).statusCode).toBe(400); // past
    expect((await v.post(`/api/items/${item.id}/reminders`, { remindAt: inHours(24 * 400) })).statusCode).toBe(400); // too far
    const r = (await v.post(`/api/items/${item.id}/reminders`, { remindAt: inHours(1), note: 'להתקשר לקבלן' })).json().reminder;
    await e.post(`/api/items/${item.id}/reminders`, { remindAt: inHours(2) });
    // each user sees only their own
    expect((await v.get(`/api/items/${item.id}/personal`)).json().personal.reminders.map((x: { id: string }) => x.id)).toEqual([r.id]);
    expect((await m.get(`/api/items/${item.id}/personal`)).json().personal.reminders).toEqual([]);
    expect((await e.del(`/api/reminders/${r.id}`)).statusCode).toBe(404); // not mine
    // limit per item
    for (let i = 0; i < 4; i++) await v.post(`/api/items/${item.id}/reminders`, { remindAt: inHours(3 + i) });
    expect((await v.post(`/api/items/${item.id}/reminders`, { remindAt: inHours(9) })).statusCode).toBe(400);

    // not due yet
    expect(ctx.app.services.personal.runDueReminders(new Date())).toBe(0);
    // due: the viewer's first, once
    const later = new Date(Date.now() + 90 * 60_000);
    expect(ctx.app.services.personal.runDueReminders(later)).toBe(1);
    expect(ctx.app.services.personal.runDueReminders(later)).toBe(0);
    const n = (await v.get('/api/notifications')).json().notifications as { kind: string; detail: string | null; itemId: string }[];
    expect(n.filter((x) => x.kind === 'reminder')).toEqual([expect.objectContaining({ detail: 'להתקשר לקבלן', itemId: item.id })]);
    expect((await v.get(`/api/items/${item.id}/personal`)).json().personal.reminders).toHaveLength(4); // the sent one is gone

    // a member removed from the board gets nothing
    await m.del(`/api/boards/${board.id}/members/${ids.e}`);
    expect(ctx.app.services.personal.runDueReminders(new Date(Date.now() + 3 * 3600_000))).toBe(1); // only the viewer's next one
    expect(((await e.get('/api/notifications')).json().notifications as { kind: string }[]).some((x) => x.kind === 'reminder')).toBe(false);
  });

  it('keeps a private note per user', async () => {
    const item = await add('סקר');
    expect((await o.put(`/api/items/${item.id}/note`, { body: 'x' })).statusCode).toBe(404);
    expect((await v.put(`/api/items/${item.id}/note`, { body: '  לבדוק עם דנה  ' })).json().note).toBe('לבדוק עם דנה');
    await m.put(`/api/items/${item.id}/note`, { body: 'הערה של המנהל' });
    expect((await v.get(`/api/items/${item.id}/personal`)).json().personal.note).toBe('לבדוק עם דנה');
    expect((await m.get(`/api/items/${item.id}/personal`)).json().personal.note).toBe('הערה של המנהל');
    // never in search, export or history
    expect(JSON.stringify((await m.get('/api/search?q=' + encodeURIComponent('לבדוק עם דנה'))).json())).not.toContain('לבדוק עם דנה');
    expect((await m.get(`/api/boards/${board.id}/export.csv`)).body).not.toContain('לבדוק עם דנה');
    expect(JSON.stringify((await m.get(`/api/items/${item.id}/activity`)).json())).not.toContain('לבדוק עם דנה');
    await v.put(`/api/items/${item.id}/note`, { body: '' });
    expect((await v.get(`/api/items/${item.id}/personal`)).json().personal.note).toBe('');
  });
});

describe('M3 item templates', () => {
  it('saves an item tree without people and dates, and creates it again', async () => {
    const status = col('status');
    const top = await add('הטמעת נוהל', undefined, { [status.id]: status.settings.options![1]!.id, [col('person').id]: [ids.e], [col('date').id]: '2026-12-01' });
    const sub = await add('כתיבת טיוטה', top.id);
    await add('סבב הערות', sub.id);
    await add('פרסום', top.id);

    expect((await v.post(`/api/items/${top.id}/save-as-template`, { name: 'x' })).statusCode).toBe(403);
    expect((await o.post(`/api/items/${top.id}/save-as-template`, { name: 'x' })).statusCode).toBe(404);
    const tpl = (await e.post(`/api/items/${top.id}/save-as-template`, { name: 'הטמעת נוהל חדש' })).json().template;
    expect(tpl).toMatchObject({ name: 'הטמעת נוהל חדש', size: 4, createdByName: 'editor' });
    const stored = (ctx.db.prepare('SELECT tree_json FROM item_templates').get() as { tree_json: string }).tree_json;
    expect(stored).not.toContain(ids.e);
    expect(stored).not.toContain('2026-12-01');
    expect((await v.get(`/api/boards/${board.id}/item-templates`)).json().templates).toHaveLength(1);
    expect((await o.get(`/api/boards/${board.id}/item-templates`)).statusCode).toBe(404);

    expect((await v.post(`/api/item-templates/${tpl.id}/use`, { groupId: board.groups[1]!.id })).statusCode).toBe(403);
    const made = (await m.post(`/api/item-templates/${tpl.id}/use`, { groupId: board.groups[1]!.id })).json().item;
    const items = ((await m.get(`/api/boards/${board.id}`)).json().board as BoardDetail).items;
    const root = items.find((i) => i.id === made.id)!;
    expect(root).toMatchObject({ name: 'הטמעת נוהל', groupId: board.groups[1]!.id });
    expect(root.values[status.id]).toBe(status.settings.options![1]!.id);
    expect(root.values[col('person').id]).toBeUndefined();
    const kids = items.filter((i) => i.parentId === root.id).map((i) => i.name).sort();
    expect(kids).toEqual(['כתיבת טיוטה', 'פרסום']);
    const draft = items.find((i) => i.parentId === root.id && i.name === 'כתיבת טיוטה')!;
    expect(items.filter((i) => i.parentId === draft.id).map((i) => i.name)).toEqual(['סבב הערות']);

    // a label removed after saving does not break the template
    await m.patch(`/api/columns/${status.id}`, { settings: { options: status.settings.options!.filter((_, i) => i !== 1) } });
    expect((await m.post(`/api/item-templates/${tpl.id}/use`, { groupId: board.groups[0]!.id })).statusCode).toBe(201);

    // delete: creator or owner
    expect((await v.del(`/api/item-templates/${tpl.id}`)).statusCode).toBe(403);
    expect((await m.del(`/api/item-templates/${tpl.id}`)).statusCode).toBe(200);
  });
});
