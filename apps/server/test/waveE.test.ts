import { addDaysIso, todayIso, type BoardDetail } from '@suboard/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loggedIn, setup, type Client, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let m: Client; // manager
let a: Client; // admin
let e: Client; // member
let o: Client; // another member
let ids: Record<'m' | 'a' | 'e' | 'o', string>;
const today = () => todayIso('Asia/Jerusalem');
const hours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

beforeEach(async () => {
  ctx = await setup();
  const mm = await loggedIn(ctx, 'manager@x.org', 'manager');
  const aa = await loggedIn(ctx, 'admin@x.org', 'admin');
  const ee = await loggedIn(ctx, 'editor@x.org', 'member');
  const oo = await loggedIn(ctx, 'other@x.org', 'member');
  [m, a, e, o] = [mm.client, aa.client, ee.client, oo.client];
  ids = { m: mm.user.id, a: aa.user.id, e: ee.user.id, o: oo.user.id };
});
afterEach(async () => ctx.close());

describe('E1 training matrix', () => {
  it('managers manage; members see only their own; states and reminders', async () => {
    expect((await e.post('/api/trainings', { name: 'x' })).statusCode).toBe(403);
    expect((await e.get('/api/trainings/matrix')).statusCode).toBe(403);
    const fire = (await m.post('/api/trainings', { name: 'כיבוי אש', validityMonths: 12 })).json().training;
    const chem = (await m.post('/api/trainings', { name: 'חומרים מסוכנים', validityMonths: 24, allUsers: true })).json().training;
    await m.put(`/api/trainings/${fire.id}/requirements`, { userIds: [ids.e] });
    // e: fire done 11.5 months ago → expires within 30 days; o: chem done 3 years ago → expired.
    const elevenAndHalf = addDaysIso(today(), -350);
    expect((await m.post(`/api/trainings/${fire.id}/records`, { userIds: [ids.e], completedOn: elevenAndHalf })).statusCode).toBe(201);
    await m.post(`/api/trainings/${chem.id}/records`, { userIds: [ids.o], completedOn: addDaysIso(today(), -3 * 365) });
    expect((await m.post(`/api/trainings/${fire.id}/records`, { userIds: [ids.e], completedOn: addDaysIso(today(), 2) })).statusCode).toBe(400);

    const mx = (await m.get('/api/trainings/matrix')).json().matrix;
    const row = (name: string) => mx.users.find((u: { name: string }) => u.name === name);
    expect(row('editor').cells[fire.id].state).toBe('expiring');
    expect(row('editor').cells[chem.id].state).toBe('missing');
    expect(row('other').cells[fire.id].state).toBe('not_required');
    expect(row('other').cells[chem.id].state).toBe('expired');
    expect(mx.totals[chem.id]).toMatchObject({ required: 4, expired: 1, missing: 3 });

    const mine = (await e.get('/api/me/trainings')).json().trainings;
    expect(mine.map((t: { training: { name: string } }) => t.training.name).sort()).toEqual(['חומרים מסוכנים', 'כיבוי אש']);
    expect(mine.every((t: { training: { requiredUserIds: string[] } }) => t.training.requiredUserIds.length === 0)).toBe(true);

    const csv = await m.get('/api/trainings/matrix.csv');
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('פג בקרוב');

    expect(ctx.app.services.trainings.runReminders(new Date(), true)).toBe(2); // e (soon) + o (expired)
    expect(ctx.app.services.trainings.runReminders(new Date(), true)).toBe(0); // once each
    expect((await e.get('/api/notifications')).json().notifications.some((n: { kind: string }) => n.kind === 'training')).toBe(true);
  });
});

