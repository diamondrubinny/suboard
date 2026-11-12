import { guestMayCall, type BoardDetail } from '@suboard/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { Client, loggedIn, setup, type TestCtx } from './helpers.js';

let ctx: TestCtx;
afterEach(async () => ctx?.close());

const PASSWORD = 'Guest-Pass-2026!x';
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

describe('guest accounts', () => {
  it('the allowlist is default-deny', () => {
    for (const [m, p] of [
      ['GET', '/boards'], ['GET', '/boards/b1'], ['POST', '/boards/b1/items'], ['PATCH', '/items/i1'], ['GET', '/items/i1/updates'], ['POST', '/items/i1/updates'],
      ['GET', '/auth/me'], ['POST', '/auth/logout'], ['POST', '/auth/mfa/setup'], ['GET', '/notifications'], ['GET', '/users/directory'], ['HEAD', '/boards'],
    ] as const)
      expect(guestMayCall(m, p), `${m} ${p}`).toBe(true);
    for (const [m, p] of [
      ['POST', '/boards'], ['PATCH', '/boards/b1'], ['DELETE', '/boards/b1'], ['GET', '/boards/b1/export.csv'], ['GET', '/boards/b1/export.xlsx'], ['PUT', '/boards/b1/members'],
      ['POST', '/boards/b1/columns'], ['POST', '/boards/b1/duplicate'], ['GET', '/boards/b1/webhooks'], ['POST', '/boards/b1/import'], ['GET', '/boards/b1/trash'],
      ['GET', '/users'], ['POST', '/users'], ['GET', '/admin/audit'], ['PUT', '/admin/modules'], ['GET', '/auth/tokens'], ['POST', '/auth/tokens'], ['DELETE', '/auth/tokens/t1'],
      ['GET', '/dashboard'], ['GET', '/dashboards'], ['GET', '/workload'], ['GET', '/trainings'], ['GET', '/procedures'], ['GET', '/compliance'], ['GET', '/forms'], ['POST', '/forms/quick'],
      ['GET', '/reports/monthly'], ['POST', '/workspaces'], ['GET', '/templates'], ['POST', '/items/i1/promote'], ['GET', '/items/i1/investigation'],
      ['PATCH', '/columns/c1'], ['GET', '/something-new'], ['GET', '/boards/b1/anything-new'], ['GET', '/boards/b1/export.csv/'], ['GET', '/auth/tokens/'],
    ] as const)
      expect(guestMayCall(m, p), `${m} ${p}`).toBe(false);
  });

  it('a guest sees only invited boards, never e-mails or other users, cannot own, and expires', async () => {
    ctx = await setup();
    const { client: admin } = await loggedIn(ctx, 'root@x.org', 'admin');
    const { client: boss, user: bossUser } = await loggedIn(ctx, 'boss@x.org', 'manager');
    await loggedIn(ctx, 'stranger@x.org', 'member');
    const open = (await boss.post('/api/boards', { name: 'פתוח לקבלן', templateKey: 'blank' })).json().board as BoardDetail;
    const secret = (await boss.post('/api/boards', { name: 'פנימי', templateKey: 'blank' })).json().board as BoardDetail;
    const hidden = (await boss.post(`/api/boards/${secret.id}/items`, { groupId: secret.groups[0]!.id, name: 'סודי' })).json().item as { id: string };

    // the module is off by default: no guest can be created
    const body = { email: 'contractor@ext.org', name: 'קבלן', role: 'member', password: PASSWORD, guest: { expiresAt: inDays(30), org: 'חברת גזים' } };
    expect((await admin.post('/api/users', body)).statusCode).toBe(400);
    await admin.put('/api/admin/modules', { modules: { guests: true } });
    // only administrators; always a plain member; the expiry is in the future and at most a year away
    expect((await boss.post('/api/users', body)).statusCode).toBe(403);
    expect((await admin.post('/api/users', { ...body, role: 'manager' })).statusCode).toBe(400);
    expect((await admin.post('/api/users', { ...body, guest: { expiresAt: inDays(-1) } })).statusCode).toBe(400);
    expect((await admin.post('/api/users', { ...body, guest: { expiresAt: inDays(500) } })).statusCode).toBe(400);
    const guest = (await admin.post('/api/users', body)).json().user as { id: string; guest: boolean; guestOrg: string; guestExpiresAt: string };
    expect(guest).toMatchObject({ guest: true, guestOrg: 'חברת גזים' });
    expect((await admin.patch(`/api/users/${guest.id}`, { role: 'manager' })).statusCode).toBe(400);
    expect((await admin.patch(`/api/users/${bossUser.id}`, { guestExpiresAt: inDays(10) })).statusCode).toBe(400); // not a guest

    // first sign-in: temporary password, then MFA is mandatory before anything else
    ctx.db.prepare('UPDATE users SET must_change_password = 0 WHERE id = ?').run(guest.id);
    const g = new Client(ctx.app);
    await g.login('contractor@ext.org', PASSWORD);
    expect((await g.get('/api/auth/me')).json().user).toMatchObject({ guest: true, mfaSetupRequired: true });
    expect((await g.get('/api/boards')).json().error.code).toBe('MFA_SETUP_REQUIRED');
    ctx.db.prepare('UPDATE users SET mfa_enabled = 1 WHERE id = ?').run(guest.id);

    // nothing until invited
    expect((await g.get('/api/boards')).json().boards).toEqual([]);
    expect((await g.get(`/api/boards/${open.id}`)).statusCode).toBe(404);
    expect((await g.get('/api/users/directory')).json().users).toEqual([]);

    // invited as an editor — never as an owner
    expect((await boss.put(`/api/boards/${open.id}/members`, { userId: guest.id, role: 'owner' })).statusCode).toBe(400);
    expect((await boss.put(`/api/boards/${open.id}/members`, { userId: guest.id, role: 'editor' })).statusCode).toBe(200);
    const seen = (await g.get(`/api/boards/${open.id}`)).json().board as BoardDetail;
    expect(seen.members.map((m) => [m.name, m.email, m.guest ?? false])).toEqual([['boss', '', false], ['קבלן', '', true]]);
    expect((await boss.get(`/api/boards/${open.id}`)).json().board.members.find((m: { userId: string }) => m.userId === guest.id)).toMatchObject({ guest: true, email: 'contractor@ext.org' });
    expect((await g.get('/api/boards')).json().boards.map((b: { name: string }) => b.name)).toEqual(['פתוח לקבלן']);
    // the directory: only people on shared boards, without the stranger and the administrator
    expect((await g.get('/api/users/directory')).json().users.map((u: { name: string }) => u.name).sort()).toEqual(['boss', 'קבלן'].sort());
    expect((await boss.get('/api/users/directory')).json().users.find((u: { id: string }) => u.id === guest.id)).toEqual({ id: guest.id, name: 'קבלן', guest: true });

    // works inside the board…
    const made = await g.post(`/api/boards/${open.id}/items`, { groupId: open.groups[0]!.id, name: 'מהקבלן' });
    expect(made.statusCode).toBe(201);
    const mine = made.json().item as { id: string };
    expect((await g.patch(`/api/items/${mine.id}`, { name: 'עודכן' })).statusCode).toBe(200);
    expect((await g.post(`/api/items/${mine.id}/updates`, { body: 'בוצע' })).statusCode).toBe(201);
    // …and nowhere else: other boards (404), and every cross-cutting or administrative path (403)
    expect((await g.get(`/api/boards/${secret.id}`)).statusCode).toBe(404);
    expect((await g.patch(`/api/items/${hidden.id}`, { name: 'x' })).statusCode).toBe(404);
    expect((await g.get(`/api/items/${hidden.id}/updates`)).statusCode).toBe(404);
    for (const [method, url] of [
      ['post', '/api/boards'], ['get', `/api/boards/${open.id}/export.csv`], ['get', `/api/boards/${open.id}/export.xlsx`], ['get', '/api/users'], ['get', '/api/dashboard'],
      ['get', '/api/workload'], ['get', '/api/trainings'], ['get', '/api/procedures'], ['get', '/api/forms'], ['get', '/api/admin/audit'], ['post', '/api/workspaces'],
      ['get', '/api/auth/tokens'], ['get', `/api/boards/${open.id}/trash`], ['post', `/api/boards/${open.id}/duplicate`],
    ] as const) {
      const r = method === 'get' ? await g.get(url) : await g.post(url, {});
      expect([r.statusCode, r.json().error?.code], `${method} ${url}`).toEqual([403, 'GUEST_NOT_ALLOWED']);
    }
    // a viewer guest cannot edit (the board role still applies)
    await boss.put(`/api/boards/${open.id}/members`, { userId: guest.id, role: 'viewer' });
    expect((await g.patch(`/api/items/${mine.id}`, { name: 'שוב' })).statusCode).toBe(403);

    // expiry: the session dies, sign-in is refused; an administrator extends it
    ctx.db.prepare('UPDATE users SET guest_expires_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), guest.id);
    expect((await g.get('/api/boards')).statusCode).toBe(401);
    expect((await new Client(ctx.app).post('/api/auth/login', { email: 'contractor@ext.org', password: PASSWORD })).statusCode).toBe(401);
    expect((await admin.patch(`/api/users/${guest.id}`, { guestExpiresAt: inDays(60) })).json().user.guestExpiresAt.slice(0, 10)).toBe(inDays(60));
    // switching the module off shuts every guest out; data stays
    await admin.put('/api/admin/modules', { modules: { guests: false } });
    expect((await new Client(ctx.app).post('/api/auth/login', { email: 'contractor@ext.org', password: PASSWORD })).statusCode).toBe(401);
    expect((await boss.get(`/api/boards/${open.id}`)).json().board.items.map((i: { name: string }) => i.name)).toEqual(['עודכן']);
    expect((ctx.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'user_created' AND meta LIKE '%\"guest\":true%'").get() as { n: number }).n).toBe(1);
  });
});
