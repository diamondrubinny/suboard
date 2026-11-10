import type { BoardDetail } from '@suboard/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loggedIn, setup, type Client, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let manager: Client;
let outsider: Client;
let editor: Client;
let viewer: Client;
let ids: { manager: string; editor: string; viewer: string; outsider: string };
let board: BoardDetail;

const col = (title: string) => board.columns.find((c) => c.title === title)!;

beforeEach(async () => {
  ctx = await setup();
  const m = await loggedIn(ctx, 'manager@x.org', 'manager');
  const e = await loggedIn(ctx, 'editor@x.org', 'member');
  const v = await loggedIn(ctx, 'viewer@x.org', 'member');
  const o = await loggedIn(ctx, 'outsider@x.org', 'member');
  manager = m.client;
  editor = e.client;
  viewer = v.client;
  outsider = o.client;
  ids = { manager: m.user.id, editor: e.user.id, viewer: v.user.id, outsider: o.user.id };

  const res = await manager.post('/api/boards', { name: 'פעולות מתקנות', templateKey: 'capa' });
  expect(res.statusCode).toBe(201);
  board = res.json().board;
  await manager.put(`/api/boards/${board.id}/members`, { userId: ids.editor, role: 'editor' });
  await manager.put(`/api/boards/${board.id}/members`, { userId: ids.viewer, role: 'viewer' });
});
afterEach(async () => {
  await ctx.app.close();
  ctx.db.close();
});

async function newItem(name = 'פריט', values: Record<string, unknown> = {}) {
  const res = await manager.post(`/api/boards/${board.id}/items`, { groupId: board.groups[0]!.id, name, values });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().item as { id: string; values: Record<string, unknown> };
}

describe('board creation', () => {
  it('builds the board from the template and makes the creator owner', () => {
    expect(board.myRole).toBe('owner');
    expect(board.groups.length).toBeGreaterThan(0);
    expect(board.columns.filter((c) => c.settings.role === 'due')).toHaveLength(1);
  });

  it('regular members cannot create boards; unknown templates are rejected', async () => {
    expect((await editor.post('/api/boards', { name: 'x', templateKey: 'capa' })).statusCode).toBe(403);
    expect((await manager.post('/api/boards', { name: 'x', templateKey: 'nope' })).statusCode).toBe(400);
  });
});

describe('authorization / IDOR', () => {
  it('outsiders cannot see or touch the board or any of its resources (404, not 403)', async () => {
    const item = await newItem();
    const status = col('סטטוס');
    const checks = await Promise.all([
      outsider.get(`/api/boards/${board.id}`),
      outsider.get(`/api/boards/${board.id}/activity`),
      outsider.patch(`/api/items/${item.id}`, { name: 'hacked' }),
      outsider.del(`/api/items/${item.id}`),
      outsider.get(`/api/items/${item.id}/updates`),
      outsider.post(`/api/items/${item.id}/updates`, { body: 'x' }),
      outsider.patch(`/api/columns/${status.id}`, { title: 'x' }),
      outsider.del(`/api/groups/${board.groups[0]!.id}`),
      outsider.post(`/api/boards/${board.id}/items`, { groupId: board.groups[0]!.id, name: 'x' }),
      outsider.put(`/api/boards/${board.id}/members`, { userId: ids.outsider, role: 'owner' }),
    ]);
    for (const r of checks) expect(r.statusCode, r.body).toBe(404);
    expect((await outsider.get('/api/boards')).json().boards).toHaveLength(0);
    expect((await manager.get(`/api/boards/${board.id}`)).json().board.items[0].name).toBe('פריט');
  });

  it('viewers can read but not write', async () => {
    const item = await newItem();
    expect((await viewer.get(`/api/boards/${board.id}`)).statusCode).toBe(200);
    expect((await viewer.patch(`/api/items/${item.id}`, { name: 'x' })).statusCode).toBe(403);
    expect((await viewer.post(`/api/items/${item.id}/updates`, { body: 'x' })).statusCode).toBe(403);
  });

  it('editors manage items but not structure or members', async () => {
    const item = await newItem();
    expect((await editor.patch(`/api/items/${item.id}`, { name: 'עודכן' })).statusCode).toBe(200);
    expect((await editor.post(`/api/boards/${board.id}/columns`, { title: 'x', type: 'text' })).statusCode).toBe(403);
    expect((await editor.del(`/api/columns/${col('סטטוס').id}`)).statusCode).toBe(403);
    expect((await editor.del(`/api/groups/${board.groups[0]!.id}`)).statusCode).toBe(403);
    expect((await editor.put(`/api/boards/${board.id}/members`, { userId: ids.outsider, role: 'viewer' })).statusCode).toBe(403);
    expect((await editor.del(`/api/boards/${board.id}`)).statusCode).toBe(403);
  });

  it('rejects malformed ids before touching the database', async () => {
    expect((await manager.get('/api/boards/1%20OR%201=1')).statusCode).toBe(400);
  });

  it('cannot move an item into a group of another board', async () => {
    const other = (await manager.post('/api/boards', { name: 'אחר', templateKey: 'blank' })).json().board as BoardDetail;
    const item = await newItem();
    const res = await manager.patch(`/api/items/${item.id}`, { groupId: other.groups[0]!.id });
    expect(res.statusCode).toBe(400);
  });

  it('records denied attempts in the audit log', async () => {
    const item = await newItem();
    await viewer.patch(`/api/items/${item.id}`, { name: 'x' });
    expect(ctx.app.services.audit.list({ event: 'access_denied' })).toHaveLength(1);
  });
});

