import { addDaysIso, todayIso, type BoardDetail } from '@suboard/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loggedIn, setup, type Client, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let m: Client; // manager — owns both boards
let e: Client; // member, editor on A only
let o: Client; // member without boards
let ids: Record<'m' | 'e' | 'o', string>;
let a: BoardDetail; // CAPA board shared with e
let b: BoardDetail; // CAPA board private to m
const today = () => todayIso('Asia/Jerusalem');
const col = (bd: BoardDetail, t: string) => bd.columns.find((c) => c.title === t)!;
const wid = (n: number) => `w${String(n).padStart(4, '0')}`;

beforeEach(async () => {
  ctx = await setup();
  const mm = await loggedIn(ctx, 'manager@x.org', 'manager');
  const ee = await loggedIn(ctx, 'editor@x.org', 'member');
  const oo = await loggedIn(ctx, 'outsider@x.org', 'member');
  [m, e, o] = [mm.client, ee.client, oo.client];
  ids = { m: mm.user.id, e: ee.user.id, o: oo.user.id };
  a = (await m.post('/api/boards', { name: 'לוח א', templateKey: 'capa' })).json().board;
  b = (await m.post('/api/boards', { name: 'לוח ב', templateKey: 'capa' })).json().board;
  await m.put(`/api/boards/${a.id}/members`, { userId: ids.e, role: 'editor' });
});
afterEach(async () => ctx.close());

const add = async (bd: BoardDetail, name: string, values: Record<string, unknown> = {}) => {
  const r = await m.post(`/api/boards/${bd.id}/items`, { groupId: bd.groups[0]!.id, name, values });
  expect(r.statusCode, r.body).toBe(201);
  return r.json().item as { id: string };
};

describe('D1 dashboards', () => {
  it('private by default; sharing needs a manager; shared data is computed per viewer', async () => {
    const count = { id: wid(1), type: 'count', metric: 'open', boardIds: [a.id, b.id] };
    expect((await e.post('/api/dashboards', { name: 'שלי', widgets: [count] })).statusCode).toBe(400); // e cannot see b
    const mine = await e.post('/api/dashboards', { name: 'שלי', widgets: [{ ...count, boardIds: [a.id] }] });
    expect(mine.statusCode, mine.body).toBe(201);
    expect((await o.get(`/api/dashboards/${mine.json().dashboard.id}`)).statusCode).toBe(404);
    expect((await e.post('/api/dashboards', { name: 'משותף', shared: true })).statusCode).toBe(403);

    await add(a, 'א1');
    await add(a, 'א2');
    await add(b, 'ב1');
    const shared = await m.post('/api/dashboards', {
      name: 'הנהלה',
      shared: true,
      widgets: [count, { id: wid(2), type: 'status', boardId: b.id }, { id: wid(3), type: 'overdue', boardIds: [] }],
    });
    expect(shared.statusCode, shared.body).toBe(201);
    const id = shared.json().dashboard.id;

    const mData = (await m.get(`/api/dashboards/${id}/data`)).json().data;
    expect(mData[wid(1)]).toMatchObject({ type: 'count', value: 3, boards: 2 });
    const eData = (await e.get(`/api/dashboards/${id}/data`)).json().data;
    expect(eData[wid(1)]).toMatchObject({ type: 'count', value: 2, boards: 1 }); // board b is never counted
    expect(eData[wid(2)].type).toBe('empty'); // and never named
    expect(JSON.stringify(eData)).not.toContain('לוח ב');
    const oData = (await o.get(`/api/dashboards/${id}/data`)).json().data;
    expect(oData[wid(1)].type).toBe('empty');

    expect((await e.patch(`/api/dashboards/${id}`, { name: 'x' })).statusCode).toBe(403);
    expect((await e.get('/api/dashboards')).json().dashboards.map((d: { name: string }) => d.name).sort()).toEqual(['הנהלה', 'שלי']);
    expect((await m.del(`/api/dashboards/${id}`)).statusCode).toBe(200);
  });
});

