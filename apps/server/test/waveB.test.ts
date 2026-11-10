import { addDaysIso, todayIso, type BoardDetail } from '@suboard/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { icsFold, icsText } from '../src/services/calendar.js';
import { loggedIn, setup, type Client, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let m: Client; // manager — board owner (creator)
let e: Client; // editor
let v: Client; // viewer
let o: Client; // outsider
let ids: Record<'m' | 'e' | 'v' | 'o', string>;
let board: BoardDetail;
const today = () => todayIso('Asia/Jerusalem');
const col = (t: string) => board.columns.find((c) => c.title === t)!;
const group = (n: string) => board.groups.find((g) => g.name === n)!;
const refresh = async (): Promise<BoardDetail> => (board = (await m.get(`/api/boards/${board.id}`)).json().board);

beforeEach(async () => {
  ctx = await setup();
  const mm = await loggedIn(ctx, 'manager@x.org', 'manager');
  const ee = await loggedIn(ctx, 'editor@x.org', 'member');
  const vv = await loggedIn(ctx, 'viewer@x.org', 'member');
  const oo = await loggedIn(ctx, 'outsider@x.org', 'member');
  [m, e, v, o] = [mm.client, ee.client, vv.client, oo.client];
  ids = { m: mm.user.id, e: ee.user.id, v: vv.user.id, o: oo.user.id };
  board = (await m.post('/api/boards', { name: 'פעולות מתקנות', templateKey: 'capa' })).json().board;
  await m.put(`/api/boards/${board.id}/members`, { userId: ids.e, role: 'editor' });
  await m.put(`/api/boards/${board.id}/members`, { userId: ids.v, role: 'viewer' });
});
afterEach(async () => ctx.close());

const newItem = async (name: string, values: Record<string, unknown> = {}, client = e) => {
  const r = await client.post(`/api/boards/${board.id}/items`, { groupId: group('פתוחות').id, name, values });
  expect(r.statusCode, r.body).toBe(201);
  return r.json().item as { id: string; groupId: string; values: Record<string, unknown> };
};
const getItem = async (id: string) => (await refresh()).items.find((i) => i.id === id)!;
const addRule = async (body: Record<string, unknown>, client = m) => {
  const r = await client.post(`/api/boards/${board.id}/automations`, { name: 'חוק', ...body });
  expect(r.statusCode, r.body).toBe(201);
  return r.json().automation as { id: string };
};
const runs = async () => (await m.get(`/api/boards/${board.id}/automation-runs`)).json().runs as { automationId: string; status: string; detail: string | null }[];
const notifs = async (c: Client) => (await c.get('/api/notifications')).json().notifications as { kind: string; detail: string | null; title: string }[];

describe('B1 automations — permissions and validation', () => {
  it('owner manages, editor reads, viewer / outsider cannot', async () => {
    const body = { name: 'x', trigger: { type: 'item_created' }, actions: [{ type: 'move_group', groupId: group('הושלמו').id }] };
    expect((await e.post(`/api/boards/${board.id}/automations`, body)).statusCode).toBe(403);
    expect((await o.post(`/api/boards/${board.id}/automations`, body)).statusCode).toBe(404);
    const a = await addRule(body);
    expect((await e.get(`/api/boards/${board.id}/automations`)).json().automations).toHaveLength(1);
    expect((await v.get(`/api/boards/${board.id}/automations`)).statusCode).toBe(403);
    expect((await o.get(`/api/boards/${board.id}/automations`)).statusCode).toBe(404);
    expect((await o.get(`/api/boards/${board.id}/automation-runs`)).statusCode).toBe(404);
    expect((await e.patch(`/api/automations/${a.id}`, { enabled: false })).statusCode).toBe(403);
    expect((await o.del(`/api/automations/${a.id}`)).statusCode).toBe(404);
    expect((await m.patch(`/api/automations/${a.id}`, { enabled: false })).json().automation.enabled).toBe(false);
    expect((await m.del(`/api/automations/${a.id}`)).statusCode).toBe(200);
  });

  it('rejects references to wrong column types, missing labels, foreign groups and non-members', async () => {
    const other = (await m.post('/api/boards', { name: 'אחר', templateKey: 'capa' })).json().board as BoardDetail;
    const bad = async (trigger: unknown, actions: unknown[], conditions: unknown[] = []) =>
      (await m.post(`/api/boards/${board.id}/automations`, { name: 'x', trigger, conditions, actions })).statusCode;
    const ok = [{ type: 'move_group', groupId: group('הושלמו').id }];
    expect(await bad({ type: 'status_changed', columnId: col('תאריך יעד').id }, ok)).toBe(400);
    expect(await bad({ type: 'status_changed', columnId: col('סטטוס').id, to: 'nope' }, ok)).toBe(400);
    expect(await bad({ type: 'item_created' }, [{ type: 'move_group', groupId: other.groups[0]!.id }])).toBe(400);
    expect(await bad({ type: 'item_created' }, [{ type: 'assign', columnId: col('אחראי ביצוע').id, userIds: [ids.o] }])).toBe(400);
    expect(await bad({ type: 'item_created' }, [{ type: 'notify', to: { userIds: [ids.o] }, message: 'hi' }])).toBe(400);
    expect(await bad({ type: 'item_created' }, ok, [{ type: 'status_is', columnId: col('סטטוס').id, optionIds: ['zzz'] }])).toBe(400);
    expect(await bad({ type: 'date_reached', columnId: col('סטטוס').id, offsetDays: 0 }, ok)).toBe(400);
    expect(await bad({ type: 'item_created' }, [{ type: 'clear', columnId: other.columns[0]!.id }])).toBe(400);
  });
});

describe('B1 automations — execution', () => {
  it('status change → move group, set date, notify assignee; history credits the rule', async () => {
    const st = col('סטטוס');
    await addRule({
      name: 'סגירה',
      trigger: { type: 'status_changed', columnId: st.id, to: 'done' },
      actions: [
        { type: 'move_group', groupId: group('הושלמו').id },
        { type: 'set_date', columnId: col('תאריך יעד').id, offsetDays: 0 },
        { type: 'notify', to: { columnId: col('אחראי ביצוע').id, owners: true }, message: 'הפעולה נסגרה' },
      ],
    });
    const it = await newItem('תיקון מעקה', { [col('אחראי ביצוע').id]: [ids.v] });
    // Not matching: other label.
    await e.patch(`/api/items/${it.id}`, { values: { [st.id]: 'in_progress' } });
    expect((await getItem(it.id)).groupId).toBe(group('פתוחות').id);

    const res = await e.patch(`/api/items/${it.id}`, { values: { [st.id]: 'done' } });
    expect(res.statusCode).toBe(200);
    const after = await getItem(it.id);
    expect(after.groupId).toBe(group('הושלמו').id);
    expect(after.values[col('תאריך יעד').id]).toBe(today());

    const vn = (await notifs(v)).filter((n) => n.kind === 'automation');
    expect(vn).toHaveLength(1);
    expect(vn[0]!.detail).toBe('הפעולה נסגרה');
    expect((await notifs(m)).some((n) => n.kind === 'automation')).toBe(true); // owner
    expect((await notifs(e)).some((n) => n.kind === 'automation')).toBe(false); // not addressed
    const mail = ctx.mailer.sent.find((x) => x.subject.includes('סגירה'));
    expect(mail?.text).toContain('הפעולה נסגרה');

    const act = (await m.get(`/api/items/${it.id}/activity`)).json().activity as { userId: string | null; detail: Record<string, unknown>; action: string }[];
    const byRule = act.filter((a) => a.detail.automation === 'סגירה');
    expect(byRule.length).toBeGreaterThanOrEqual(2);
    expect(byRule.every((a) => a.userId === null)).toBe(true);
    expect((await runs()).filter((r) => r.status === 'ok')).toHaveLength(1);
  });

  it('changes made by an automation never trigger other automations (no loops)', async () => {
    const st = col('סטטוס');
    const prio = col('עדיפות');
    const first = await addRule({ trigger: { type: 'status_changed', columnId: st.id }, actions: [{ type: 'set_status', columnId: prio.id, optionId: prio.settings.options![0]!.id }] });
    const second = await addRule({ trigger: { type: 'status_changed', columnId: prio.id }, actions: [{ type: 'set_status', columnId: st.id, optionId: 'open' }] });
    const it = await newItem('לולאה');
    await e.patch(`/api/items/${it.id}`, { values: { [st.id]: 'in_progress' } });
    const r = await runs();
    expect(r.filter((x) => x.automationId === first.id)).toHaveLength(1);
    expect(r.filter((x) => x.automationId === second.id)).toHaveLength(0);
    expect((await getItem(it.id)).values[st.id]).toBe('in_progress');
  });

  it('item created + condition → assign; disabled rules do not run; import triggers too', async () => {
    const person = col('אחראי ביצוע');
    const rule = await addRule({
      trigger: { type: 'item_created' },
      conditions: [{ type: 'person_empty', columnId: person.id }],
      actions: [{ type: 'assign', columnId: person.id, userIds: [ids.e] }, { type: 'create_subitem', name: 'אימות ביצוע' }],
    });
    const a = await newItem('ללא אחראי');
    const b = await newItem('עם אחראי', { [person.id]: [ids.v] });
    await refresh();
    expect(board.items.find((i) => i.id === a.id)!.values[person.id]).toEqual([ids.e]);
    expect(board.items.find((i) => i.id === b.id)!.values[person.id]).toEqual([ids.v]);
    expect(board.items.filter((i) => i.parentId === a.id).map((i) => i.name)).toEqual(['אימות ביצוע']);
    expect(board.items.some((i) => i.parentId && i.parentId !== a.id)).toBe(false); // sub-items do not fire rules

    const imp = await e.post(`/api/boards/${board.id}/import`, { groupId: group('פתוחות').id, rows: [{ name: 'מיובא' }] });
    expect(imp.json().created).toBe(1);
    await refresh();
    expect(board.items.find((i) => i.name === 'מיובא')!.values[person.id]).toEqual([ids.e]);

    await m.patch(`/api/automations/${rule.id}`, { enabled: false });
    const c = await newItem('אחרי השבתה');
    expect((await getItem(c.id)).values[person.id]).toBeUndefined();
  });

  it('a failing rule is logged and never fails the user request', async () => {
    const due = col('תאריך יעד');
    await addRule({ trigger: { type: 'item_created' }, actions: [{ type: 'set_date', columnId: due.id, offsetDays: 7 }] });
    expect((await m.del(`/api/columns/${due.id}`)).statusCode).toBe(200);
    await newItem('אחרי מחיקת עמודה'); // asserts 201
    const r = await runs();
    expect(r[0]!.status).toBe('error');
    expect(r[0]!.detail).toContain('עמודה');
    const list = (await m.get(`/api/boards/${board.id}/automations`)).json().automations;
    expect(list[0].errorCount).toBe(1);
  });
});

describe('B2 SLA / scheduled triggers', () => {
  it('date reached (day before due) fires once per item and date', async () => {
    const due = col('תאריך יעד');
    await addRule({
      name: 'יום לפני',
      trigger: { type: 'date_reached', columnId: due.id, offsetDays: -1 },
      conditions: [{ type: 'not_done' }],
      actions: [{ type: 'notify', to: { owners: true }, message: 'יעד מחר' }],
    });
    await newItem('מחר', { [due.id]: addDaysIso(today(), 1) });
    await newItem('בעוד שבוע', { [due.id]: addDaysIso(today(), 7) });
    await newItem('סגור', { [due.id]: addDaysIso(today(), 1), [col('סטטוס').id]: 'done' });
    expect(ctx.app.services.automations.runScheduled(new Date(), true)).toBe(1);
    expect(ctx.app.services.automations.runScheduled(new Date(), true)).toBe(0); // deduplicated
    expect((await notifs(m)).filter((n) => n.kind === 'automation' && n.title === 'מחר')).toHaveLength(1);
  });

  it('SLA: item in a status for N days escalates to owners, once per entry into the status', async () => {
    const st = col('סטטוס');
    await addRule({
      name: 'SLA פתוח',
      trigger: { type: 'status_stale', columnId: st.id, optionId: 'open', days: 3 },
      actions: [{ type: 'notify', to: { owners: true }, message: 'פתוח יותר מ-3 ימים' }],
    });
    const old = await newItem('ישן', { [st.id]: 'open' });
    await newItem('חדש', { [st.id]: 'open' });
    const fiveDaysAgo = new Date(Date.now() - 5 * 86_400_000).toISOString();
    ctx.db.prepare('UPDATE items SET created_at = ? WHERE id = ?').run(fiveDaysAgo, old.id);
    expect(ctx.app.services.automations.runScheduled(new Date(), true)).toBe(1);
    expect(ctx.app.services.automations.runScheduled(new Date(), true)).toBe(0);
    // Leaving and re-entering the status restarts the clock (no new escalation today).
    await e.patch(`/api/items/${old.id}`, { values: { [st.id]: 'in_progress' } });
    await e.patch(`/api/items/${old.id}`, { values: { [st.id]: 'open' } });
    expect(ctx.app.services.automations.runScheduled(new Date(), true)).toBe(0);
  });
});

describe('B3 recurring items', () => {
  it('creates the item on its date with a due date, advances, and never duplicates', async () => {
    const due = col('תאריך יעד');
    const body = {
      name: 'בדיקת מטפים',
      groupId: group('פתוחות').id,
      values: { [col('אחראי ביצוע').id]: [ids.e] },
      schedule: { frequency: 'weekly', weekdays: [new Date(`${today()}T00:00:00Z`).getUTCDay()], startDate: today() },
      dueColumnId: due.id,
      dueOffsetDays: 3,
    };
    expect((await v.post(`/api/boards/${board.id}/recurrences`, body)).statusCode).toBe(403);
    expect((await o.post(`/api/boards/${board.id}/recurrences`, body)).statusCode).toBe(404);
    expect((await e.post(`/api/boards/${board.id}/recurrences`, { ...body, dueColumnId: col('סטטוס').id })).statusCode).toBe(400);
    expect((await e.post(`/api/boards/${board.id}/recurrences`, { ...body, values: { [col('אחראי ביצוע').id]: [ids.o] } })).statusCode).toBe(400);
    const r = await e.post(`/api/boards/${board.id}/recurrences`, body);
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().recurrence.nextDate).toBe(today());

    expect(ctx.app.services.recurrences.runDue()).toBe(1);
    expect(ctx.app.services.recurrences.runDue()).toBe(0);
    await refresh();
    const created = board.items.filter((i) => i.name === 'בדיקת מטפים');
    expect(created).toHaveLength(1);
    expect(created[0]!.values[due.id]).toBe(addDaysIso(today(), 3));
    const list = (await v.get(`/api/boards/${board.id}/recurrences`)).json().recurrences;
    expect(list[0].nextDate).toBe(addDaysIso(today(), 7));
    expect(list[0].lastItemId).toBe(created[0]!.id);
    // Assignment notification from the system (no actor).
    expect((await notifs(e)).some((n) => n.kind === 'assigned' && n.title === 'בדיקת מטפים')).toBe(true);
  });

  it('missed occurrences create one item, not a flood; ended schedules stop', async () => {
    const r = await e.post(`/api/boards/${board.id}/recurrences`, {
      name: 'יומי',
      groupId: group('פתוחות').id,
      schedule: { frequency: 'daily', startDate: addDaysIso(today(), -30) },
    });
    const id = r.json().recurrence.id;
    ctx.db.prepare('UPDATE recurrences SET next_date = ? WHERE id = ?').run(addDaysIso(today(), -30), id);
    expect(ctx.app.services.recurrences.runDue()).toBe(1);
    expect((await e.get(`/api/boards/${board.id}/recurrences`)).json().recurrences[0].nextDate).toBe(addDaysIso(today(), 1));

    const ended = await e.post(`/api/boards/${board.id}/recurrences`, {
      name: 'הסתיים',
      groupId: group('פתוחות').id,
      schedule: { frequency: 'daily', startDate: addDaysIso(today(), -10), endDate: addDaysIso(today(), -1) },
    });
    expect(ended.json().recurrence.nextDate).toBeNull();
  });
});

