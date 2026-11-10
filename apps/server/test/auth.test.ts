import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, createUser, loggedIn, ORIGIN, PASSWORD, setup, type TestCtx } from './helpers.js';

let ctx: TestCtx;
beforeEach(async () => {
  ctx = await setup({ LOCKOUT_THRESHOLD: '3' });
});
afterEach(async () => {
  await ctx.close();
});

describe('authentication', () => {
  it('health is public, everything else requires a session', async () => {
    const c = new Client(ctx.app);
    expect((await c.get('/api/health')).statusCode).toBe(200);
    expect((await c.get('/api/boards')).statusCode).toBe(401);
    expect((await c.get('/api/auth/me')).statusCode).toBe(401);
  });

  it('sets a hardened session cookie and never stores the raw token', async () => {
    await createUser(ctx, 'a@x.org', 'member');
    const c = new Client(ctx.app);
    const res = await c.login('A@X.org');
    const cookie = res.cookies.find((k) => k.name === 'sb_session')!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe('Strict');
    expect(cookie.path).toBe('/');
    const stored = ctx.db.prepare('SELECT id FROM sessions').all() as { id: string }[];
    expect(stored).toHaveLength(1);
    expect(stored[0]!.id).not.toBe(cookie.value);
    expect((await c.get('/api/auth/me')).json().user.email).toBe('a@x.org');
  });

  it('uses one generic error for unknown account and wrong password', async () => {
    await createUser(ctx, 'a@x.org', 'member');
    const c = new Client(ctx.app);
    const r1 = await c.post('/api/auth/login', { email: 'nobody@x.org', password: 'whatever-123' });
    const r2 = await c.post('/api/auth/login', { email: 'a@x.org', password: 'wrong-password-1' });
    expect(r1.statusCode).toBe(401);
    expect(r2.statusCode).toBe(401);
    expect(r1.json().error.message).toBe(r2.json().error.message);
  });

  it('locks the account after repeated failures, even for the correct password', async () => {
    await createUser(ctx, 'a@x.org', 'member');
    const c = new Client(ctx.app);
    for (let i = 0; i < 3; i++) await c.post('/api/auth/login', { email: 'a@x.org', password: 'wrong-password-1' });
    const locked = await c.post('/api/auth/login', { email: 'a@x.org', password: PASSWORD });
    expect(locked.statusCode).toBe(401);
    const events = ctx.app.services.audit.list().map((e) => e.event);
    expect(events).toContain('account_locked');
  });

  it('logout invalidates the session server-side', async () => {
    const { client } = await loggedIn(ctx, 'a@x.org', 'member');
    const token = client.token!;
    expect((await client.post('/api/auth/logout')).statusCode).toBe(200);
    client.token = token; // replay the old cookie
    expect((await client.get('/api/boards')).statusCode).toBe(401);
  });

  it('rate-limits login attempts per IP', async () => {
    const limited = await setup({ LOGIN_MAX_PER_WINDOW: '2' });
    const c = new Client(limited.app);
    const codes: number[] = [];
    for (let i = 0; i < 3; i++) codes.push((await c.post('/api/auth/login', { email: 'z@x.org', password: 'x' })).statusCode);
    expect(codes[2]).toBe(429);
    await limited.close();
  });
});

describe('CSRF guard', () => {
  it('rejects state-changing requests without the custom header', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'a@x.org', password: 'x' } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('CSRF');
  });

  it('rejects foreign origins', async () => {
    const c = new Client(ctx.app);
    const res = await c.req('POST', '/api/auth/login', { email: 'a@x.org', password: 'x' }, { headers: { origin: 'https://evil.example' } });
    expect(res.statusCode).toBe(403);
    expect(ORIGIN).not.toBe('https://evil.example');
  });
});

describe('temporary password flow', () => {
  it('blocks the API until an admin-issued password is changed, then revokes other sessions', async () => {
    const { client: admin } = await loggedIn(ctx, 'admin@x.org', 'admin');
    const created = await admin.post('/api/users', { email: 'new@x.org', name: 'חדש', role: 'member', password: 'Temp-Password-123' });
    expect(created.statusCode).toBe(201);

    const user = new Client(ctx.app);
    await user.login('new@x.org', 'Temp-Password-123');
    const second = new Client(ctx.app);
    await second.login('new@x.org', 'Temp-Password-123');

    const blocked = await user.get('/api/boards');
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const weak = await user.post('/api/auth/change-password', { currentPassword: 'Temp-Password-123', newPassword: 'short' });
    expect(weak.statusCode).toBe(400);

    const ok = await user.post('/api/auth/change-password', { currentPassword: 'Temp-Password-123', newPassword: 'A-much-better-pass-99' });
    expect(ok.statusCode).toBe(200);
    expect((await user.get('/api/boards')).statusCode).toBe(200);
    expect((await second.get('/api/boards')).statusCode).toBe(401);
  });
});

describe('user administration', () => {
  it('is admin-only and exposes only id+name in the directory', async () => {
    const { client: member } = await loggedIn(ctx, 'm@x.org', 'member');
    expect((await member.get('/api/users')).statusCode).toBe(403);
    expect((await member.get('/api/admin/audit')).statusCode).toBe(403);
    const dir = (await member.get('/api/users/directory')).json().users;
    expect(Object.keys(dir[0]).sort()).toEqual(['id', 'name']);
  });

  it('prevents admins from locking themselves out and revokes sessions on deactivation', async () => {
    const { user: me, client: admin } = await loggedIn(ctx, 'admin@x.org', 'admin');
    expect((await admin.patch(`/api/users/${me.id}`, { isActive: false })).statusCode).toBe(400);
    expect((await admin.patch(`/api/users/${me.id}`, { role: 'member' })).statusCode).toBe(400);

    const { user: victim, client: victimClient } = await loggedIn(ctx, 'v@x.org', 'member');
    expect((await admin.patch(`/api/users/${victim.id}`, { isActive: false })).statusCode).toBe(200);
    expect((await victimClient.get('/api/boards')).statusCode).toBe(401);
  });

  it('rejects duplicate emails case-insensitively', async () => {
    const { client: admin } = await loggedIn(ctx, 'admin@x.org', 'admin');
    const res = await admin.post('/api/users', { email: 'ADMIN@x.org', name: 'x', role: 'member', password: 'Temp-Password-123' });
    expect(res.statusCode).toBe(409);
  });
});

describe('HTTP hardening', () => {
  it('sends security headers and no-store on API responses', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['permissions-policy']).toContain('camera=()');
  });

  it('does not leak internals on malformed JSON', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'suboard' },
      payload: '{bad json',
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toMatch(/stack|at .*\.ts/);
  });

  it('rejects oversized payloads', async () => {
    const { client } = await loggedIn(ctx, 'a@x.org', 'manager');
    const res = await client.post('/api/boards', { name: 'x', description: 'a'.repeat(200_000) });
    expect(res.statusCode).toBe(413);
  });
});
