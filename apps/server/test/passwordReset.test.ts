import { afterEach, describe, expect, it } from 'vitest';
import { Client, createUser, PASSWORD, setup, type TestCtx } from './helpers.js';

let ctx: TestCtx;
afterEach(async () => ctx?.close());

const NEW_PW = 'Brand-New-Password-42';
const tokenFrom = (text: string) => /#token=([A-Za-z0-9_-]{43})/.exec(text)?.[1] ?? null;
const flush = () => new Promise((r) => setTimeout(r, 20));

describe('self-service password reset', () => {
  it('sends a one-time link, same answer for unknown accounts, resets and ends sessions', async () => {
    ctx = await setup({ PUBLIC_URL: 'https://safety.example.org' });
    await createUser(ctx, 'noa@x.org', 'member', 'נועה');
    const session = new Client(ctx.app);
    await session.login('noa@x.org');
    const anon = new Client(ctx.app);

    expect((await anon.get('/api/auth/sso/config')).json().passwordReset).toBe(true);

    // unknown and known e-mail: identical response
    const unknown = await anon.post('/api/auth/password/forgot', { email: 'nobody@x.org' });
    const known = await anon.post('/api/auth/password/forgot', { email: 'NOA@x.org' });
    expect(unknown.statusCode).toBe(200);
    expect(known.statusCode).toBe(200);
    expect(unknown.body).toBe(known.body);
    await flush();
    expect(ctx.mailer.sent).toHaveLength(1);
    const mail = ctx.mailer.sent[0]!;
    expect(mail.to).toBe('noa@x.org');
    expect(mail.text).toContain('https://safety.example.org/reset-password#token=');
    const token = tokenFrom(mail.text)!;
    expect(token).toBeTruthy();
    // only a hash is stored
    const stored = ctx.db.prepare('SELECT id FROM password_resets').all() as { id: string }[];
    expect(stored).toHaveLength(1);
    expect(stored[0]!.id).not.toBe(token);

    // weak password rejected; token still usable afterwards
    expect((await anon.post('/api/auth/password/reset', { token, newPassword: 'short' })).statusCode).toBe(400);
    expect((await anon.post('/api/auth/password/reset', { token, newPassword: NEW_PW })).statusCode).toBe(200);
    // one use only
    const again = await anon.post('/api/auth/password/reset', { token, newPassword: NEW_PW + 'x' });
    expect(again.statusCode).toBe(400);
    expect(again.json().error.code).toBe('INVALID_RESET_LINK');

    // open session ended; old password gone; new works
    expect((await session.get('/api/auth/me')).statusCode).toBe(401);
    expect((await anon.post('/api/auth/login', { email: 'noa@x.org', password: PASSWORD })).statusCode).toBe(401);
    expect((await anon.post('/api/auth/login', { email: 'noa@x.org', password: NEW_PW })).statusCode).toBe(200);
    await flush();
    expect(ctx.mailer.sent.at(-1)!.subject).toContain('הסיסמה שונתה');
    expect(ctx.app.services.audit.list({ event: 'password_reset' })).toHaveLength(1);
    // the audit trail never holds the token
    expect(JSON.stringify(ctx.app.services.audit.list({}))).not.toContain(token);
  });

  it('expires, throttles, replaces earlier links, unlocks a locked account, keeps MFA', async () => {
    ctx = await setup({ PUBLIC_URL: 'https://safety.example.org', LOCKOUT_THRESHOLD: '3' });
    const u = await createUser(ctx, 'dan@x.org', 'member', 'דן');
    const anon = new Client(ctx.app);
    // lock the account
    for (let i = 0; i < 3; i++) await anon.post('/api/auth/login', { email: 'dan@x.org', password: 'wrong-password-123' });
    expect((await anon.post('/api/auth/login', { email: 'dan@x.org', password: PASSWORD })).statusCode).toBe(401);

    await anon.post('/api/auth/password/forgot', { email: 'dan@x.org' });
    await anon.post('/api/auth/password/forgot', { email: 'dan@x.org' }); // within 2 minutes → no second mail
    await flush();
    expect(ctx.mailer.sent).toHaveLength(1);
    const first = tokenFrom(ctx.mailer.sent[0]!.text)!;

    // a later request replaces the first link
    ctx.db.prepare("UPDATE password_resets SET created_at = '2000-01-01T00:00:00.000Z'").run();
    await anon.post('/api/auth/password/forgot', { email: 'dan@x.org' });
    await flush();
    expect(ctx.mailer.sent).toHaveLength(2);
    const second = tokenFrom(ctx.mailer.sent[1]!.text)!;
    expect((await anon.post('/api/auth/password/reset', { token: first, newPassword: NEW_PW })).statusCode).toBe(400);

    // expired
    ctx.db.prepare("UPDATE password_resets SET expires_at = '2000-01-01T00:00:00.000Z'").run();
    expect((await anon.post('/api/auth/password/reset', { token: second, newPassword: NEW_PW })).statusCode).toBe(400);
    ctx.db.prepare('UPDATE password_resets SET expires_at = ?').run(new Date(Date.now() + 60_000).toISOString());

    // MFA stays on: enable a secret flag directly, reset, then login still asks for the code
    ctx.db.prepare("UPDATE users SET mfa_enabled = 1, mfa_secret_enc = 'x' WHERE id = ?").run(u.id);
    expect((await anon.post('/api/auth/password/reset', { token: second, newPassword: NEW_PW })).statusCode).toBe(200);
    const login = await anon.post('/api/auth/login', { email: 'dan@x.org', password: NEW_PW }); // unlocked
    expect(login.statusCode).toBe(200);
    expect(login.json().mfaRequired).toBe(true);
  });

  it('respects the sign-in policy and SSO accounts; hidden without e-mail', async () => {
    ctx = await setup({ PUBLIC_URL: 'https://safety.example.org' });
    await createUser(ctx, 'off@x.org', 'member');
    ctx.db.prepare("UPDATE users SET is_active = 0 WHERE email = 'off@x.org'").run();
    await new Client(ctx.app).post('/api/auth/password/forgot', { email: 'off@x.org' });
    await flush();
    expect(ctx.mailer.sent).toHaveLength(0); // inactive account: nothing sent, same answer
    await ctx.close();

    ctx = await setup({ PUBLIC_URL: 'https://safety.example.org' }, { mailer: null });
    await createUser(ctx, 'a@x.org', 'member');
    const c = new Client(ctx.app);
    expect((await c.get('/api/auth/sso/config')).json().passwordReset).toBe(false);
    expect((await c.post('/api/auth/password/forgot', { email: 'a@x.org' })).statusCode).toBe(200);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM password_resets').get()).toEqual({ n: 0 });
  });

  it('rate-limits requests per address and rejects malformed tokens', async () => {
    ctx = await setup({ PUBLIC_URL: 'https://safety.example.org' });
    const c = new Client(ctx.app);
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await c.post('/api/auth/password/forgot', { email: `x${i}@x.org` })).statusCode);
    expect(codes.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(codes.at(-1)).toBe(429);
    expect((await c.post('/api/auth/password/reset', { token: 'not-a-token', newPassword: NEW_PW })).statusCode).toBe(400);
  });
});