describe('D2 trends and workload', () => {
  it('counts created / closed per month and the average days to close', async () => {
    const st = col(a, 'סטטוס');
    const x = await add(a, 'ישן');
    const y = await add(a, 'חדש');
    // x was created 10 days ago and closed today; y is still open.
    ctx.db.prepare('UPDATE items SET created_at = ? WHERE id = ?').run(new Date(Date.now() - 10 * 86_400_000).toISOString(), x.id);
    await m.patch(`/api/items/${x.id}`, { values: { [st.id]: 'done' } });
    await m.patch(`/api/items/${y.id}`, { values: { [st.id]: 'in_progress' } });
    const pts = (await m.get(`/api/analytics/trend?boards=${a.id}&period=week&count=3`)).json().points;
    expect(pts).toHaveLength(3);
    const last = pts[2];
    expect(last.closed).toBe(1);
    expect(last.avgCloseDays).toBeGreaterThanOrEqual(9);
    expect(pts.reduce((s: number, p: { created: number }) => s + p.created, 0)).toBe(2);
    // Boards outside the viewer's access are silently dropped.
    const eo = (await o.get(`/api/analytics/trend?boards=${a.id}`)).json().points;
    expect(eo.every((p: { created: number }) => p.created === 0)).toBe(true);
    expect((await m.get('/api/analytics/trend?boards=not-a-uuid')).statusCode).toBe(400);
  });

  it('workload per person from visible boards only', async () => {
    const person = col(a, 'אחראי ביצוע').id;
    const due = col(a, 'תאריך יעד').id;
    await add(a, 'באיחור', { [person]: [ids.e], [due]: addDaysIso(today(), -2) });
    await add(a, 'השבוע', { [person]: [ids.e], [due]: addDaysIso(today(), 3) });
    await add(a, 'ללא יעד', { [person]: [ids.e, ids.m] });
    await add(b, 'פרטי', { [col(b, 'אחראי ביצוע').id]: [ids.m] });
    const rows = (await m.get('/api/workload')).json().rows as { name: string; open: number; overdue: number; dueWeek: number; noDue: number }[];
    const er = rows.find((r) => r.name === 'editor')!;
    expect(er).toMatchObject({ open: 3, overdue: 1, dueWeek: 1, noDue: 1 });
    expect(rows.find((r) => r.name === 'manager')!.open).toBe(2);
    const eRows = (await e.get('/api/workload')).json().rows as { name: string; open: number }[];
    expect(eRows.find((r) => r.name === 'manager')!.open).toBe(1); // board b is not visible to e
  });
});

describe('D4 dependencies', () => {
  it('same board only, no cycles, editor rights', async () => {
    const x = await add(a, 'יסודות');
    const y = await add(a, 'קירות');
    const z = await add(a, 'גג');
    const other = await add(b, 'לוח אחר');
    expect((await m.put(`/api/items/${y.id}/dependencies`, { blockedBy: [x.id] })).statusCode).toBe(200);
    expect((await m.put(`/api/items/${z.id}/dependencies`, { blockedBy: [y.id] })).statusCode).toBe(200);
    expect((await m.put(`/api/items/${x.id}/dependencies`, { blockedBy: [z.id] })).statusCode).toBe(400); // x → y → z → x
    expect((await m.put(`/api/items/${x.id}/dependencies`, { blockedBy: [x.id] })).statusCode).toBe(400);
    expect((await m.put(`/api/items/${x.id}/dependencies`, { blockedBy: [other.id] })).statusCode).toBe(400);
    expect((await o.get(`/api/items/${y.id}/dependencies`)).statusCode).toBe(404);
    await m.put(`/api/boards/${a.id}/members`, { userId: ids.o, role: 'viewer' });
    expect((await o.put(`/api/items/${y.id}/dependencies`, { blockedBy: [] })).statusCode).toBe(403);
    const dep = (await o.get(`/api/items/${y.id}/dependencies`)).json().dependencies;
    expect(dep.blockedBy.map((d: { name: string }) => d.name)).toEqual(['יסודות']);
    expect(dep.blocks.map((d: { name: string }) => d.name)).toEqual(['גג']);
    expect((await m.get(`/api/boards/${a.id}/dependencies`)).json().dependencies).toHaveLength(2);
  });
});

describe('D6 monthly management report', () => {
  it('managers only; previous month by default; opt-in e-mail once a month', async () => {
    const st = col(a, 'סטטוס');
    const x = await add(a, 'בחודש הקודם');
    const [y, mo] = today().split('-').map(Number) as [number, number];
    const prevMonth = new Date(Date.UTC(y, mo - 2, 1)).toISOString().slice(0, 7);
    ctx.db.prepare('UPDATE items SET created_at = ? WHERE id = ?').run(`${prevMonth}-10T09:00:00.000Z`, x.id);
    await m.patch(`/api/items/${x.id}`, { values: { [st.id]: 'done' } });

    expect((await e.get('/api/reports/monthly')).statusCode).toBe(403);
    const r = (await m.get('/api/reports/monthly')).json().report;
    expect(r.month).toBe(prevMonth);
    const row = r.boards.find((bb: { boardName: string }) => bb.boardName === 'לוח א');
    expect(row).toMatchObject({ created: 1, closed: 0, openAtEnd: 1 }); // closed this month, not last
    const cur = (await m.get(`/api/reports/monthly?month=${today().slice(0, 7)}`)).json().report;
    expect(cur.boards.find((bb: { boardName: string }) => bb.boardName === 'לוח א').closed).toBe(1);
    expect((await m.get('/api/reports/monthly?month=2026-13')).statusCode).toBe(400);

    expect((await e.req('PATCH', '/api/auth/preferences', { monthlyReport: true })).statusCode).toBe(403);
    const pref = await m.req('PATCH', '/api/auth/preferences', { monthlyReport: true });
    expect(pref.json().user.monthlyReport).toBe(true);
    ctx.mailer.sent.length = 0;
    expect(await ctx.app.services.monthly.run(new Date(), true)).toBe(1);
    expect(ctx.mailer.sent[0]!.subject).toContain('מבט מנהל');
    expect(ctx.mailer.sent[0]!.text).not.toContain('בחודש הקודם —'); // no item names
    expect(ctx.mailer.sent[0]!.text).toContain('/reports/monthly?month=');
    const n = (await m.get('/api/notifications')).json().notifications;
    expect(n.some((x2: { kind: string }) => x2.kind === 'monthly')).toBe(true);
  });
});
