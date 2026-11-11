import type { BoardDetail } from '@suboard/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { Client, createUser, loggedIn, setup, type TestCtx } from './helpers.js';

let ctx: TestCtx;
afterEach(async () => ctx?.close());

async function board(c: Client, name = 'ציוד') {
  return (await c.post('/api/boards', { name, templateKey: 'blank' })).json().board as BoardDetail;
}
const addCol = async (c: Client, boardId: string, title: string, type: string, settings?: unknown) =>
  c.post(`/api/boards/${boardId}/columns`, { title, type, ...(settings ? { settings } : {}) });

describe('wave N — formula columns', () => {
  it('validates the formula against the board, is read-only, and exports the computed value', async () => {
    ctx = await setup();
    const { client: c } = await loggedIn(ctx, 'boss@x.org', 'manager');
    const b = await board(c);
    const cost = (await addCol(c, b.id, 'עלות', 'number')).json().column;
    const qty = (await addCol(c, b.id, 'כמות', 'number')).json().column;
    const who = (await addCol(c, b.id, 'אחראי', 'person')).json().column;

    expect((await addCol(c, b.id, 'סה"כ', 'formula')).statusCode).toBe(400); // no formula
    expect((await addCol(c, b.id, 'סה"כ', 'formula', { formula: `{${cost.id}} *` })).statusCode).toBe(400);
    expect((await addCol(c, b.id, 'סה"כ', 'formula', { formula: '{00000000-0000-4000-8000-000000000000} * 2' })).statusCode).toBe(400);
    expect((await addCol(c, b.id, 'סה"כ', 'formula', { formula: `{${who.id}} * 2` })).statusCode).toBe(400);
    expect((await addCol(c, b.id, 'טקסט', 'text', { formula: '1' })).statusCode).toBe(400);
    const total = await addCol(c, b.id, 'סה"כ', 'formula', { formula: `{${cost.id}} * {${qty.id}}` });
    expect(total.statusCode).toBe(201);
    const f = total.json().column;
    // a formula cannot read another formula
    expect((await addCol(c, b.id, 'כפול', 'formula', { formula: `{${f.id}} * 2` })).statusCode).toBe(400);

    const item = (await c.post(`/api/boards/${b.id}/items`, { groupId: b.groups[0]!.id, name: 'מטף', values: { [cost.id]: 120, [qty.id]: 4 } })).json().item;
    expect((await c.patch(`/api/items/${item.id}`, { values: { [f.id]: 999 } })).statusCode).toBe(400);
    // nothing is stored for the formula column
    expect(Object.keys((await c.get(`/api/boards/${b.id}`)).json().board.items[0].values)).not.toContain(f.id);

    const csv = (await c.get(`/api/boards/${b.id}/export.csv`)).body;
    expect(csv).toContain('סה""כ');
    expect(csv.split('\n')[1]).toContain('480');
    // editing the formula
    expect((await c.patch(`/api/columns/${f.id}`, { settings: { formula: 'nope(' } })).statusCode).toBe(400);
    expect((await c.patch(`/api/columns/${f.id}`, { settings: { formula: `ROUND({${cost.id}} / {${qty.id}}, 1)` } })).statusCode).toBe(200);
    expect((await c.get(`/api/boards/${b.id}/export.csv`)).body.split('\n')[1]).toContain('30');
    // only the owner defines formulas
    const noa = await createUser(ctx, 'noa@x.org', 'member');
    await c.put(`/api/boards/${b.id}/members`, { userId: noa.id, role: 'editor' });
    const n = new Client(ctx.app);
    await n.login('noa@x.org');
    expect((await n.patch(`/api/columns/${f.id}`, { settings: { formula: '1' } })).statusCode).toBe(403);
  });
});