describe('E2 work permits (removed)', () => {
  it('the module is gone: no routes, no tables', async () => {
    expect((await m.get('/api/permits')).statusCode).toBe(404);
    expect((await m.post('/api/permits', {})).statusCode).toBe(404);
    const tables = (ctx.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'permit%'").all() as { name: string }[]).map((t) => t.name);
    expect(tables).toEqual([]);
    expect((await m.get('/api/templates')).json().templates.some((t: { key: string }) => t.key === 'permits')).toBe(false);
  });
});

describe('E4 procedures', () => {
  it('versions require re-acknowledgement by the audience only', async () => {
    expect((await e.post('/api/procedures', { code: 'NB-01', title: 'x' })).statusCode).toBe(403);
    const p = (await m.post('/api/procedures', { code: 'NB-01', title: 'עבודה בחום', audience: 'users', userIds: [ids.e] })).json().procedure;
    expect((await m.post('/api/procedures', { code: 'nb-01', title: 'כפול' })).statusCode).toBe(400);
    expect((await e.get(`/api/procedures/${p.id}`)).statusCode).toBe(404); // nothing published yet
    expect((await m.post(`/api/procedures/${p.id}/versions`, { version: '1.0', effectiveOn: today() })).statusCode).toBe(400); // no body / link
    expect((await m.post(`/api/procedures/${p.id}/versions`, { version: '1.0', effectiveOn: today(), body: 'סעיף 1', link: 'javascript:alert(1)' })).statusCode).toBe(400);
    const v1 = (await m.post(`/api/procedures/${p.id}/versions`, { version: '1.0', effectiveOn: today(), body: 'סעיף 1' })).json().procedure;
    expect((await e.get('/api/me/procedures')).json().procedures).toHaveLength(1);
    expect((await o.get(`/api/procedures/${p.id}`)).statusCode).toBe(404); // not in the audience
    expect((await o.post(`/api/procedure-versions/${v1.current.id}/ack`, {})).statusCode).toBe(404);
    expect((await e.post(`/api/procedure-versions/${v1.current.id}/ack`, {})).json().procedure.myAckAt).not.toBeNull();
    expect((await m.get(`/api/procedures/${p.id}/acks`)).json().report.acked).toHaveLength(1);

    const v2 = (await m.post(`/api/procedures/${p.id}/versions`, { version: '1.1', effectiveOn: today(), summary: 'עודכן', body: 'סעיף 1 + 2' })).json().procedure;
    expect((await e.get('/api/me/procedures')).json().procedures).toHaveLength(1); // must acknowledge again
    expect((await e.post(`/api/procedure-versions/${v1.current.id}/ack`, {})).statusCode).toBe(400); // old version
    expect((await m.get(`/api/procedures/${p.id}/acks`)).json().report.pending.map((x: { name: string }) => x.name)).toEqual(['editor']);
    await e.post(`/api/procedure-versions/${v2.current.id}/ack`, {});
    expect((await e.get('/api/me/procedures')).json().procedures).toHaveLength(0);
    expect((await e.get('/api/notifications')).json().notifications.filter((n: { kind: string }) => n.kind === 'procedure')).toHaveLength(2);
  });
});

describe('E5 floor-plan pins', () => {
  it('only clean images, only items of the same board, editor rights', async () => {
    const board = (await m.post('/api/boards', { name: 'מפגעים', templateKey: 'hazards' })).json().board as BoardDetail;
    const other = (await m.post('/api/boards', { name: 'אחר', templateKey: 'hazards' })).json().board as BoardDetail;
    await m.put(`/api/boards/${board.id}/members`, { userId: ids.e, role: 'viewer' });
    const mk = async (b: BoardDetail, name: string) => (await m.post(`/api/boards/${b.id}/items`, { groupId: b.groups[0]!.id, name })).json().item.id as string;
    const planItem = await mk(board, 'קומה 2');
    const hazard = await mk(board, 'כבל חשוף');
    const foreign = await mk(other, 'זר');
    // Insert a clean PNG attachment directly (the upload + scan pipeline is covered elsewhere).
    const attId = '11111111-2222-4333-8444-555555555555';
    ctx.db
      .prepare("INSERT INTO attachments (id, item_id, board_id, uploaded_by, original_name, mime, size, sha256, status, created_at) VALUES (?, ?, ?, ?, 'plan.png', 'image/png', 10, 'x', 'clean', ?)")
      .run(attId, planItem, board.id, ids.m, new Date().toISOString());
    expect((await m.get(`/api/boards/${board.id}/plans`)).json().plans).toHaveLength(1);
    expect((await m.put(`/api/attachments/${attId}/pins`, { pins: [{ itemId: foreign, x: 1, y: 1 }] })).statusCode).toBe(400);
    expect((await m.put(`/api/attachments/${attId}/pins`, { pins: [{ itemId: hazard, x: 101, y: 1 }] })).statusCode).toBe(400);
    expect((await e.put(`/api/attachments/${attId}/pins`, { pins: [] })).statusCode).toBe(403);
    expect((await o.get(`/api/attachments/${attId}/pins`)).statusCode).toBe(404);
    const ok = await m.put(`/api/attachments/${attId}/pins`, { pins: [{ itemId: hazard, x: 42.123, y: 57 }] });
    expect(ok.json().pins).toEqual([{ itemId: hazard, x: 42.12, y: 57 }]);
    expect((await e.get(`/api/attachments/${attId}/pins`)).json().pins).toHaveLength(1);
    ctx.db.prepare("UPDATE attachments SET status = 'pending' WHERE id = ?").run(attId);
    expect((await m.get(`/api/attachments/${attId}/pins`)).statusCode).toBe(400);
  });
});
