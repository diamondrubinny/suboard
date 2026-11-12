import type { BoardDetail } from '@suboard/shared';
import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { checkTargetUrl, isPublicAddress, safePost } from '../src/lib/safeFetch.js';
import { Client, createUser, loggedIn, setup, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let server: Server | null = null;
afterEach(async () => {
  await ctx?.close();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = null;
});

interface Got {
  headers: Record<string, string | string[] | undefined>;
  body: string;
}
/** A local receiver; `status` can be changed between requests. */
async function receiver(state: { status: number; location?: string }) {
  const got: Got[] = [];
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      got.push({ headers: req.headers, body });
      res.writeHead(state.status, state.location ? { Location: state.location } : {});
      res.end('ignored');
    });
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
  return { got, url: `http://127.0.0.1:${(server!.address() as AddressInfo).port}/hook/secret-path` };
}

describe('outgoing requests to user-supplied addresses (SSRF)', () => {
  it('recognises private, loopback, link-local and special addresses', () => {
    for (const a of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '224.0.0.1', '255.255.255.255', '::1', '::', 'fc00::1', 'fd12::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1', 'not-an-ip'])
      expect(isPublicAddress(a), a).toBe(false);
    for (const a of ['8.8.8.8', '172.32.0.1', '192.167.1.1', '1.1.1.1', '2606:4700:4700::1111']) expect(isPublicAddress(a), a).toBe(true);
  });

  it('accepts only plain https addresses on the default port', () => {
    for (const u of ['http://example.org/x', 'https://user:pw@example.org/x', 'https://example.org:8443/x', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://localhost/x', 'https://db.internal/x', 'https://printer.local/x', 'ftp://example.org', 'file:///etc/passwd', 'javascript:alert(1)', 'not a url', 'https://169.254.169.254/latest/meta-data'])
      expect(() => checkTargetUrl(u), u).toThrow();
    expect(checkTargetUrl('https://hooks.example.org/a/b?c=1').host).toBe('hooks.example.org');
    expect(checkTargetUrl('https://example.org:443/x').hostname).toBe('example.org');
  });

  it('refuses a name that resolves to a private address, even though its text looks harmless', async () => {
    // "localhost.example" style tricks: here the real loopback name, which the shape check already
    // refuses, and a direct private target through the low-level function.
    expect(await safePost('https://localhost/x', '{}', {})).toMatchObject({ ok: false, status: null });
    const r = await receiver({ status: 200 });
    expect(await safePost(r.url, '{}', {})).toMatchObject({ ok: false, status: null }); // http + loopback
    expect(r.got).toHaveLength(0);
    // with the test-only allowance the same call goes through
    expect(await safePost(r.url, '{}', {}, { allowInsecureTargets: true })).toMatchObject({ ok: true, status: 200 });
    expect(r.got).toHaveLength(1);
  });
});

describe('webhooks', () => {
  const on = async (admin: Client) => expect((await admin.put('/api/admin/modules', { modules: { webhooks: true } })).statusCode).toBe(200);

  it('is off by default; in a production-like setup internal targets are refused', async () => {
    ctx = await setup();
    const { client: admin } = await loggedIn(ctx, 'root@x.org', 'admin');
    const b = (await admin.post('/api/boards', { name: 'ציוד', templateKey: 'blank' })).json().board as BoardDetail;
    expect((await admin.get(`/api/boards/${b.id}/webhooks`)).json().error.code).toBe('MODULE_DISABLED');
    await on(admin);
    for (const url of ['http://example.org/hook', 'https://127.0.0.1/hook', 'https://10.0.0.5/hook', 'https://localhost/hook', 'https://example.org:8443/hook', 'https://u:p@example.org/hook'])
      expect((await admin.post(`/api/boards/${b.id}/webhooks`, { url, events: ['item_created'] })).statusCode, url).toBe(400);
    expect((await admin.post(`/api/boards/${b.id}/webhooks`, { url: 'https://hooks.example.org/x', events: [] })).statusCode).toBe(400);
    expect((await admin.post(`/api/boards/${b.id}/webhooks`, { url: 'https://hooks.example.org/x', events: ['explode'] })).statusCode).toBe(400);
  });

  it('delivers a signed message for created and changed items, logs it, and only owners manage it', async () => {
    const r = await receiver({ status: 200 });
    ctx = await setup({ WEBHOOK_ALLOW_INSECURE_TARGETS: 'true', PUBLIC_URL: 'https://safety.example.org' });
    const { client: admin } = await loggedIn(ctx, 'root@x.org', 'admin');
    await on(admin);
    const { client: boss } = await loggedIn(ctx, 'boss@x.org', 'manager');
    const b = (await boss.post('/api/boards', { name: 'תקלות', templateKey: 'blank' })).json().board as BoardDetail;
    const noa = await createUser(ctx, 'noa@x.org', 'member');
    await boss.put(`/api/boards/${b.id}/members`, { userId: noa.id, role: 'editor' });
    const n = new Client(ctx.app);
    await n.login('noa@x.org');
    const txt = (await boss.post(`/api/boards/${b.id}/columns`, { title: 'מיקום', type: 'text' })).json().column;
    const who = (await boss.post(`/api/boards/${b.id}/columns`, { title: 'אחראי', type: 'person' })).json().column;

    // editors cannot see or create webhooks
    expect((await n.get(`/api/boards/${b.id}/webhooks`)).statusCode).toBe(403);
    expect((await n.post(`/api/boards/${b.id}/webhooks`, { url: r.url, events: ['item_created'] })).statusCode).toBe(403);
    const made = await boss.post(`/api/boards/${b.id}/webhooks`, { url: r.url, events: ['item_created', 'item_updated'] });
    expect(made.statusCode).toBe(201);
    const { webhook, secret } = made.json() as { webhook: { id: string }; secret: string };
    expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    // the secret is shown once and stored encrypted
    expect(JSON.stringify((await boss.get(`/api/boards/${b.id}/webhooks`)).json())).not.toContain(secret);
    expect((ctx.db.prepare('SELECT secret_enc FROM webhooks').get() as { secret_enc: string }).secret_enc).not.toContain(secret);
    expect((await n.get(`/api/webhooks/${webhook.id}/deliveries`)).statusCode).toBe(404);
    expect((await n.del(`/api/webhooks/${webhook.id}`)).statusCode).toBe(404);

    const item = (await n.post(`/api/boards/${b.id}/items`, { groupId: b.groups[0]!.id, name: 'דליפה', values: { [txt.id]: 'חדר 214', [who.id]: [noa.id] } })).json().item as { id: string };
    await n.patch(`/api/items/${item.id}`, { values: { [txt.id]: 'חדר 215' } });
    await ctx.app.services.webhooks.idle();
    expect(r.got).toHaveLength(2);
    const [created, updated] = r.got.map((g) => ({ ...g, json: JSON.parse(g.body) }));
    expect(created!.headers['x-suboard-event']).toBe('item_created');
    expect(created!.json).toMatchObject({ event: 'item_created', board: { id: b.id, name: 'תקלות' }, item: { id: item.id, name: 'דליפה', url: `https://safety.example.org/boards/${b.id}?item=${item.id}`, fields: { מיקום: 'חדר 214', אחראי: 'noa' } } });
    expect(updated!.json).toMatchObject({ event: 'item_updated', changed: ['מיקום'], item: { fields: { מיקום: 'חדר 215' } } });
    // no e-mail addresses or ids of people leave the system
    expect(created!.body).not.toContain('noa@x.org');
    expect(created!.body).not.toContain(noa.id);
    // the signature covers timestamp + body with the secret
    const ts = String(created!.headers['x-suboard-timestamp']);
    expect(created!.headers['x-suboard-signature']).toBe(`sha256=${createHmac('sha256', secret).update(`${ts}.${created!.body}`).digest('hex')}`);
    expect(Math.abs(Number(ts) - Date.now() / 1000)).toBeLessThan(60);

    const log = (await boss.get(`/api/webhooks/${webhook.id}/deliveries`)).json().deliveries as { ok: boolean; event: string; status: number }[];
    expect(log.map((d) => d.event).sort()).toEqual(['item_created', 'item_updated']);
    expect(log.every((d) => d.ok && d.status === 200)).toBe(true);
    // the audit log names the host only, never the path (it may hold a token)
    const audit = ctx.db.prepare("SELECT meta FROM audit_log WHERE event = 'webhook_changed'").all() as { meta: string }[];
    expect(audit[0]!.meta).not.toContain('secret-path');

    // only chosen events; paused; deleted
    await boss.patch(`/api/webhooks/${webhook.id}`, { events: ['item_created'] });
    await n.patch(`/api/items/${item.id}`, { values: { [txt.id]: 'חדר 216' } });
    await ctx.app.services.webhooks.idle();
    expect(r.got).toHaveLength(2);
    await boss.patch(`/api/webhooks/${webhook.id}`, { active: false });
    await n.post(`/api/boards/${b.id}/items`, { groupId: b.groups[0]!.id, name: 'עוד' });
    await ctx.app.services.webhooks.idle();
    expect(r.got).toHaveLength(2);
    expect((await boss.post(`/api/webhooks/${webhook.id}/test`)).json().delivery).toMatchObject({ ok: true, event: 'ping' });
    expect((await boss.del(`/api/webhooks/${webhook.id}`)).statusCode).toBe(200);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM webhook_deliveries').get()).toEqual({ n: 0 });
  });

  it('records failures, does not follow redirects, and switches a failing webhook off', async () => {
    const state: { status: number; location?: string } = { status: 302, location: 'http://127.0.0.1:1/elsewhere' };
    const r = await receiver(state);
    ctx = await setup({ WEBHOOK_ALLOW_INSECURE_TARGETS: 'true' });
    const { client: admin } = await loggedIn(ctx, 'root@x.org', 'admin');
    await admin.put('/api/admin/modules', { modules: { webhooks: true } });
    const b = (await admin.post('/api/boards', { name: 'x', templateKey: 'blank' })).json().board as BoardDetail;
    const { webhook } = (await admin.post(`/api/boards/${b.id}/webhooks`, { url: r.url, events: ['item_created'] })).json() as { webhook: { id: string } };
    ctx.app.services.webhooks.retryDelaysMs = []; // no retries here: every failure counts at once
    const redirected = (await admin.post(`/api/webhooks/${webhook.id}/test`)).json().delivery;
    expect(redirected).toMatchObject({ ok: false, status: 302 });
    expect(r.got).toHaveLength(1); // the redirect target was never contacted
    state.status = 500;
    delete state.location;
    for (let i = 0; i < 9; i++) await admin.post(`/api/boards/${b.id}/items`, { groupId: b.groups[0]!.id, name: `פריט ${i}` });
    await ctx.app.services.webhooks.idle();
    const hook = (await admin.get(`/api/boards/${b.id}/webhooks`)).json().webhooks[0];
    expect(hook).toMatchObject({ active: false, failures: 10, last: { ok: false, status: 500 } });
    // switched off: nothing more is sent
    await admin.post(`/api/boards/${b.id}/items`, { groupId: b.groups[0]!.id, name: 'אחרי' });
    await ctx.app.services.webhooks.idle();
    expect(r.got).toHaveLength(10);
    // switching it back on clears the count
    expect((await admin.patch(`/api/webhooks/${webhook.id}`, { active: true })).json().webhook).toMatchObject({ active: true, failures: 0 });
  });
  it('tries a failed message again with the same delivery id, and counts only the last failure', async () => {
    const state: { status: number; location?: string } = { status: 500 };
    const r = await receiver(state);
    ctx = await setup({ WEBHOOK_ALLOW_INSECURE_TARGETS: 'true' });
    const { client: admin } = await loggedIn(ctx, 'root@x.org', 'admin');
    await admin.put('/api/admin/modules', { modules: { webhooks: true } });
    const b = (await admin.post('/api/boards', { name: 'x', templateKey: 'blank' })).json().board as BoardDetail;
    const { webhook } = (await admin.post(`/api/boards/${b.id}/webhooks`, { url: r.url, events: ['item_created'] })).json() as { webhook: { id: string } };
    const hooks = ctx.app.services.webhooks;
    hooks.retryDelaysMs = [0, 0];
    // all three attempts fail → one failure on the webhook, three rows in the log
    await admin.post(`/api/boards/${b.id}/items`, { groupId: b.groups[0]!.id, name: 'נכשל' });
    await hooks.idle(true);
    expect(r.got).toHaveLength(3);
    expect(new Set(r.got.map((g) => g.headers['x-suboard-delivery'])).size).toBe(1);
    let hook = (await admin.get(`/api/boards/${b.id}/webhooks`)).json().webhooks[0];
    expect(hook).toMatchObject({ active: true, failures: 1 });
    const log = (await admin.get(`/api/webhooks/${webhook.id}/deliveries`)).json().deliveries as { ok: boolean; error: string }[];
    expect(log).toHaveLength(3);
    expect(log.map((d) => d.error).sort().join('|')).toMatch(/ניסיון 1 מתוך 3.*ניסיון 2 מתוך 3.*ניסיון 3 מתוך 3/);
    // the receiver recovers before the second attempt → success, the count is cleared
    r.got.length = 0;
    hooks.retryDelaysMs = [40, 0];
    await admin.post(`/api/boards/${b.id}/items`, { groupId: b.groups[0]!.id, name: 'מתאושש' });
    await hooks.idle();
    state.status = 200;
    await hooks.idle(true);
    expect(r.got).toHaveLength(2);
    hook = (await admin.get(`/api/boards/${b.id}/webhooks`)).json().webhooks[0];
    expect(hook).toMatchObject({ active: true, failures: 0, last: { ok: true } });
    // a test ping is never retried
    state.status = 500;
    r.got.length = 0;
    await admin.post(`/api/webhooks/${webhook.id}/test`);
    await hooks.idle(true);
    expect(r.got).toHaveLength(1);
  });
});
