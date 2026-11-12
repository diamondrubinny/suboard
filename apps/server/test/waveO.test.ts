import type { BoardDetail } from '@suboard/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { Client, createUser, loggedIn, setup, type TestCtx } from './helpers.js';

let ctx: TestCtx;
afterEach(async () => ctx?.close());

const mkBoard = async (c: Client, name: string, templateKey = 'capa') => (await c.post('/api/boards', { name, templateKey })).json().board as BoardDetail;
const mkItem = async (c: Client, b: BoardDetail, name: string, values: Record<string, unknown> = {}) =>
  (await c.post(`/api/boards/${b.id}/items`, { groupId: b.groups[0]!.id, name, values })).json().item as { id: string };

describe('wave O — manual links and the linked-items rollup', () => {
  it('links items across boards, both directions, with a done/total rollup column', async () => {
    ctx = await setup();
    const { client: c } = await loggedIn(ctx, 'boss@x.org', 'manager');
    const incidents = await mkBoard(c, 'אירועים', 'blank');
    const capa = await mkBoard(c, 'פעולות מתקנות');
    const status = capa.columns.find((x) => x.type === 'status')!;
    const doneId = status.settings.options!.find((o) => /בוצע|הושלם|סגור/.test(o.label))!.id;
    const incident = await mkItem(c, incidents, 'דליפת ממס');
    const a1 = await mkItem(c, capa, 'החלפת מכסה', { [status.id]: doneId });
    const a2 = await mkItem(c, capa, 'הדרכת רענון');

    // no column → no stats in the payload
    expect((await c.get(`/api/boards/${incidents.id}`)).json().board.linkStats).toBeUndefined();
    const col = (await c.post(`/api/boards/${incidents.id}/columns`, { title: 'פעולות', type: 'linked' })).json().column;
    expect((await c.get(`/api/boards/${incidents.id}`)).json().board.linkStats).toEqual({});

    const first = await c.post(`/api/items/${incident.id}/links`, { toItemId: a1.id });
    expect(first.statusCode).toBe(201);
    expect(first.json().links[0]).toMatchObject({ kind: 'related', direction: 'out', item: { id: a1.id, boardName: 'פעולות מתקנות', done: true } });
    expect((await c.post(`/api/items/${incident.id}/links`, { toItemId: a2.id })).statusCode).toBe(201);
    // duplicates (either direction) and self links are refused
    expect((await c.post(`/api/items/${incident.id}/links`, { toItemId: a1.id })).statusCode).toBe(400);
    expect((await c.post(`/api/items/${a1.id}/links`, { toItemId: incident.id })).statusCode).toBe(400);
    expect((await c.post(`/api/items/${incident.id}/links`, { toItemId: incident.id })).statusCode).toBe(400);
    expect((await c.post(`/api/items/${incident.id}/links`, { toItemId: '00000000-0000-4000-8000-000000000000' })).statusCode).toBe(404);

    expect((await c.get(`/api/boards/${incidents.id}`)).json().board.linkStats).toEqual({ [incident.id]: { total: 2, done: 1 } });
    // the other side sees the link too
    expect((await c.get(`/api/items/${a2.id}/links`)).json().links[0]).toMatchObject({ direction: 'in', item: { id: incident.id } });
    // the cell cannot be written, and the export shows the rollup
    expect((await c.patch(`/api/items/${incident.id}`, { values: { [col.id]: 5 } })).statusCode).toBe(400);
    expect((await c.get(`/api/boards/${incidents.id}/export.csv`)).body.split('\n')[1]).toContain('1/2');
    // finishing the second action moves the rollup
    await c.patch(`/api/items/${a2.id}`, { values: { [status.id]: doneId } });
    expect((await c.get(`/api/boards/${incidents.id}`)).json().board.linkStats[incident.id]).toEqual({ total: 2, done: 2 });
    // a deleted linked item no longer counts
    await c.del(`/api/items/${a2.id}`);
    expect((await c.get(`/api/boards/${incidents.id}`)).json().board.linkStats[incident.id]).toEqual({ total: 1, done: 1 });

    const history = (await c.get(`/api/items/${incident.id}/activity`)).json().activity.map((a: { action: string }) => a.action);
    expect(history).toContain('item_linked');
    const linkId = first.json().links.find((l: { item: { id: string } }) => l.item.id === a1.id).id;
    expect((await c.del(`/api/links/${linkId}`)).statusCode).toBe(200);
    expect((await c.del(`/api/links/${linkId}`)).statusCode).toBe(404);
    expect((await c.get(`/api/boards/${incidents.id}`)).json().board.linkStats).toEqual({});
  });

  it('never reveals or counts items on boards the user cannot see, and enforces roles', async () => {
    ctx = await setup();
    const { client: boss } = await loggedIn(ctx, 'boss@x.org', 'manager');
    const open = await mkBoard(boss, 'ציוד', 'blank');
    const secret = await mkBoard(boss, 'תחקירים חסויים', 'blank');
    await boss.post(`/api/boards/${open.id}/columns`, { title: 'מקושרים', type: 'linked' });
    const gear = await mkItem(boss, open, 'מנדף 3');
    const hidden = await mkItem(boss, secret, 'תחקיר רגיש');
    const visible = await mkItem(boss, open, 'בדיקה שנתית');
    const hiddenLink = (await boss.post(`/api/items/${gear.id}/links`, { toItemId: hidden.id })).json().links[0].id;
    await boss.post(`/api/items/${gear.id}/links`, { toItemId: visible.id });

    const noa = await createUser(ctx, 'noa@x.org', 'member');
    await boss.put(`/api/boards/${open.id}/members`, { userId: noa.id, role: 'editor' });
    const n = new Client(ctx.app);
    await n.login('noa@x.org');
    // the hidden item: no name in the list, not counted in the rollup
    const links = (await n.get(`/api/items/${gear.id}/links`)).json().links as { item: unknown }[];
    expect(links).toHaveLength(2);
    expect(links.filter((l) => l.item === null)).toHaveLength(1);
    expect(JSON.stringify(links)).not.toContain('תחקיר רגיש');
    expect((await n.get(`/api/boards/${open.id}`)).json().board.linkStats[gear.id]).toEqual({ total: 1, done: 0 });
    expect((await boss.get(`/api/boards/${open.id}`)).json().board.linkStats[gear.id]).toEqual({ total: 2, done: 0 });
    // linking to an item she cannot see looks exactly like a missing item
    const blind = await n.post(`/api/items/${visible.id}/links`, { toItemId: hidden.id });
    const missing = await n.post(`/api/items/${visible.id}/links`, { toItemId: '00000000-0000-4000-8000-000000000000' });
    expect(blind.statusCode).toBe(404);
    expect(blind.body).toBe(missing.body);
    // an editor of one side may remove a manual link, even to a board she cannot see
    expect((await n.del(`/api/links/${hiddenLink}`)).statusCode).toBe(200);

    // viewers cannot link or unlink; strangers get 404
    await boss.put(`/api/boards/${open.id}/members`, { userId: noa.id, role: 'viewer' });
    expect((await n.post(`/api/items/${gear.id}/links`, { toItemId: visible.id })).statusCode).toBe(403);
    const remaining = (await boss.get(`/api/items/${gear.id}/links`)).json().links[0].id;
    expect((await n.del(`/api/links/${remaining}`)).statusCode).toBe(403);
    await createUser(ctx, 'dan@x.org', 'member');
    const d = new Client(ctx.app);
    await d.login('dan@x.org');
    expect((await d.del(`/api/links/${remaining}`)).statusCode).toBe(404);
    expect((await d.post(`/api/items/${gear.id}/links`, { toItemId: visible.id })).statusCode).toBe(404);
  });

  it('keeps automatic links through the table rebuild and refuses to remove them by hand', async () => {
    ctx = await setup();
    const { client: c, user } = await loggedIn(ctx, 'boss@x.org', 'manager');
    const b = await mkBoard(c, 'אירועים', 'blank');
    const x = await mkItem(c, b, 'אירוע');
    const y = await mkItem(c, b, 'פעולה');
    ctx.db.prepare("INSERT INTO item_links (id, from_item, to_item, kind, created_by, created_at) VALUES ('auto-1', ?, ?, 'investigation_action', ?, ?)").run(x.id, y.id, user.id, new Date().toISOString());
    expect((await c.del('/api/links/auto-1')).statusCode).toBe(400);
    // an automatic link does not block a manual one between the same items
    expect((await c.post(`/api/items/${x.id}/links`, { toItemId: y.id })).statusCode).toBe(201);
    expect((await c.get(`/api/items/${x.id}/links`)).json().links).toHaveLength(2);
  });
});
