import type { BoardDetail } from '@suboard/shared';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ClamdScanner } from '../src/lib/clamav.js';
import { totp } from '../src/lib/totp.js';
import { files, startFakeClamd, TEST_MALWARE_MARKER } from './fakes.js';
import { Client, loggedIn, PASSWORD, setup, type TestCtx } from './helpers.js';

let ctx: TestCtx;
const cleanups: (() => void)[] = [];
afterEach(async () => {
  await ctx.close();
  cleanups.splice(0).forEach((f) => f());
});

/** Creates manager + editor + outsider and a CAPA board where the editor is a member. */
async function boardFixture() {
  const m = await loggedIn(ctx, 'manager@x.org', 'manager');
  const e = await loggedIn(ctx, 'editor@x.org', 'member');
  const o = await loggedIn(ctx, 'outsider@x.org', 'member');
  const board = (await m.client.post('/api/boards', { name: 'פעולות מתקנות', templateKey: 'capa' })).json().board as BoardDetail;
  await m.client.put(`/api/boards/${board.id}/members`, { userId: e.user.id, role: 'editor' });
  const col = (t: string) => board.columns.find((c) => c.title === t)!.id;
  const item = (await m.client.post(`/api/boards/${board.id}/items`, { groupId: board.groups[0]!.id, name: 'החלפת אטם' })).json().item;
  return { m, e, o, board, col, item };
}