describe('cell value validation', () => {
  it('validates by column type, option existence and real users', async () => {
    const item = await newItem();
    const patch = (values: Record<string, unknown>) => manager.patch(`/api/items/${item.id}`, { values });
    expect((await patch({ [col('סטטוס').id]: 'not-an-option' })).statusCode).toBe(400);
    expect((await patch({ [col('תאריך יעד').id]: '2026-13-01' })).statusCode).toBe(400);
    expect((await patch({ [col('אחראי ביצוע').id]: ['00000000-0000-4000-8000-000000000000'] })).statusCode).toBe(400);
    expect((await patch({ '00000000-0000-4000-8000-000000000000': 'x' })).statusCode).toBe(400);

    const ok = await patch({ [col('סטטוס').id]: 'in_progress', [col('אחראי ביצוע').id]: [ids.editor, ids.editor], [col('תאריך יעד').id]: '2026-12-01' });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().item.values[col('אחראי ביצוע').id]).toEqual([ids.editor]);

    const cleared = await patch({ [col('סטטוס').id]: null });
    expect(cleared.json().item.values[col('סטטוס').id]).toBeUndefined();
  });

  it('stores markup as inert text', async () => {
    const item = await newItem('<img src=x onerror=alert(1)>');
    const res = await manager.get(`/api/boards/${board.id}`);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.json().board.items.find((i: { id: string }) => i.id === item.id).name).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('structure changes keep data consistent', () => {
  it('removing a status option clears values that used it', async () => {
    const status = col('סטטוס');
    const item = await newItem('x', { [status.id]: 'verify' });
    const options = status.settings.options!.filter((o) => o.id !== 'verify');
    expect((await manager.patch(`/api/columns/${status.id}`, { settings: { options } })).statusCode).toBe(200);
    const after = (await manager.get(`/api/boards/${board.id}`)).json().board as BoardDetail;
    expect(after.items.find((i) => i.id === item.id)!.values[status.id]).toBeUndefined();
  });

  it('deleting a column removes its values; only one due column per board', async () => {
    const created = (await manager.post(`/api/boards/${board.id}/columns`, { title: 'יעד חדש', type: 'date', settings: { role: 'due' } })).json().column;
    const after = (await manager.get(`/api/boards/${board.id}`)).json().board as BoardDetail;
    expect(after.columns.filter((c) => c.settings.role === 'due').map((c) => c.id)).toEqual([created.id]);

    const item = await newItem('x', { [created.id]: '2026-01-01' });
    expect((await manager.del(`/api/columns/${created.id}`)).statusCode).toBe(200);
    const final = (await manager.get(`/api/boards/${board.id}`)).json().board as BoardDetail;
    expect(final.items.find((i) => i.id === item.id)!.values[created.id]).toBeUndefined();
  });

  it('a board always keeps at least one owner and one group', async () => {
    expect((await manager.del(`/api/boards/${board.id}/members/${ids.manager}`)).statusCode).toBe(400);
    const groups = board.groups;
    await manager.del(`/api/groups/${groups[0]!.id}`);
    expect((await manager.del(`/api/groups/${groups[1]!.id}`)).statusCode).toBe(400);
  });
});

describe('updates and activity', () => {
  it('only the author or a board owner can delete an update', async () => {
    const item = await newItem();
    const up = (await editor.post(`/api/items/${item.id}/updates`, { body: 'בוצעה בדיקה' })).json().update;
    await manager.put(`/api/boards/${board.id}/members`, { userId: ids.viewer, role: 'editor' });
    expect((await viewer.del(`/api/updates/${up.id}`)).statusCode).toBe(403);
    expect((await manager.del(`/api/updates/${up.id}`)).statusCode).toBe(200);
  });

  it('records value changes in item history without copying long text', async () => {
    const item = await newItem();
    await manager.patch(`/api/items/${item.id}`, { values: { [col('סטטוס').id]: 'in_progress', [col('תיאור הפעולה').id]: 'פרטים' } });
    const activity = (await viewer.get(`/api/items/${item.id}/activity`)).json().activity as { action: string; detail: Record<string, unknown> }[];
    const changes = activity.filter((a) => a.action === 'item_value_changed');
    expect(changes).toHaveLength(2);
    const longText = changes.find((a) => a.detail.columnType === 'long_text')!;
    expect(longText.detail).not.toHaveProperty('to');
  });
});

describe('dashboard', () => {
  it('lists my open and overdue items only from boards I can access', async () => {
    const due = col('תאריך יעד').id;
    await newItem('באיחור', { [due]: '2020-01-01', [col('אחראי ביצוע').id]: [ids.editor], [col('סטטוס').id]: 'open' });
    await newItem('סגור', { [due]: '2020-01-01', [col('סטטוס').id]: 'done' });

    const d = (await editor.get('/api/dashboard')).json().dashboard;
    expect(d.overdue.map((i: { itemName: string }) => i.itemName)).toEqual(['באיחור']);
    expect(d.myOpenItems.map((i: { itemName: string }) => i.itemName)).toEqual(['באיחור']);
    expect(d.boards[0].overdue).toBe(1);

    const o = (await outsider.get('/api/dashboard')).json().dashboard;
    expect(o.overdue).toHaveLength(0);
    expect(o.boards).toHaveLength(0);
  });
});
