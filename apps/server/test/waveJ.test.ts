import type { BoardDetail, Column } from '@suboard/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loggedIn, setup, type Client, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let m: Client;
let e: Client;
let v: Client;
let o: Client;
let ids: Record<'m' | 'e' | 'v' | 'o', string>;
let board: BoardDetail;

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

const add = async (name: string, parentId?: string, values: Record<string, unknown> = {}, client = m) => {
  const r = await client.post(`/api/boards/${board.id}/items`, { groupId: board.groups[0]!.id, name, values, ...(parentId ? { parentId } : {}) });
  return r;
};
const live = async () => ((await m.get(`/api/boards/${board.id}`)).json().board as BoardDetail).items;

describe('J1 nested sub-items', () => {
  it('nests several levels, refuses beyond the limit, and keeps the family together', async () => {
    const top = (await add('החלפת מנדף')).json().item;
    const sub = (await add('הזמנת קבלן', top.id)).json().item;
    const subsub = (await add('קבלת הצעת מחיר', sub.id)).json().item;
    expect(subsub.parentId).toBe(sub.id);
    // deeper levels are allowed up to the limit (5 below the top item), then refused
    const l3 = (await add('רמה 3', subsub.id)).json().item;
    const l4 = (await add('רמה 4', l3.id)).json().item;
    const l5 = (await add('רמה 5', l4.id)).json().item;
    expect((await add('עמוק מדי', l5.id)).statusCode).toBe(400);
    await m.del(`/api/items/${l3.id}`); // with its descendants

    // group move takes every descendant
    const g2 = board.groups[1]!.id;
    expect((await m.patch(`/api/items/${top.id}`, { groupId: g2 })).statusCode).toBe(200);
    expect((await live()).filter((i) => [top.id, sub.id, subsub.id].includes(i.id)).every((i) => i.groupId === g2)).toBe(true);

    // duplicate copies both levels
    const copy = (await m.post(`/api/items/${top.id}/duplicate`)).json().item;
    const all = await live();
    const copyKids = all.filter((i) => i.parentId === copy.id);
    expect(copyKids.map((i) => i.name)).toEqual(['הזמנת קבלן']);
    expect(all.filter((i) => i.parentId === copyKids[0]!.id).map((i) => i.name)).toEqual(['קבלת הצעת מחיר']);
    // a sub-item can be duplicated next to itself
    const subCopy = (await m.post(`/api/items/${sub.id}/duplicate`)).json().item;
    expect(subCopy.parentId).toBe(top.id);

    // trash + restore: whole family
    await m.del(`/api/items/${top.id}`);
    expect((await live()).some((i) => [top.id, sub.id, subsub.id].includes(i.id))).toBe(false);
    const trash = (await m.get(`/api/boards/${board.id}/trash`)).json().items as { id: string }[];
    const trashed = trash.map((t) => t.id);
    expect(trashed).toContain(top.id);
    expect(trashed).not.toContain(sub.id); // descendants deleted with it are not listed separately
    expect(trashed).not.toContain(subsub.id);
    await m.post(`/api/items/${top.id}/restore`);
    expect((await live()).filter((i) => [top.id, sub.id, subsub.id].includes(i.id))).toHaveLength(3);

    // export keeps parents before children
    const csv = (await m.get(`/api/boards/${board.id}/export.csv`)).body;
    expect(csv.indexOf('הזמנת קבלן')).toBeLessThan(csv.indexOf('קבלת הצעת מחיר'));
  });

  it('promotes a sub-item to a top-level item (editors only)', async () => {
    const top = (await add('אב')).json().item;
    const sub = (await add('ילד', top.id)).json().item;
    const subsub = (await add('נכד', sub.id)).json().item;
    expect((await v.post(`/api/items/${sub.id}/promote`)).statusCode).toBe(403);
    expect((await o.post(`/api/items/${sub.id}/promote`)).statusCode).toBe(404);
    expect((await m.post(`/api/items/${top.id}/promote`)).statusCode).toBe(400);
    const p = (await e.post(`/api/items/${sub.id}/promote`)).json().item;
    expect(p.parentId).toBeNull();
    expect((await live()).find((i) => i.id === subsub.id)!.parentId).toBe(sub.id); // its own sub-item stays
    // now a third level under the promoted branch is possible again up to two
    expect((await add('נין', subsub.id)).statusCode).toBe(201);
  });
});

describe('J4 my work', () => {
  it('lists my open items and sub-items across boards with a "done" shortcut for editors', async () => {
    const person = board.columns.find((c: Column) => c.type === 'person')!;
    const status = board.columns.find((c: Column) => c.type === 'status')!;
    const due = board.columns.find((c: Column) => c.type === 'date')!;
    const done = status.settings.options!.find((x) => x.done)!.id;
    const top = (await add('אב', undefined, { [person.id]: [ids.m] })).json().item;
    await add('שלי — תת-משימה', top.id, { [person.id]: [ids.e], [due.id]: '2026-01-05' });
    await add('שלי — סגורה', undefined, { [person.id]: [ids.e], [status.id]: done });
    await add('של הצופה', undefined, { [person.id]: [ids.v] });

    const mine = (await e.get('/api/me/work')).json().items as { itemName: string; parentName: string | null; complete: unknown; dueDate: string | null }[];
    expect(mine.map((x) => x.itemName)).toEqual(['שלי — תת-משימה']);
    expect(mine[0]).toMatchObject({ parentName: 'אב', dueDate: '2026-01-05', complete: { columnId: status.id, optionId: done } });
    // viewer sees own work but cannot complete in place
    const vw = (await v.get('/api/me/work')).json().items;
    expect(vw).toHaveLength(1);
    expect(vw[0].complete).toBeNull();
    // removed from the board → nothing
    await m.del(`/api/boards/${board.id}/members/${ids.e}`);
    expect((await e.get('/api/me/work')).json().items).toEqual([]);
  });
});
