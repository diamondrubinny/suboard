import type { BoardDetail } from '@suboard/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { Client, createUser, loggedIn, setup, type TestCtx } from './helpers.js';

let ctx: TestCtx;
afterEach(async () => ctx?.close());

const mkBoard = async (c: Client, name: string) => (await c.post('/api/boards', { name, templateKey: 'blank' })).json().board as BoardDetail;
const col = async (c: Client, b: BoardDetail, title: string, type: string, settings?: unknown) =>
  (await c.post(`/api/boards/${b.id}/columns`, { title, type, ...(settings ? { settings } : {}) }));
const item = async (c: Client, b: BoardDetail, name: string, values: Record<string, unknown> = {}) =>
  (await c.post(`/api/boards/${b.id}/items`, { groupId: b.groups[0]!.id, name, values })).json().item as { id: string };
const get = async (c: Client, id: string) => (await c.get(`/api/boards/${id}`)).json().board as BoardDetail;

describe('wave Q — connect-boards and mirror columns', () => {
  it('connects items of another board through a column and mirrors a value from them', async () => {
    ctx = await setup();
    const { client: c } = await loggedIn(ctx, 'boss@x.org', 'manager');
    const equipment = await mkBoard(c, 'ציוד');
    const faults = await mkBoard(c, 'תקלות');
    const mail = (await col(c, equipment, 'מייל תחזוקה', 'email')).json().column;
    const room = (await col(c, equipment, 'חדר', 'text')).json().column;
    const hood = await item(c, equipment, 'מנדף 3', { [mail.id]: 'tech@x.org', [room.id]: '214' });
    const panel = await item(c, equipment, 'פאנל גז 7', { [mail.id]: 'gas@x.org' });
    const fault = await item(c, faults, 'דליפה');

    // settings are validated
    expect((await col(c, faults, 'ציוד', 'relation')).statusCode).toBe(400);
    expect((await col(c, faults, 'ציוד', 'relation', { relation: { boardId: '00000000-0000-4000-8000-000000000000' } })).statusCode).toBe(400);
    expect((await col(c, faults, 'טקסט', 'text', { relation: { boardId: equipment.id } })).statusCode).toBe(400);
    const rel = (await col(c, faults, 'ציוד', 'relation', { relation: { boardId: equipment.id } })).json().column;
    expect((await col(c, faults, 'מראה', 'mirror', { mirror: { relationColumnId: mail.id, targetColumnId: mail.id } })).statusCode).toBe(400);
    expect((await col(c, faults, 'מראה', 'mirror', { mirror: { relationColumnId: rel.id, targetColumnId: 'nope' } })).statusCode).toBe(400);
    const mirror = (await col(c, faults, 'מייל תחזוקה', 'mirror', { mirror: { relationColumnId: rel.id, targetColumnId: mail.id } })).json().column;

    // connect: only items of the connected board
    expect((await c.put(`/api/items/${fault.id}/relations/${rel.id}`, { itemIds: [fault.id] })).json().related).toEqual([]);
    const other = await item(c, faults, 'אחר');
    expect((await c.put(`/api/items/${fault.id}/relations/${rel.id}`, { itemIds: [other.id] })).statusCode).toBe(400);
    expect((await c.put(`/api/items/${fault.id}/relations/${mirror.id}`, { itemIds: [hood.id] })).statusCode).toBe(404);
    const set = await c.put(`/api/items/${fault.id}/relations/${rel.id}`, { itemIds: [hood.id, panel.id, hood.id] });
    expect(set.statusCode).toBe(200);
    expect(set.json().related.map((r: { name: string }) => r.name)).toEqual(['מנדף 3', 'פאנל גז 7']);

    let b = await get(c, faults.id);
    expect(b.relations![fault.id]![rel.id]!.map((r) => r.name)).toEqual(['מנדף 3', 'פאנל גז 7']);
    expect(b.mirrors![fault.id]![mirror.id]).toEqual(['tech@x.org', 'gas@x.org']);
    expect(Object.keys(b.items.find((i) => i.id === fault.id)!.values)).toEqual([]); // nothing stored in the cell
    expect((await c.patch(`/api/items/${fault.id}`, { values: { [rel.id]: 'x' } })).statusCode).toBe(400);
    // the mirrored value follows the source
    await c.patch(`/api/items/${hood.id}`, { values: { [mail.id]: 'new@x.org' } });
    expect((await get(c, faults.id)).mirrors![fault.id]![mirror.id]).toEqual(['new@x.org', 'gas@x.org']);
    // a mirrored number is also summed over the connected items; text mirrors have no sum
    const cost = (await col(c, equipment, 'עלות', 'number')).json().column;
    const costMirror = (await col(c, faults, 'עלות ציוד', 'mirror', { mirror: { relationColumnId: rel.id, targetColumnId: cost.id } })).json().column;
    await c.patch(`/api/items/${hood.id}`, { values: { [cost.id]: 1200 } });
    await c.patch(`/api/items/${panel.id}`, { values: { [cost.id]: 300.5 } });
    b = await get(c, faults.id);
    expect(b.mirrorSums![fault.id]).toEqual({ [costMirror.id]: 1500.5 });
    // export shows names and mirrored values
    const csv = (await c.get(`/api/boards/${faults.id}/export.csv`)).body;
    expect(csv).toContain('מנדף 3; פאנל גז 7');
    expect(csv).toContain('new@x.org; gas@x.org');
    // the picker lists the connected board's items by name
    expect((await c.get(`/api/boards/${equipment.id}/item-names?q=${encodeURIComponent('מנדף')}`)).json().items).toEqual([{ id: hood.id, name: 'מנדף 3' }]);
    expect((await c.get(`/api/boards/${equipment.id}/item-names?q=%25`)).json().items).toEqual([]);

    // replace the set; a deleted target disappears; an emptied cell leaves no entry
    await c.put(`/api/items/${fault.id}/relations/${rel.id}`, { itemIds: [panel.id] });
    b = await get(c, faults.id);
    expect(b.relations![fault.id]![rel.id]!.map((r) => r.name)).toEqual(['פאנל גז 7']);
    await c.del(`/api/items/${panel.id}`);
    expect((await get(c, faults.id)).relations).toEqual({});
    // column links are managed through the column, and do not block a manual link
    await c.put(`/api/items/${fault.id}/relations/${rel.id}`, { itemIds: [hood.id] });
    const linkId = (await c.get(`/api/items/${fault.id}/links`)).json().links[0].id;
    expect((await c.del(`/api/links/${linkId}`)).statusCode).toBe(400);
    expect((await c.post(`/api/items/${fault.id}/links`, { toItemId: hood.id })).statusCode).toBe(201);
    // deleting the column removes its connections
    expect((await c.del(`/api/columns/${rel.id}`)).statusCode).toBe(200);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM item_links WHERE column_id IS NOT NULL').get()).toEqual({ n: 0 });
  });

  it('connects the column to a different board only with a confirmation, and never while a mirror depends on it', async () => {
    ctx = await setup();
    const { client: c } = await loggedIn(ctx, 'boss@x.org', 'manager');
    const equipment = await mkBoard(c, 'ציוד');
    const faults = await mkBoard(c, 'תקלות');
    const rooms = await mkBoard(c, 'חדרים');
    const mail = (await col(c, equipment, 'מייל', 'email')).json().column;
    const hood = await item(c, equipment, 'מנדף 3', { [mail.id]: 'tech@x.org' });
    const panel = await item(c, equipment, 'פאנל גז 7');
    const fault = await item(c, faults, 'דליפה');
    const rel = (await col(c, faults, 'ציוד', 'relation', { relation: { boardId: equipment.id } })).json().column;
    const mirror = (await col(c, faults, 'מייל', 'mirror', { mirror: { relationColumnId: rel.id, targetColumnId: mail.id } })).json().column;
    await c.put(`/api/items/${fault.id}/relations/${rel.id}`, { itemIds: [hood.id, panel.id] });

    const change = (extra: object = {}) => c.patch(`/api/columns/${rel.id}`, { settings: { relation: { boardId: rooms.id } }, ...extra });
    expect((await change({ clearLinks: true })).statusCode).toBe(400); // a mirror column depends on it
    expect((await c.del(`/api/columns/${mirror.id}`)).statusCode).toBe(200);
    expect((await change()).statusCode).toBe(400); // two connections would be removed
    expect((await get(c, faults.id)).relations![fault.id]![rel.id]).toHaveLength(2); // nothing was touched
    expect((await c.patch(`/api/columns/${rel.id}`, { settings: { relation: { boardId: '00000000-0000-4000-8000-000000000000' } }, clearLinks: true })).statusCode).toBe(400);
    // saving other options of the column (same board) needs no confirmation and keeps the connections
    expect((await c.patch(`/api/columns/${rel.id}`, { settings: { description: 'הציוד שבתקלה' } })).statusCode).toBe(200);
    expect((await get(c, faults.id)).relations![fault.id]![rel.id]).toHaveLength(2);

    expect((await change({ clearLinks: true })).json().column.settings).toMatchObject({ relation: { boardId: rooms.id }, description: 'הציוד שבתקלה' });
    expect((await get(c, faults.id)).relations?.[fault.id]).toBeUndefined();
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM item_links WHERE column_id = ?').get(rel.id)).toEqual({ n: 0 });
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM items WHERE board_id = ? AND deleted_at IS NULL').get(equipment.id)).toEqual({ n: 2 }); // the items stay
    const room214 = await item(c, rooms, '214');
    expect((await c.put(`/api/items/${fault.id}/relations/${rel.id}`, { itemIds: [room214.id] })).json().related.map((r: { name: string }) => r.name)).toEqual(['214']);
    expect((await c.put(`/api/items/${fault.id}/relations/${rel.id}`, { itemIds: [hood.id] })).statusCode).toBe(400); // the old board no longer fits
  });


  it('hides connected items and mirrored values from people who cannot see the connected board', async () => {
    ctx = await setup();
    const { client: boss } = await loggedIn(ctx, 'boss@x.org', 'manager');
    const people = await mkBoard(boss, 'אנשי תחזוקה');
    const phone = (await col(boss, people, 'טלפון', 'phone')).json().column;
    const tech = await item(boss, people, 'טכנאי סודי', { [phone.id]: '050-1234567' });
    const equipment = await mkBoard(boss, 'ציוד');
    const rel = (await col(boss, equipment, 'אחראי', 'relation', { relation: { boardId: people.id } })).json().column;
    const mirror = (await col(boss, equipment, 'טלפון', 'mirror', { mirror: { relationColumnId: rel.id, targetColumnId: phone.id } })).json().column;
    const hood = await item(boss, equipment, 'מנדף');
    await boss.put(`/api/items/${hood.id}/relations/${rel.id}`, { itemIds: [tech.id] });
    void mirror;

    const noa = await createUser(ctx, 'noa@x.org', 'member');
    await boss.put(`/api/boards/${equipment.id}/members`, { userId: noa.id, role: 'editor' });
    const n = new Client(ctx.app);
    await n.login('noa@x.org');
    const seen = await n.get(`/api/boards/${equipment.id}`);
    expect(seen.body).not.toContain('טכנאי סודי');
    expect(seen.body).not.toContain('050-1234567');
    expect(seen.json().board.relations).toEqual({});
    expect((await n.get(`/api/boards/${equipment.id}/export.csv`)).body).not.toContain('050-1234567');
    // she cannot list the hidden board's items or change the connection, even as an editor here
    expect((await n.get(`/api/boards/${people.id}/item-names?q=`)).statusCode).toBe(404);
    expect((await n.put(`/api/items/${hood.id}/relations/${rel.id}`, { itemIds: [] })).statusCode).toBe(403);
    expect((await boss.get(`/api/boards/${equipment.id}`)).json().board.relations[hood.id][rel.id]).toHaveLength(1);
    // a viewer of the connected board sees it, but viewers of this board cannot edit
    await boss.put(`/api/boards/${people.id}/members`, { userId: noa.id, role: 'viewer' });
    expect((await n.get(`/api/boards/${equipment.id}`)).json().board.mirrors[hood.id]).toBeTruthy();
    await boss.put(`/api/boards/${equipment.id}/members`, { userId: noa.id, role: 'viewer' });
    expect((await n.put(`/api/items/${hood.id}/relations/${rel.id}`, { itemIds: [] })).statusCode).toBe(403);
  });

  it('a duplicated board keeps a working mirror column', async () => {
    ctx = await setup();
    const { client: c } = await loggedIn(ctx, 'boss@x.org', 'manager');
    const equipment = await mkBoard(c, 'ציוד');
    const room = (await col(c, equipment, 'חדר', 'text')).json().column;
    const faults = await mkBoard(c, 'תקלות');
    const rel = (await col(c, faults, 'ציוד', 'relation', { relation: { boardId: equipment.id } })).json().column;
    await col(c, faults, 'חדר', 'mirror', { mirror: { relationColumnId: rel.id, targetColumnId: room.id } });
    const copy = (await c.post(`/api/boards/${faults.id}/duplicate`, { name: 'תקלות 2027' })).json().board as BoardDetail;
    const nRel = copy.columns.find((x) => x.type === 'relation')!;
    const nMirror = copy.columns.find((x) => x.type === 'mirror')!;
    expect(nRel.id).not.toBe(rel.id);
    expect(nRel.settings.relation).toEqual({ boardId: equipment.id });
    expect(nMirror.settings.mirror).toEqual({ relationColumnId: nRel.id, targetColumnId: room.id });
  });
});
