import { afterEach, describe, expect, it } from 'vitest';
import { basePathOf } from '../src/config.js';
import { Client, createUser, PASSWORD, setup, type TestCtx } from './helpers.js';

let ctx: TestCtx;
afterEach(async () => ctx?.close());

describe('serving under a folder (PUBLIC_URL with a path)', () => {
  it('derives the folder from PUBLIC_URL', () => {
    expect(basePathOf('https://dreadlist.com/test')).toBe('/test');
    expect(basePathOf('https://dreadlist.com/test/')).toBe('/test');
    expect(basePathOf('https://dreadlist.com/a/b')).toBe('/a/b');
    expect(basePathOf('https://dreadlist.com')).toBe('');
    expect(basePathOf('https://dreadlist.com/bad path')).toBe('');
    expect(basePathOf('not a url')).toBe('');
  });

  it('answers with and without the prefix, scopes cookies to the folder, sets noindex', async () => {
    ctx = await setup({ PUBLIC_URL: 'http://localhost:5173/test', NOINDEX: 'true' });
    await createUser(ctx, 'm@x.org', 'manager');
    const c = new Client(ctx.app);
    // prefixed (proxy passes the full path)
    const res = await c.req('POST', '/test/api/auth/login', { email: 'm@x.org', password: PASSWORD });
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((x) => x.name === 'sb_session')!;
    expect(cookie.path).toBe('/test');
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect((await c.get('/test/api/auth/me')).statusCode).toBe(200);
    // stripped by the proxy
    expect((await c.get('/api/auth/me')).statusCode).toBe(200);
    // a sibling path is not the app's folder
    expect((await c.get('/testing/api/auth/me')).statusCode).toBe(404);
    // SSO hop pages point inside the folder
    const hop = await c.get('/test/api/auth/sso/start');
    expect(hop.body).toContain('url=/test/login?sso_error=unavailable');
    // logout clears the folder-scoped cookie
    const out = await c.post('/test/api/auth/logout');
    expect(out.cookies.find((x) => x.name === 'sb_session')?.path).toBe('/test');
  });

  it('is unchanged at the root', async () => {
    ctx = await setup();
    await createUser(ctx, 'm@x.org', 'manager');
    const res = await new Client(ctx.app).req('POST', '/api/auth/login', { email: 'm@x.org', password: PASSWORD });
    expect(res.cookies.find((x) => x.name === 'sb_session')!.path).toBe('/');
    expect(res.headers['x-robots-tag']).toBeUndefined();
  });
});