// ============================================================================ MFA
describe('MFA (TOTP)', () => {
  async function enrol(client: Client) {
    const setupRes = await client.post('/api/auth/mfa/setup');
    expect(setupRes.statusCode).toBe(200);
    const { secret, qrSvg, otpauthUri } = setupRes.json();
    expect(qrSvg).toContain('<svg');
    expect(otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    expect((await client.post('/api/auth/mfa/enable', { code: '000000' })).statusCode).toBe(400);
    const usedCode = totp(secret);
    const res = await client.post('/api/auth/mfa/enable', { code: usedCode });
    expect(res.statusCode, res.body).toBe(200);
    return { secret: secret as string, usedCode, recoveryCodes: res.json().recoveryCodes as string[] };
  }

  it('requires a second factor after enrolment; codes cannot be replayed', async () => {
    ctx = await setup();
    const { client } = await loggedIn(ctx, 'a@x.org', 'member');
    const { secret, usedCode, recoveryCodes } = await enrol(client);
    expect(recoveryCodes).toHaveLength(10);
    // The secret is stored encrypted, never in plain text.
    const stored = ctx.db.prepare('SELECT mfa_secret_enc FROM users WHERE email = ?').get('a@x.org') as { mfa_secret_enc: string };
    expect(stored.mfa_secret_enc).not.toContain(secret);

    const c2 = new Client(ctx.app);
    const step1 = await c2.post('/api/auth/login', { email: 'a@x.org', password: PASSWORD });
    expect(step1.json().mfaRequired).toBe(true);
    expect(c2.token).toBeNull(); // no session before the second factor
    const challengeToken = step1.json().challengeToken;

    expect((await c2.post('/api/auth/mfa/verify', { challengeToken, code: '123456' })).statusCode).toBe(401);
    // Complete with a recovery code (a fresh TOTP would require waiting for the next 30s step).
    const ok = await c2.post('/api/auth/mfa/verify', { challengeToken, code: recoveryCodes[0] });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(c2.token).not.toBeNull();
    expect((await c2.get('/api/boards')).statusCode).toBe(200);

    const c3 = new Client(ctx.app);
    const t3 = (await c3.post('/api/auth/login', { email: 'a@x.org', password: PASSWORD })).json().challengeToken;
    expect((await c3.post('/api/auth/mfa/verify', { challengeToken: t3, code: recoveryCodes[0] })).statusCode).toBe(401); // used
    expect((await c3.post('/api/auth/mfa/verify', { challengeToken: t3, code: usedCode })).statusCode).toBe(401); // replayed TOTP
  });

  it('limits attempts per challenge', async () => {
    ctx = await setup();
    const { client } = await loggedIn(ctx, 'a@x.org', 'member');
    const { recoveryCodes } = await enrol(client);
    const c = new Client(ctx.app);
    const token = (await c.post('/api/auth/login', { email: 'a@x.org', password: PASSWORD })).json().challengeToken;
    for (let i = 0; i < 5; i++) await c.post('/api/auth/mfa/verify', { challengeToken: token, code: '111111' });
    const res = await c.post('/api/auth/mfa/verify', { challengeToken: token, code: recoveryCodes[1] });
    expect(res.json().error.code).toBe('MFA_CHALLENGE_EXPIRED');
  });

  it('forces enrolment for required roles and lets an admin reset a lost device', async () => {
    ctx = await setup({ MFA_REQUIRED_ROLES: 'admin' });
    const { client: admin } = await loggedIn(ctx, 'admin@x.org', 'admin');
    const blocked = await admin.get('/api/boards');
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('MFA_SETUP_REQUIRED');
    expect((await admin.get('/api/auth/me')).json().user.mfaSetupRequired).toBe(true);
    await enrol(admin);
    expect((await admin.get('/api/boards')).statusCode).toBe(200);

    const { user: u, client: uc } = await loggedIn(ctx, 'u@x.org', 'member');
    await enrol(uc);
    expect((await uc.post(`/api/users/${u.id}/reset-mfa`)).statusCode).toBe(403);
    const reset = await admin.post(`/api/users/${u.id}/reset-mfa`);
    expect(reset.json().user.mfaEnabled).toBe(false);
    expect((await uc.get('/api/boards')).statusCode).toBe(401); // sessions revoked
    expect(ctx.app.services.audit.list({ event: 'mfa_reset' })).toHaveLength(1);
  });

  it('disabling requires password and a valid code', async () => {
    ctx = await setup();
    const { client } = await loggedIn(ctx, 'a@x.org', 'member');
    const { recoveryCodes } = await enrol(client);
    expect((await client.post('/api/auth/mfa/disable', { password: 'wrong-password-1', code: recoveryCodes[0] })).statusCode).toBe(400);
    const ok = await client.post('/api/auth/mfa/disable', { password: PASSWORD, code: recoveryCodes[1] });
    expect(ok.json().user.mfaEnabled).toBe(false);
  });
});

// ============================================================================ notifications
describe('notifications', () => {
  it('notifies new assignees (not the actor), in-app and by e-mail with escaped content', async () => {
    ctx = await setup();
    const { m, e, o, board, col, item } = await boardFixture();
    await m.client.patch(`/api/items/${item.id}`, { name: '<b>אטם</b> & מנדף' });
    const res = await m.client.patch(`/api/items/${item.id}`, { values: { [col('אחראי ביצוע')]: [e.user.id, m.user.id] } });
    expect(res.statusCode, res.body).toBe(200);

    const mine = (await e.client.get('/api/notifications')).json();
    expect(mine.unread).toBe(1);
    expect(mine.notifications[0]).toMatchObject({ kind: 'assigned', itemId: item.id, boardId: board.id, actorName: 'manager' });
    expect((await m.client.get('/api/notifications')).json().unread).toBe(0); // no self-notification

    await new Promise((r) => setTimeout(r, 20));
    expect(ctx.mailer.sent).toHaveLength(1);
    expect(ctx.mailer.sent[0]!.to).toBe('editor@x.org');
    expect(ctx.mailer.sent[0]!.html).toContain('&lt;b&gt;אטם&lt;/b&gt; &amp; מנדף');
    expect(ctx.mailer.sent[0]!.html).not.toContain('<b>אטם');

    // Re-saving the same assignee does not notify again.
    await m.client.patch(`/api/items/${item.id}`, { values: { [col('אחראי ביצוע')]: [e.user.id] } });
    expect((await e.client.get('/api/notifications')).json().unread).toBe(1);

    // Users only ever see / mark their own notifications.
    const nid = mine.notifications[0].id;
    await o.client.post('/api/notifications/read', { ids: [nid] });
    expect((await e.client.get('/api/notifications')).json().unread).toBe(1);
    await e.client.post('/api/notifications/read', { all: true });
    expect((await e.client.get('/api/notifications')).json().unread).toBe(0);
  });

  it('only board members (or admins) can be assigned', async () => {
    ctx = await setup();
    const { m, o, col, item } = await boardFixture();
    const res = await m.client.patch(`/api/items/${item.id}`, { values: { [col('אחראי ביצוע')]: [o.user.id] } });
    expect(res.statusCode).toBe(400);
  });

  it('respects the e-mail opt-out', async () => {
    ctx = await setup();
    const { m, e, col, item } = await boardFixture();
    expect((await e.client.patch('/api/auth/preferences', { emailNotifications: false })).json().user.emailNotifications).toBe(false);
    await m.client.patch(`/api/items/${item.id}`, { values: { [col('אחראי ביצוע')]: [e.user.id] } });
    await new Promise((r) => setTimeout(r, 20));
    expect(ctx.mailer.sent).toHaveLength(0);
    expect((await e.client.get('/api/notifications')).json().unread).toBe(1);
  });

  it('daily reminders: overdue / due tomorrow, once per day, with a digest e-mail', async () => {
    ctx = await setup({ DIGEST_HOUR: '7' });
    const { m, e, board, col } = await boardFixture();
    const mk = (name: string, due: string, status = 'open') =>
      m.client.post(`/api/boards/${board.id}/items`, {
        groupId: board.groups[0]!.id,
        name,
        values: { [col('אחראי ביצוע')]: [e.user.id], [col('תאריך יעד')]: due, [col('סטטוס')]: status },
      });
    await mk('באיחור', '2026-03-01');
    await mk('מחר', '2026-03-11');
    await mk('סגור', '2026-03-01', 'done');
    await mk('רחוק', '2026-04-01');
    ctx.mailer.sent.length = 0;
    await e.client.post('/api/notifications/read', { all: true });

    const svc = ctx.app.services.notifications;
    expect(await svc.runDailyReminders(new Date('2026-03-10T03:00:00Z'))).toBe(0); // 05:00 local < DIGEST_HOUR
    expect(await svc.runDailyReminders(new Date('2026-03-10T08:00:00Z'))).toBe(2);
    expect(await svc.runDailyReminders(new Date('2026-03-10T09:00:00Z'))).toBe(0); // already ran today

    const kinds = (await e.client.get('/api/notifications')).json().notifications.filter((n: { read: boolean }) => !n.read).map((n: { kind: string; title: string }) => `${n.kind}:${n.title}`);
    expect(kinds.sort()).toEqual(['due_tomorrow:מחר', 'overdue:באיחור']);
    expect(ctx.mailer.sent).toHaveLength(1);
    expect(ctx.mailer.sent[0]!.subject).toContain('2');
  });
});

// ============================================================================ attachments
describe('attachments', () => {
  async function withScanner() {
    const clamd = await startFakeClamd();
    cleanups.push(() => clamd.server.close());
    ctx = await setup({}, { scanner: new ClamdScanner({ host: '127.0.0.1', port: clamd.port, timeoutMs: 5000 }) });
    return clamd;
  }

  it('accepts a clean allowed file and serves it with safe headers', async () => {
    const clamd = await withScanner();
    const { e, o, item } = await boardFixture();
    const up = await e.client.upload(`/api/items/${item.id}/attachments`, 'דוח בדיקה.pdf', files.pdf);
    expect(up.statusCode, up.body).toBe(201);
    const att = up.json().attachment;
    expect(att).toMatchObject({ status: 'clean', mime: 'application/pdf', originalName: 'דוח בדיקה.pdf' });
    expect(clamd.scans).toHaveLength(1);
    expect(readdirSync(join(ctx.uploadDir, 'store'))).toEqual([att.id]);

    const dl = await e.client.get(`/api/attachments/${att.id}/download`);
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-disposition']).toMatch(/^attachment;/);
    expect(dl.headers['content-security-policy']).toContain('sandbox');
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect(dl.rawPayload.equals(files.pdf)).toBe(true);

    expect((await o.client.get(`/api/attachments/${att.id}/download`)).statusCode).toBe(404);
    expect((await o.client.get(`/api/items/${item.id}/attachments`)).statusCode).toBe(404);
  });

  it('blocks malware: file deleted, never downloadable, security event logged', async () => {
    await withScanner();
    const { e, item } = await boardFixture();
    const infected = Buffer.concat([files.pdf, Buffer.from(TEST_MALWARE_MARKER)]);
    const att = (await e.client.upload(`/api/items/${item.id}/attachments`, 'x.pdf', infected)).json().attachment;
    expect(att.status).toBe('infected');
    expect(readdirSync(join(ctx.uploadDir, 'quarantine'))).toHaveLength(0);
    expect(readdirSync(join(ctx.uploadDir, 'store'))).toHaveLength(0);
    expect((await e.client.get(`/api/attachments/${att.id}/download`)).statusCode).toBe(409);
    expect(ctx.app.services.audit.list({ event: 'malware_detected' })).toHaveLength(1);
  });

  it('fails closed without a scanner: file stays quarantined and is not downloadable', async () => {
    ctx = await setup(); // scanner: null
    const { e, item } = await boardFixture();
    const att = (await e.client.upload(`/api/items/${item.id}/attachments`, 'a.png', files.png)).json().attachment;
    expect(att.status).toBe('pending');
    expect(existsSync(join(ctx.uploadDir, 'quarantine', att.id))).toBe(true);
    expect((await e.client.get(`/api/attachments/${att.id}/download`)).statusCode).toBe(409);
  });

  it('rejects disallowed or spoofed types and oversize files', async () => {
    await withScanner();
    const { e, item } = await boardFixture();
    const url = `/api/items/${item.id}/attachments`;
    expect((await e.client.upload(url, 'setup.pdf', files.exe)).statusCode).toBe(415);
    expect((await e.client.upload(url, 'page.html', files.html)).statusCode).toBe(415);
    expect((await e.client.upload(url, 'image.png', files.pdf)).statusCode).toBe(415); // extension mismatch
    expect(ctx.app.services.audit.list({ event: 'upload_rejected' })).toHaveLength(3);
    await ctx.close();

    ctx = await setup({ MAX_UPLOAD_MB: '1' });
    const f = await boardFixture();
    const big = Buffer.concat([files.pdf, Buffer.alloc(1.5 * 1024 * 1024)]);
    expect((await f.e.client.upload(`/api/items/${f.item.id}/attachments`, 'big.pdf', big)).statusCode).toBe(413);
  });

  it('enforces permissions: viewers cannot upload; only uploader or owner may delete', async () => {
    await withScanner();
    const { m, e, board, item } = await boardFixture();
    const v = await loggedIn(ctx, 'viewer@x.org', 'member');
    await m.client.put(`/api/boards/${board.id}/members`, { userId: v.user.id, role: 'viewer' });
    expect((await v.client.upload(`/api/items/${item.id}/attachments`, 'a.png', files.png)).statusCode).toBe(403);

    const att = (await m.client.upload(`/api/items/${item.id}/attachments`, 'a.png', files.png)).json().attachment;
    expect((await e.client.del(`/api/attachments/${att.id}`)).statusCode).toBe(403);
    expect((await m.client.del(`/api/attachments/${att.id}`)).statusCode).toBe(200);
    expect(readdirSync(join(ctx.uploadDir, 'store'))).toHaveLength(0);
  });

  it('removes orphaned files after an item is deleted', async () => {
    await withScanner();
    const { m, item } = await boardFixture();
    await m.client.upload(`/api/items/${item.id}/attachments`, 'a.png', files.png);
    await m.client.del(`/api/items/${item.id}`);
    expect(ctx.app.services.attachments.sweepOrphans()).toBe(1);
    expect(readdirSync(join(ctx.uploadDir, 'store'))).toHaveLength(0);
  });
});

// ============================================================================ export
describe('CSV export', () => {
  it('exports readable values with BOM, neutralises formulas, and is access-controlled', async () => {
    ctx = await setup();
    const { m, e, o, board, col, item } = await boardFixture();
    await m.client.patch(`/api/items/${item.id}`, {
      name: '=HYPERLINK("http://evil")',
      values: { [col('סטטוס')]: 'in_progress', [col('אחראי ביצוע')]: [e.user.id], [col('תאריך יעד')]: '2026-12-31' },
    });
    const res = await e.client.get(`/api/boards/${board.id}/export.csv`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body.charCodeAt(0)).toBe(0xfeff);
    const [header, row] = res.body.slice(1).split('\r\n');
    expect(header).toContain('פריט');
    expect(row).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(row).toContain('בטיפול');
    expect(row).toContain('editor');
    expect(row).toContain('31/12/2026');
    expect((await o.client.get(`/api/boards/${board.id}/export.csv`)).statusCode).toBe(404);
    expect(ctx.app.services.audit.list({ event: 'data_export' })).toHaveLength(1);
  });
});
