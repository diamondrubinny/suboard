import type { BoardDetail } from '@suboard/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { Client, createUser, loggedIn, setup, type TestCtx } from './helpers.js';

let ctx: TestCtx;
afterEach(async () => ctx?.close());

/** A script: no cookie, no browser headers — only the bearer token. */
const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, token: string, body?: unknown) =>
  ctx.app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(body !== undefined ? { payload: body as object } : {}) });

describe('personal API tokens', () => {
  it('is off by default; a token acts with its owner’s permissions on the data API only', async () => {
    ctx = await setup();
    const { client: admin } = await loggedIn(ctx, 'root@x.org', 'admin');
    const { client: boss } = await loggedIn(ctx, 'boss@x.org', 'manager');
    expect((await boss.get('/api/auth/tokens')).json().error.code).toBe('MODULE_DISABLED');
    await admin.put('/api/admin/modules', { modules: { api_tokens: true } });

    // validation: every token expires, name and scope are required
    expect((await boss.post('/api/auth/tokens', { name: 'x', scope: 'write', days: 9999 })).statusCode).toBe(400);
    expect((await boss.post('/api/auth/tokens', { name: '', scope: 'write', days: 30 })).statusCode).toBe(400);
    expect((await boss.post('/api/auth/tokens', { name: 'x', scope: 'admin', days: 30 })).statusCode).toBe(400);
    const made = await boss.post('/api/auth/tokens', { name: 'סנכרון מלאי', scope: 'write', days: 30 });
    expect(made.statusCode).toBe(201);
    const token = made.json().token as string;
    expect(token).toMatch(/^sbp_[A-Za-z0-9_-]{43}$/);
    // shown once; only a hash is stored
    const listed = (await boss.get('/api/auth/tokens')).json().tokens;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ name: 'סנכרון מלאי', scope: 'write', hint: token.slice(-4), lastUsedAt: null });
    expect(JSON.stringify(listed)).not.toContain(token);
    expect(JSON.stringify(ctx.db.prepare('SELECT * FROM api_tokens').all())).not.toContain(token);

    // the script works without cookies or browser headers, as the owner
    const b = (await call('POST', '/api/boards', token, { name: 'מלאי', templateKey: 'blank' })).json().board as BoardDetail;
    expect(b.myRole).toBe('owner');
    const item = await call('POST', `/api/boards/${b.id}/items`, token, { groupId: b.groups[0]!.id, name: 'קסדה' });
    expect(item.statusCode).toBe(201);
    expect((await call('GET', '/api/boards', token)).json().boards.map((x: { name: string }) => x.name)).toEqual(['מלאי']);
    expect((await call('GET', '/api/auth/me', token)).json().user.email).toBe('boss@x.org');
    expect((await boss.get('/api/auth/tokens')).json().tokens[0].lastUsedAt).toBeTruthy();
    // never more than the owner may do: another user's board stays invisible
    const other = (await admin.post('/api/boards', { name: 'סודי', templateKey: 'blank' })).json().board as BoardDetail;
    expect((await call('GET', `/api/boards/${other.id}`, token)).statusCode).toBe(404);

    // account security and administration are closed to tokens
    for (const [m, u, body] of [
      ['GET', '/api/auth/tokens', undefined],
      ['POST', '/api/auth/tokens', { name: 'עוד', scope: 'write', days: 30 }],
      ['POST', '/api/auth/change-password', { currentPassword: 'x', newPassword: 'New-Password-12345' }],
      ['GET', '/api/auth/sessions', undefined],
      ['POST', '/api/auth/passkeys/register/options', {}],
      ['GET', '/api/users', undefined],
      ['GET', '/api/admin/audit', undefined],
      ['POST', '/api/auth/logout', {}],
    ] as const) {
      const res = await call(m, u, token, body);
      expect(res.statusCode, `${m} ${u}`).toBe(403);
      expect(res.json().error.code).toBe('TOKEN_NOT_ALLOWED');
    }
    const adminToken = (await admin.post('/api/auth/tokens', { name: 'a', scope: 'write', days: 30 })).json().token as string;
    expect((await call('PUT' as 'POST', '/api/admin/modules', adminToken, { modules: { forms: false } })).statusCode).toBe(403);

    // junk and near-misses are just "not signed in"
    for (const t of ['sbp_' + 'x'.repeat(43), token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A'), 'whatever', '']) expect((await call('GET', '/api/boards', t)).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/boards', headers: { authorization: `Basic ${token}` } })).statusCode).toBe(401);
  });

  it('read-only tokens cannot write; revoked, expired, deactivated and switched-off tokens stop working', async () => {
    ctx = await setup();
    const { client: admin } = await loggedIn(ctx, 'root@x.org', 'admin');
    await admin.put('/api/admin/modules', { modules: { api_tokens: true } });
    const noa = await createUser(ctx, 'noa@x.org', 'member');
    const n = new Client(ctx.app);
    await n.login('noa@x.org');
    const b = (await admin.post('/api/boards', { name: 'לוח', templateKey: 'blank' })).json().board as BoardDetail;
    await admin.put(`/api/boards/${b.id}/members`, { userId: noa.id, role: 'editor' });

    const ro = (await n.post('/api/auth/tokens', { name: 'דוח', scope: 'read', days: 90 })).json() as { token: string; info: { id: string } };
    expect((await call('GET', `/api/boards/${b.id}`, ro.token)).statusCode).toBe(200);
    const write = await call('POST', `/api/boards/${b.id}/items`, ro.token, { groupId: b.groups[0]!.id, name: 'x' });
    expect(write.statusCode).toBe(403);
    expect(write.json().error.code).toBe('TOKEN_READ_ONLY');

    // at most five; another user cannot revoke mine
    for (let i = 0; i < 4; i++) expect((await n.post('/api/auth/tokens', { name: `t${i}`, scope: 'read', days: 30 })).statusCode).toBe(201);
    expect((await n.post('/api/auth/tokens', { name: 'six', scope: 'read', days: 30 })).statusCode).toBe(400);
    expect((await admin.del(`/api/auth/tokens/${ro.info.id}`)).statusCode).toBe(404);

    // expired
    ctx.db.prepare('UPDATE api_tokens SET expires_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), ro.info.id);
    expect((await call('GET', `/api/boards/${b.id}`, ro.token)).statusCode).toBe(401);
    const rw = (await n.post('/api/auth/tokens', { name: 'rw', scope: 'write', days: 30 })).json() as { token: string; info: { id: string } }; // the expired one made room
    expect((await call('GET', `/api/boards/${b.id}`, rw.token)).statusCode).toBe(200);
    // module switched off → refused; back on → works again
    await admin.put('/api/admin/modules', { modules: { api_tokens: false } });
    expect((await call('GET', `/api/boards/${b.id}`, rw.token)).statusCode).toBe(401);
    await admin.put('/api/admin/modules', { modules: { api_tokens: true } });
    expect((await call('GET', `/api/boards/${b.id}`, rw.token)).statusCode).toBe(200);
    // losing access to the board applies to the token at once
    await admin.del(`/api/boards/${b.id}/members/${noa.id}`);
    expect((await call('GET', `/api/boards/${b.id}`, rw.token)).statusCode).toBe(404);
    // deactivated account
    ctx.db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(noa.id);
    expect((await call('GET', '/api/boards', rw.token)).statusCode).toBe(401);
    ctx.db.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(noa.id);
    // revoked by the owner; and the admin's "disconnect devices" removes every token
    expect((await n.del(`/api/auth/tokens/${rw.info.id}`)).statusCode).toBe(200);
    expect((await call('GET', '/api/boards', rw.token)).statusCode).toBe(401);
    expect((await admin.post(`/api/users/${noa.id}/revoke-sessions`)).json().tokensRevoked).toBe(4);
    const events = (ctx.db.prepare("SELECT meta FROM audit_log WHERE event = 'api_token_changed'").all() as { meta: string }[]).map((e) => JSON.parse(e.meta).action);
    expect(events.filter((a) => a === 'created')).toHaveLength(6);
    expect(events).toContain('revoked');
  });

  it('a browser session still needs the CSRF header even when a bearer header is added', async () => {
    ctx = await setup();
    const { client: admin } = await loggedIn(ctx, 'root@x.org', 'admin');
    const res = await ctx.app.inject({ method: 'POST', url: '/api/boards', cookies: { sb_session: admin.token! }, headers: { authorization: 'Bearer sbp_' + 'x'.repeat(43) }, payload: { name: 'x', templateKey: 'blank' } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('CSRF');
  });
});