describe('B4 calendar (ICS)', () => {
  it('escapes text, folds long lines, enforces access', async () => {
    expect(icsText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
    const folded = icsFold('SUMMARY:' + 'א'.repeat(60));
    expect(folded.split('\r\n ').every((l) => Buffer.byteLength(l) <= 75)).toBe(true);

    const due = col('תאריך יעד');
    await newItem('בדיקה, שנתית; מעבדה', { [due.id]: '2026-12-01', [col('אחראי ביצוע').id]: [ids.e] });
    await newItem('ללא תאריך');
    const res = await v.get(`/api/boards/${board.id}/calendar.ics`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/calendar');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.body).toContain('SUMMARY:בדיקה\\, שנתית\\; מעבדה');
    expect(res.body).toContain('DTSTART;VALUE=DATE:20261201');
    expect(res.body).toContain('DTEND;VALUE=DATE:20261202');
    expect(res.body.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect((await o.get(`/api/boards/${board.id}/calendar.ics`)).statusCode).toBe(404);
    expect((await v.get(`/api/boards/${board.id}/calendar.ics?columnId=${col('סטטוס').id}`)).statusCode).toBe(400);

    const mine = await e.get('/api/me/calendar.ics');
    expect(mine.body.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    const outsiderMine = await o.get('/api/me/calendar.ics');
    expect(outsiderMine.body).not.toContain('VEVENT');
  });
});

describe('B5 scheduled reports', () => {
  it('owner configures; delivery goes only to recipients who still have access, once a day', async () => {
    const body = { name: 'שבועי להנהלה', frequency: 'daily', recipients: [ids.e, ids.v] };
    expect((await e.post(`/api/boards/${board.id}/reports`, body)).statusCode).toBe(403);
    expect((await m.post(`/api/boards/${board.id}/reports`, { ...body, recipients: [ids.o] })).statusCode).toBe(400);
    const r = await m.post(`/api/boards/${board.id}/reports`, body);
    expect(r.statusCode, r.body).toBe(201);

    const due = col('תאריך יעד');
    await newItem('באיחור', { [due.id]: addDaysIso(today(), -2) });
    await newItem('השבוע', { [due.id]: addDaysIso(today(), 2) });
    const done = await newItem('נסגר');
    await e.patch(`/api/items/${done.id}`, { values: { [col('סטטוס').id]: 'done' } });

    const summary = (await v.get(`/api/boards/${board.id}/report-summary`)).json().summary;
    expect(summary.total).toBe(3);
    expect(summary.open).toBe(2);
    expect(summary.overdue.map((i: { name: string }) => i.name)).toEqual(['באיחור']);
    expect(summary.upcoming.map((i: { name: string }) => i.name)).toEqual(['השבוע']);
    expect(summary.closedInPeriod).toBe(1);
    expect((await o.get(`/api/boards/${board.id}/report-summary`)).statusCode).toBe(404);

    // The viewer loses access before delivery → gets nothing.
    await m.del(`/api/boards/${board.id}/members/${ids.v}`);
    ctx.mailer.sent.length = 0;
    expect(await ctx.app.services.reports.runDue(new Date(), true)).toBe(1);
    expect(await ctx.app.services.reports.runDue(new Date(), true)).toBe(0);
    expect((await notifs(e)).filter((n) => n.kind === 'report')).toHaveLength(1);
    expect((await notifs(v)).some((n) => n.kind === 'report')).toBe(false);
    expect(ctx.mailer.sent).toHaveLength(1);
    expect(ctx.mailer.sent[0]!.subject).toContain('שבועי להנהלה');
    expect(ctx.mailer.sent[0]!.text).toContain('באיחור — באיחור');
  });

  it('weekly reports are sent only on their weekday', async () => {
    const wd = new Date(`${today()}T00:00:00Z`).getUTCDay();
    await m.post(`/api/boards/${board.id}/reports`, { name: 'לא היום', frequency: 'weekly', weekday: (wd + 1) % 7, recipients: [ids.e] });
    expect(await ctx.app.services.reports.runDue(new Date(), true)).toBe(0);
  });
});
