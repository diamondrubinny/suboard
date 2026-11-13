import { guestMayCall, type BoardDetail } from '@suboard/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { Client, loggedIn, setup, type TestCtx } from './helpers.js';

let ctx: TestCtx;
afterEach(async () => ctx?.close());

describe('teams', () => {
  it('managers manage teams; a team grants nothing; it fills a column and adds people to a board', async () => {
    ctx = await setup();
    const { client: admin } = await loggedIn(ctx, 'root@x.org', 'admin');
    const { client: boss, user: bossUser } = await loggedIn(ctx, 'boss@x.org', 'manager');
    const { client: noa, user: noaUser } = await loggedIn(ctx, 'noa@x.org', 'member');
    const { client: dan, user: danUser } = await loggedIn(ctx, 'dan@x.org', 'member');

    // only managers; unique names
    expect((await noa.post('/api/teams', { name: 'שלי' })).statusCode).toBe(403);
    expect((await boss.post('/api/teams', { name: '' })).statusCode).toBe(400);
    const gas = (await boss.post('/api/teams', { name: 'צוות גזים' })).json().team as { id: string };
    const lab = (await boss.post('/api/teams', { name: 'צוות מעבדות' })).json().team as { id: string };
    expect((await boss.post('/api/teams', { name: 'צוות גזים' })).statusCode).toBe(400);
    expect((await boss.patch(`/api/teams/${lab.id}`, { name: 'צוות גזים' })).statusCode).toBe(400);
    expect((await noa.patch(`/api/teams/${gas.id}`, { memberIds: [noaUser.id] })).statusCode).toBe(403);
    expect((await boss.patch(`/api/teams/${gas.id}`, { memberIds: ['00000000-0000-4000-8000-000000000000'] })).statusCode).toBe(400);
    expect((await boss.patch(`/api/teams/${gas.id}`, { memberIds: [noaUser.id, danUser.id, noaUser.id] })).json().team.memberIds.sort()).toEqual([noaUser.id, danUser.id].sort());
    // everyone (not guests) can read the list
    expect((await noa.get('/api/teams')).json().teams.map((t: { name: string }) => t.name)).toEqual(['צוות גזים', 'צוות מעבדות']);
    expect(guestMayCall('GET', '/teams')).toBe(false);
    expect(guestMayCall('POST', '/boards/b1/members/team')).toBe(false);

    // being in a team gives no access to anything
    const b = (await boss.post('/api/boards', { name: 'תקלות', templateKey: 'blank' })).json().board as BoardDetail;
    expect((await noa.get(`/api/boards/${b.id}`)).statusCode).toBe(404);

    // a team column holds existing teams only
    const col = (await boss.post(`/api/boards/${b.id}/columns`, { title: 'צוות מטפל', type: 'team' })).json().column as { id: string };
    const item = (await boss.post(`/api/boards/${b.id}/items`, { groupId: b.groups[0]!.id, name: 'דליפה' })).json().item as { id: string };
    expect((await boss.patch(`/api/items/${item.id}`, { values: { [col.id]: ['00000000-0000-4000-8000-000000000000'] } })).statusCode).toBe(400);
    expect((await boss.patch(`/api/items/${item.id}`, { values: { [col.id]: 'x' } })).statusCode).toBe(400);
    expect((await boss.patch(`/api/items/${item.id}`, { values: { [col.id]: [gas.id, gas.id, lab.id] } })).json().item.values[col.id]).toEqual([gas.id, lab.id]);
    expect((await boss.get(`/api/boards/${b.id}/export.csv`)).body).toContain('צוות גזים; צוות מעבדות');

    // the owner adds the team's people to the board in one step; existing members keep their role
    await boss.put(`/api/boards/${b.id}/members`, { userId: noaUser.id, role: 'viewer' });
    expect((await noa.post(`/api/boards/${b.id}/members/team`, { teamId: gas.id, role: 'editor' })).statusCode).toBe(403);
    expect((await boss.post(`/api/boards/${b.id}/members/team`, { teamId: gas.id, role: 'owner' })).statusCode).toBe(400);
    expect((await boss.post(`/api/boards/${b.id}/members/team`, { teamId: '00000000-0000-4000-8000-000000000000', role: 'editor' })).statusCode).toBe(404);
    const res = (await boss.post(`/api/boards/${b.id}/members/team`, { teamId: gas.id, role: 'editor' })).json() as { added: number; members: { userId: string; role: string }[] };
    expect(res.added).toBe(1);
    expect(Object.fromEntries(res.members.map((m) => [m.userId, m.role]))).toEqual({ [bossUser.id]: 'owner', [noaUser.id]: 'viewer', [danUser.id]: 'editor' });
    expect((await dan.get(`/api/boards/${b.id}`)).statusCode).toBe(200);
    // a later change to the team does not change the board
    await boss.patch(`/api/teams/${gas.id}`, { memberIds: [] });
    expect((await dan.get(`/api/boards/${b.id}`)).statusCode).toBe(200);

    // guests are never team members and never see teams
    await admin.put('/api/admin/modules', { modules: { guests: true } });
    const until = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const guest = (await admin.post('/api/users', { email: 'g@ext.org', name: 'אורח', role: 'member', password: 'Guest-Pass-2026!x', guest: { expiresAt: until } })).json().user as { id: string };
    expect((await boss.patch(`/api/teams/${gas.id}`, { memberIds: [guest.id] })).statusCode).toBe(400);
    ctx.db.prepare('UPDATE users SET must_change_password = 0 WHERE id = ?').run(guest.id);
    const g = new Client(ctx.app);
    await g.login('g@ext.org', 'Guest-Pass-2026!x');
    ctx.db.prepare('UPDATE users SET mfa_enabled = 1 WHERE id = ?').run(guest.id);
    expect((await g.get('/api/teams')).json().error.code).toBe('GUEST_NOT_ALLOWED');

    // deleting a team removes nobody from a board; the cell just stops showing it
    expect((await noa.del(`/api/teams/${lab.id}`)).statusCode).toBe(403);
    expect((await boss.del(`/api/teams/${lab.id}`)).statusCode).toBe(200);
    expect((await boss.del(`/api/teams/${lab.id}`)).statusCode).toBe(404);
    expect((await boss.get(`/api/boards/${b.id}/export.csv`)).body).toContain('צוות גזים');
    expect((await boss.get(`/api/boards/${b.id}/export.csv`)).body).not.toContain('צוות מעבדות');
    expect((await dan.get(`/api/boards/${b.id}`)).statusCode).toBe(200);
  });
});
