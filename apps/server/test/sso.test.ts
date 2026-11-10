import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createUser, ORIGIN, PASSWORD, setup, type TestCtx } from './helpers.js';
import { startOidcStub, type StubIdentity } from './oidcStub.js';

const CLIENT_ID = 'suboard-test';
const CLIENT_SECRET = 'test-secret-value';
const SCIM_TOKEN = 'scim-test-token-0123456789abcdef0123456789';
let stub: Awaited<ReturnType<typeof startOidcStub>>;

beforeAll(async () => {
  stub = await startOidcStub(CLIENT_ID, CLIENT_SECRET);
});
afterAll(async () => stub.close());

const ssoEnv = (extra: Record<string, string> = {}) => ({
  OIDC_ISSUER: stub.issuer,
  OIDC_CLIENT_ID: CLIENT_ID,
  OIDC_CLIENT_SECRET: CLIENT_SECRET,
  OIDC_ALLOW_INSECURE: 'true',
  PUBLIC_URL: ORIGIN,
  ...extra,
});

/** Runs the browser part of a login: start → (IdP) → callback. Returns the hop target and session cookie. */
async function ssoLogin(ctx: TestCtx, id: StubIdentity, opts: { next?: string; replay?: boolean } = {}) {
  const start = await ctx.app.inject({ method: 'GET', url: `/api/auth/sso/start${opts.next ? `?next=${encodeURIComponent(opts.next)}` : ''}` });
  expect(start.statusCode, start.body).toBe(302);
  const location = start.headers.location as string;
  const ssoCookie = start.cookies.find((c) => c.name === 'sb_sso')!;
  expect(ssoCookie.httpOnly).toBe(true);
  expect(ssoCookie.sameSite?.toLowerCase()).toBe('lax');
  const q = new URL(location).searchParams;
  expect(q.get('code_challenge_method')).toBe('S256');
  expect(q.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/sso/callback`);
  const code = stub.code(id, location);
  const cb = async () =>
    ctx.app.inject({ method: 'GET', url: `/api/auth/sso/callback?code=${code}&state=${q.get('state')}`, cookies: { sb_sso: ssoCookie.value } });
  const res = await cb();
  if (opts.replay) return { first: res, second: await cb() };
  const hop = /url=([^"]+)"/.exec(res.body)?.[1]?.replace(/&amp;/g, '&');
  const session = res.cookies.find((c) => c.name === 'sb_session')?.value;
  return { res, hop, session };
}
const me = (ctx: TestCtx, session: string) => ctx.app.inject({ method: 'GET', url: '/api/auth/me', cookies: { sb_session: session } }).then((r) => r.json().user);

describe('SSO (OpenID Connect)', () => {
  it('links an existing account by e-mail, then by immutable id; refuses unknown users and re-linking', async () => {
    const ctx = await setup(ssoEnv());
    const cfg = (await ctx.app.inject({ method: 'GET', url: '/api/auth/sso/config' })).json();
    expect(cfg).toMatchObject({ enabled: true, localLogin: 'enabled' });
    await createUser(ctx, 'noa@unit.org', 'member');

    const first = await ssoLogin(ctx, { sub: 's-1', oid: 'oid-noa', email: 'Noa@Unit.org', name: 'נועה' }, { next: '/boards' });
    expect(first.hop).toBe('/boards');
    const user = await me(ctx, first.session!);
    expect(user).toMatchObject({ email: 'noa@unit.org', authSource: 'sso' });

    // Same immutable id with a changed e-mail still finds the account.
    const again = await ssoLogin(ctx, { sub: 's-1', oid: 'oid-noa', email: 'noa.new@unit.org' });
    expect((await me(ctx, again.session!)).email).toBe('noa@unit.org');

    // Another IdP identity claiming the same e-mail is refused (no account takeover).
    expect((await ssoLogin(ctx, { sub: 's-2', oid: 'oid-evil', email: 'noa@unit.org' })).hop).toBe('/login?sso_error=mismatch');
    // Unknown user without JIT.
    expect((await ssoLogin(ctx, { sub: 's-3', email: 'stranger@unit.org' })).hop).toBe('/login?sso_error=no_account');
    // Unsafe next paths are dropped.
    expect((await ssoLogin(ctx, { sub: 's-1', oid: 'oid-noa', email: 'noa@unit.org' }, { next: '//evil.example/x' })).hop).toBe('/');
    await ctx.close();
  });

  it('rejects a replayed callback, a wrong nonce or audience, and a missing state cookie', async () => {
    const ctx = await setup(ssoEnv());
    await createUser(ctx, 'dan@unit.org', 'member');
    const { first, second } = (await ssoLogin(ctx, { sub: 'd', email: 'dan@unit.org' }, { replay: true })) as { first: { cookies: { name: string }[] }; second: { body: string } };
    expect(first.cookies.some((c) => c.name === 'sb_session')).toBe(true);
    expect(second.body).toContain('sso_error=state');
    expect((await ssoLogin(ctx, { sub: 'd', email: 'dan@unit.org', nonce: 'forged' })).hop).toBe('/login?sso_error=exchange');
    expect((await ssoLogin(ctx, { sub: 'd', email: 'dan@unit.org', aud: 'someone-else' })).hop).toBe('/login?sso_error=exchange');
    const noCookie = await ctx.app.inject({ method: 'GET', url: '/api/auth/sso/callback?code=x&state=y' });
    expect(noCookie.body).toContain('sso_error=state');
    const audit = ctx.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'sso_login_failed'").get() as { n: number };
    expect(audit.n).toBeGreaterThanOrEqual(3);
    await ctx.close();
  });

  it('JIT provisioning with a domain allow-list; MFA from the IdP satisfies the admin requirement', async () => {
    const ctx = await setup(ssoEnv({ SSO_JIT_PROVISIONING: 'true', SSO_ALLOWED_DOMAINS: 'unit.org', MFA_REQUIRED_ROLES: 'admin' }));
    expect((await ssoLogin(ctx, { sub: 'x', email: 'out@other.org' })).hop).toBe('/login?sso_error=domain');
    const j = await ssoLogin(ctx, { sub: 'new-1', email: 'new@unit.org', name: 'חדש' });
    expect(await me(ctx, j.session!)).toMatchObject({ role: 'member', name: 'חדש', authSource: 'sso' });

    await createUser(ctx, 'boss@unit.org', 'admin');
    const withMfa = await ssoLogin(ctx, { sub: 'b', email: 'boss@unit.org', amr: ['pwd', 'mfa'] });
    expect((await me(ctx, withMfa.session!)).mfaSetupRequired).toBe(false);
    const noMfa = await ssoLogin(ctx, { sub: 'b', email: 'boss@unit.org', amr: ['pwd'] });
    expect((await me(ctx, noMfa.session!)).mfaSetupRequired).toBe(true);
    await ctx.close();
  });

  it('password login policy: admins only, and it cannot be restricted without SSO', async () => {
    expect(() => loadConfig({ NODE_ENV: 'test', LOCAL_LOGIN: 'disabled' })).toThrow(/LOCAL_LOGIN/);
    expect(() => loadConfig({ NODE_ENV: 'test', OIDC_ISSUER: 'https://idp.example', OIDC_CLIENT_ID: 'x' })).toThrow(/OIDC_ISSUER/);
    const ctx = await setup(ssoEnv({ LOCAL_LOGIN: 'admins_only' }));
    await createUser(ctx, 'member@unit.org', 'member');
    await createUser(ctx, 'root@unit.org', 'admin');
    const login = (email: string, password = PASSWORD) =>
      ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password }, headers: { 'x-requested-with': 'suboard', origin: ORIGIN } });
    const m = await login('member@unit.org');
    expect(m.statusCode).toBe(403);
    expect(m.json().error.code).toBe('USE_SSO');
    expect((await login('member@unit.org', 'wrong-password-123')).statusCode).toBe(401); // wrong password: no policy hint
    expect((await login('root@unit.org')).statusCode).toBe(200); // break-glass admin
    await ctx.close();
  });

  it('SSO disabled: config says so and start falls back to the login page', async () => {
    const ctx = await setup();
    expect((await ctx.app.inject({ method: 'GET', url: '/api/auth/sso/config' })).json().enabled).toBe(false);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/auth/sso/start' })).body).toContain('sso_error=unavailable');
    expect((await ctx.app.inject({ method: 'GET', url: '/scim/v2/Users' })).statusCode).toBe(404); // SCIM off without a token
    await ctx.close();
  });
});

describe('SCIM 2.0', () => {
  const scim = (ctx: TestCtx, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, body?: unknown, token = SCIM_TOKEN) =>
    ctx.app.inject({
      method,
      url: `/scim/v2${url}`,
      headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/scim+json' } : {}) },
      ...(body ? { payload: JSON.stringify(body) } : {}),
    });

  it('creates, finds, updates and deactivates users the way Entra ID does', async () => {
    const ctx = await setup({ SCIM_TOKEN });
    expect((await scim(ctx, 'GET', '/Users', undefined, 'wrong-token')).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: 'GET', url: '/scim/v2/Users' })).statusCode).toBe(401);
    expect((await scim(ctx, 'GET', '/ServiceProviderConfig')).json().patch.supported).toBe(true);

    const created = await scim(ctx, 'POST', '/Users', {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      userName: 'Avi@Unit.org',
      externalId: 'avi',
      active: true,
      displayName: 'אבי כהן',
      emails: [{ primary: true, type: 'work', value: 'Avi@Unit.org' }],
      name: { givenName: 'אבי', familyName: 'כהן' },
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.headers['content-type']).toContain('application/scim+json');
    const u = created.json();
    expect(u).toMatchObject({ userName: 'avi@unit.org', displayName: 'אבי כהן', active: true, externalId: 'avi' });
    expect((await scim(ctx, 'POST', '/Users', { userName: 'avi@unit.org' })).statusCode).toBe(409);
    expect((await scim(ctx, 'POST', '/Users', { userName: 'not-an-email' })).statusCode).toBe(400);

    const found = (await scim(ctx, 'GET', `/Users?filter=${encodeURIComponent('userName eq "avi@unit.org"')}`)).json();
    expect(found.totalResults).toBe(1);
    expect((await scim(ctx, 'GET', `/Users?filter=${encodeURIComponent('title co "x"')}`)).statusCode).toBe(400);

    // New user: member, SSO-only (no known password).
    const row = ctx.db.prepare('SELECT role, auth_source FROM users WHERE id = ?').get(u.id) as { role: string; auth_source: string };
    expect(row).toEqual({ role: 'member', auth_source: 'scim' });

    // Entra-style PATCH: capitalised op, string boolean.
    const sessionUser = await createUser(ctx, 'sess@unit.org', 'member');
    ctx.db.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at) VALUES ('s1', ?, ?, ?, ?)").run(sessionUser.id, new Date().toISOString(), new Date(Date.now() + 3600_000).toISOString(), new Date().toISOString());
    const patched = await scim(ctx, 'PATCH', `/Users/${sessionUser.id}`, {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [
        { op: 'Replace', path: 'displayName', value: 'שם חדש' },
        { op: 'Replace', path: 'active', value: 'False' },
      ],
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.json()).toMatchObject({ displayName: 'שם חדש', active: false, userName: 'sess@unit.org' });
    expect((ctx.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(sessionUser.id) as { n: number }).n).toBe(0);

    const put = await scim(ctx, 'PUT', `/Users/${u.id}`, { userName: 'avi.cohen@unit.org', displayName: 'אבי כ.', active: true });
    expect(put.json()).toMatchObject({ userName: 'avi.cohen@unit.org', displayName: 'אבי כ.' });
    expect((await scim(ctx, 'DELETE', `/Users/${u.id}`)).statusCode).toBe(204);
    expect((await scim(ctx, 'GET', `/Users/${u.id}`)).json().active).toBe(false); // deactivated, not deleted
    expect((await scim(ctx, 'GET', '/Users/does-not-exist')).statusCode).toBe(404);
    await ctx.close();
  });

  it('never deactivates the last active administrator', async () => {
    const ctx = await setup({ SCIM_TOKEN });
    const admin = await createUser(ctx, 'only-admin@unit.org', 'admin');
    const r = await scim(ctx, 'PATCH', `/Users/${admin.id}`, { Operations: [{ op: 'replace', value: { active: false } }] });
    expect(r.statusCode).toBe(400);
    expect(r.json().scimType).toBe('mutability');
    await ctx.close();
  });
});