describe('wave N — duplicate group and board', () => {
  it('copies a group with its sub-items inside the board', async () => {
    ctx = await setup();
    const { client: c } = await loggedIn(ctx, 'boss@x.org', 'manager');
    const b = await board(c);
    const g = b.groups[0]!;
    const top = (await c.post(`/api/boards/${b.id}/items`, { groupId: g.id, name: 'בדיקה שנתית' })).json().item;
    const sub = (await c.post(`/api/boards/${b.id}/items`, { groupId: g.id, name: 'תיאום', parentId: top.id })).json().item;
    await c.post(`/api/boards/${b.id}/items`, { groupId: g.id, name: 'אישור', parentId: sub.id });

    const res = await c.post(`/api/groups/${g.id}/duplicate`);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ items: 3, group: { name: `${g.name} (עותק)` } });
    const after = (await c.get(`/api/boards/${b.id}`)).json().board as BoardDetail;
    const copies = after.items.filter((i) => i.groupId === res.json().group.id);
    expect(copies.map((i) => i.name).sort()).toEqual(['אישור', 'בדיקה שנתית', 'תיאום']);
    const copyTop = copies.find((i) => !i.parentId)!;
    const copySub = copies.find((i) => i.parentId === copyTop.id)!;
    expect(copies.find((i) => i.parentId === copySub.id)!.name).toBe('אישור');
    expect(after.items.filter((i) => i.groupId === g.id)).toHaveLength(3);

    // viewers cannot; strangers get 404
    const noa = await createUser(ctx, 'noa@x.org', 'member');
    await c.put(`/api/boards/${b.id}/members`, { userId: noa.id, role: 'viewer' });
    const n = new Client(ctx.app);
    await n.login('noa@x.org');
    expect((await n.post(`/api/groups/${g.id}/duplicate`)).statusCode).toBe(403);
    await createUser(ctx, 'dan@x.org', 'manager');
    const d = new Client(ctx.app);
    await d.login('dan@x.org');
    expect((await d.post(`/api/groups/${g.id}/duplicate`)).statusCode).toBe(404);
  });

  it('duplicates a board: structure, formulas re-pointed, items without people; templates keep formulas too', async () => {
    ctx = await setup();
    const { client: c, user } = await loggedIn(ctx, 'boss@x.org', 'manager');
    const b = await board(c, 'מלאי');
    const cost = (await addCol(c, b.id, 'עלות', 'number')).json().column;
    const who = (await addCol(c, b.id, 'אחראי', 'person')).json().column;
    const f = (await addCol(c, b.id, 'עם מע"מ', 'formula', { formula: `ROUND({${cost.id}} * 1.18, 2)` })).json().column;
    const top = (await c.post(`/api/boards/${b.id}/items`, { groupId: b.groups[0]!.id, name: 'קסדה', values: { [cost.id]: 100, [who.id]: [user.id] } })).json().item;
    await c.post(`/api/boards/${b.id}/items`, { groupId: b.groups[0]!.id, name: 'רצועה', parentId: top.id, values: { [cost.id]: 10 } });
    await c.post(`/api/items/${top.id}/updates`, { body: 'הערה פנימית' });

    expect((await c.post(`/api/boards/${b.id}/duplicate`, { name: '' })).statusCode).toBe(400);
    const res = await c.post(`/api/boards/${b.id}/duplicate`, { name: 'מלאי 2027', withItems: true });
    expect(res.statusCode).toBe(201);
    expect(res.json().items).toBe(2);
    const nb = res.json().board as BoardDetail;
    expect(nb.id).not.toBe(b.id);
    expect(nb.columns.map((x) => x.title)).toEqual((await c.get(`/api/boards/${b.id}`)).json().board.columns.map((x: { title: string }) => x.title));
    const nCost = nb.columns.find((x) => x.title === 'עלות')!;
    const nF = nb.columns.find((x) => x.type === 'formula')!;
    expect(nF.settings.formula).toBe(`ROUND({${nCost.id}} * 1.18, 2)`);
    expect(nF.settings.formula).not.toContain(cost.id);
    const nTop = nb.items.find((i) => i.name === 'קסדה')!;
    expect(nTop.values[nCost.id]).toBe(100);
    expect(Object.keys(nTop.values)).toEqual([nCost.id]); // the person value is not copied
    expect(nb.items.find((i) => i.name === 'רצועה')!.parentId).toBe(nTop.id);
    expect((await c.get(`/api/items/${nTop.id}/updates`)).json().updates).toEqual([]);
    expect((await c.get(`/api/boards/${nb.id}/export.csv`)).body).toContain('118');
    void f;

    // structure only
    const empty = (await c.post(`/api/boards/${b.id}/duplicate`, { name: 'ריק' })).json();
    expect(empty.items).toBe(0);
    expect(empty.board.items).toEqual([]);

    // an organisation template made from the board keeps a working formula
    const tpl = (await c.post(`/api/boards/${b.id}/save-as-template`, { name: 'תבנית מלאי' })).json().template;
    const fromTpl = (await c.post('/api/boards', { name: 'מתבנית', templateKey: 'blank', customTemplateId: tpl.id })).json().board as BoardDetail;
    const tCost = fromTpl.columns.find((x) => x.title === 'עלות')!;
    expect(fromTpl.columns.find((x) => x.type === 'formula')!.settings.formula).toBe(`ROUND({${tCost.id}} * 1.18, 2)`);

    // only an owner who may create boards can duplicate
    const noa = await createUser(ctx, 'noa@x.org', 'member');
    await c.put(`/api/boards/${b.id}/members`, { userId: noa.id, role: 'editor' });
    const n = new Client(ctx.app);
    await n.login('noa@x.org');
    expect((await n.post(`/api/boards/${b.id}/duplicate`, { name: 'x' })).statusCode).toBe(403);
    const events = (ctx.db.prepare("SELECT event FROM audit_log WHERE event = 'board_duplicated'").all() as unknown[]).length;
    expect(events).toBe(2);
  });
});
