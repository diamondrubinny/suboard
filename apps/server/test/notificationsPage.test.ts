import type { BoardDetail } from '@suboard/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { loggedIn, setup, type TestCtx } from './helpers.js';

let ctx: TestCtx;
afterEach(async () => ctx?.close());

describe('notifications page query', () => {
  it('returns only the caller\'s notifications, with a bounded limit and an unread-only view', async () => {
    ctx = await setup();
    const { client: boss } = await loggedIn(ctx, 'boss@x.org', 'manager');
    const { client: noa, user: noaUser } = await loggedIn(ctx, 'noa@x.org', 'member');
    const { client: dan, user: danUser } = await loggedIn(ctx, 'dan@x.org', 'member');
    const b = (await boss.post('/api/boards', { name: 'x', templateKey: 'blank' })).json().board as BoardDetail;
    const who = b.columns.find((c) => c.type === 'person')!;
    for (const u of [noaUser, danUser]) await boss.put(`/api/boards/${b.id}/members`, { userId: u.id, role: 'editor' });
    for (let i = 0; i < 5; i++) await boss.post(`/api/boards/${b.id}/items`, { groupId: b.groups[0]!.id, name: `פריט ${i}`, values: { [who.id]: [noaUser.id] } });
    await boss.post(`/api/boards/${b.id}/items`, { groupId: b.groups[0]!.id, name: 'של דן', values: { [who.id]: [danUser.id] } });

    type Page = { notifications: { id: string; title: string; read: boolean }[]; unread: number };
    const get = async (c: typeof noa, q = '') => (await c.get(`/api/notifications${q}`)).json() as Page;
    expect((await get(noa)).notifications).toHaveLength(5);
    expect((await get(noa)).notifications.some((n) => n.title === 'של דן')).toBe(false); // never someone else's
    expect((await get(dan)).notifications.map((n) => n.title)).toEqual(['של דן']);
    expect((await get(noa, '?limit=2')).notifications).toHaveLength(2);
    expect((await get(noa, '?limit=2')).unread).toBe(5); // the counter is not limited by the page
    for (const bad of ['?limit=0', '?limit=abc', '?limit=-3', '?limit=99999', '?limit=1;DROP']) expect((await noa.get(`/api/notifications${bad}`)).statusCode, bad).toBe(200);
    expect((await get(noa, '?limit=0')).notifications.length).toBeGreaterThanOrEqual(1); // clamped, not an error
    const two = (await get(noa)).notifications.slice(0, 2).map((n) => n.id);
    await noa.post('/api/notifications/read', { ids: two });
    const unread = await get(noa, '?unread=1');
    expect([unread.notifications.length, unread.unread, unread.notifications.every((n) => !n.read)]).toEqual([3, 3, true]);
    // marking someone else's notification changes nothing
    await dan.post('/api/notifications/read', { ids: unread.notifications.map((n) => n.id) });
    expect((await get(noa, '?unread=1')).unread).toBe(3);
  });
});
