import { addDaysIso, todayIso, type BoardDetail } from '@suboard/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loggedIn, setup, type Client, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let m: Client; // manager — owner of every board here
let e: Client; // editor on the survey / incidents boards, NOT a member of CAPA
let v: Client; // viewer
let o: Client; // outsider (signed in, no board)
let ids: Record<'m' | 'e' | 'v' | 'o', string>;
let survey: BoardDetail;
let capa: BoardDetail;
const today = () => todayIso('Asia/Jerusalem');
const col = (b: BoardDetail, t: string) => b.columns.find((c) => c.title === t)!;
const get = async (b: BoardDetail): Promise<BoardDetail> => (await m.get(`/api/boards/${b.id}`)).json().board;

beforeEach(async () => {
  ctx = await setup();
  const mm = await loggedIn(ctx, 'manager@x.org', 'manager');
  const ee = await loggedIn(ctx, 'editor@x.org', 'member');
  const vv = await loggedIn(ctx, 'viewer@x.org', 'member');
  const oo = await loggedIn(ctx, 'outsider@x.org', 'member');
  [m, e, v, o] = [mm.client, ee.client, vv.client, oo.client];
  ids = { m: mm.user.id, e: ee.user.id, v: vv.user.id, o: oo.user.id };
  survey = (await m.post('/api/boards', { name: 'סקרים', templateKey: 'lab_surveys' })).json().board;
  capa = (await m.post('/api/boards', { name: 'פעולות מתקנות', templateKey: 'capa' })).json().board;
  await m.put(`/api/boards/${survey.id}/members`, { userId: ids.e, role: 'editor' });
  await m.put(`/api/boards/${survey.id}/members`, { userId: ids.v, role: 'viewer' });
});
afterEach(async () => ctx.close());

const newItem = async (b: BoardDetail, name: string, values: Record<string, unknown> = {}, client = e) => {
  const r = await client.post(`/api/boards/${b.id}/items`, { groupId: b.groups[0]!.id, name, values });
  expect(r.statusCode, r.body).toBe(201);
  return r.json().item as { id: string; values: Record<string, unknown>; seq: number };
};

describe('C4 risk matrix column', () => {
  it('validates likelihood × severity and exports the score', async () => {
    const inc = (await m.post('/api/boards', { name: 'אירועים', templateKey: 'incidents' })).json().board as BoardDetail;
    const risk = col(inc, 'הערכת סיכון');
    expect(risk.type).toBe('risk');
    const it = await newItem(inc, 'נפילה', {}, m);
    expect((await m.patch(`/api/items/${it.id}`, { values: { [risk.id]: { l: 6, s: 1 } } })).statusCode).toBe(400);
    expect((await m.patch(`/api/items/${it.id}`, { values: { [risk.id]: { l: 4, s: 4, x: 1 } } })).statusCode).toBe(200); // extra keys stripped
    const after = (await get(inc)).items.find((i) => i.id === it.id)!;
    expect(after.values[risk.id]).toEqual({ l: 4, s: 4 });
    const csv = (await m.get(`/api/boards/${inc.id}/export.csv`)).body;
    expect(csv).toContain('16 · גבוה');
  });
});

describe('C2 checklist → corrective action', () => {
  const wire = async (client = m) => {
    const cl = col(survey, "צ'קליסט סקר");
    return client.patch(`/api/columns/${cl.id}`, { settings: { checklist: { ...cl.settings.checklist!, capaBoardId: capa.id, capaGroupId: capa.groups[0]!.id } } });
  };

  it('only an owner who can edit the target board may wire it', async () => {
    const cl = col(survey, "צ'קליסט סקר");
    // e is not an owner of the survey board.
    expect((await e.patch(`/api/columns/${cl.id}`, { settings: { checklist: { ...cl.settings.checklist!, capaBoardId: capa.id } } })).statusCode).toBe(403);
    // An owner who is only a viewer on the target board.
    const other = (await m.post('/api/boards', { name: 'לוח של e', templateKey: 'capa' })).json().board as BoardDetail;
    await m.put(`/api/boards/${survey.id}/members`, { userId: ids.e, role: 'owner' });
    await m.put(`/api/boards/${other.id}/members`, { userId: ids.e, role: 'viewer' });
    expect((await e.patch(`/api/columns/${cl.id}`, { settings: { checklist: { ...cl.settings.checklist!, capaBoardId: other.id } } })).statusCode).toBe(400);
    expect((await wire()).statusCode).toBe(200);
    expect((await m.patch(`/api/columns/${cl.id}`, { settings: { checklist: { ...cl.settings.checklist!, capaBoardId: survey.id } } })).statusCode).toBe(400);
  });

  it('a failed entry opens one linked corrective action, even for a reporter outside the CAPA board', async () => {
    expect((await wire()).statusCode).toBe(200);
    survey = await get(survey);
    const cl = col(survey, "צ'קליסט סקר");
    const it = await newItem(survey, 'מעבדה 214');
    expect((await e.patch(`/api/items/${it.id}`, { values: { [cl.id]: { nope: { r: 'fail' } } } })).statusCode).toBe(400);
    // A client-supplied capa id is ignored.
    const res = await e.patch(`/api/items/${it.id}`, { values: { [cl.id]: { exits: { r: 'pass' }, extinguisher: { r: 'fail', capa: '00000000-0000-4000-8000-000000000000' }, hood: { r: 'na' } } } });
    expect(res.statusCode, res.body).toBe(200);
    capa = await get(capa);
    const opened = capa.items.filter((i) => i.name.startsWith('מטף בתוקף ונגיש — מעבדה 214'));
    expect(opened).toHaveLength(1);
    let stored = (await get(survey)).items.find((i) => i.id === it.id)!.values[cl.id] as Record<string, { r: string; capa?: string }>;
    expect(stored.extinguisher).toEqual({ r: 'fail', capa: opened[0]!.id });

    // Re-saving (the client never knows capa ids) keeps the link and opens nothing new.
    await e.patch(`/api/items/${it.id}`, { values: { [cl.id]: { exits: { r: 'pass' }, extinguisher: { r: 'fail' }, hood: { r: 'fail' } } } });
    stored = (await get(survey)).items.find((i) => i.id === it.id)!.values[cl.id] as Record<string, { r: string; capa?: string }>;
    expect(stored.extinguisher!.capa).toBe(opened[0]!.id);
    expect((await get(capa)).items.filter((i) => i.name.includes('— מעבדה 214'))).toHaveLength(2);

    // Links: the owner sees details; the reporter sees that a link exists but not the hidden item.
    const mine = (await m.get(`/api/items/${it.id}/links`)).json().links;
    expect(mine).toHaveLength(2);
    expect(mine[0].item.boardName).toBe('פעולות מתקנות');
    const theirs = (await e.get(`/api/items/${it.id}/links`)).json().links;
    expect(theirs.every((l: { item: unknown }) => l.item === null)).toBe(true);
    expect((await o.get(`/api/items/${it.id}/links`)).statusCode).toBe(404);
    // Reverse direction from the CAPA item.
    const back = (await m.get(`/api/items/${opened[0]!.id}/links`)).json().links;
    expect(back[0].direction).toBe('in');
    expect(back[0].item.name).toBe('מעבדה 214');
  });
});

describe('C5 investigations', () => {
  it('viewer reads, editor writes, text never enters history, linked action needs target rights', async () => {
    const it = await newItem(survey, 'אירוע במעבדה');
    const body = { whys: ['הרצפה רטובה', 'דליפה מהמזגן', ''], rootCause: 'אין תחזוקה מונעת', categories: ['equipment', 'management', 'equipment'], effectivenessDue: today() };
    expect((await v.put(`/api/items/${it.id}/investigation`, body)).statusCode).toBe(403);
    expect((await o.get(`/api/items/${it.id}/investigation`)).statusCode).toBe(404);
    const r = await e.put(`/api/items/${it.id}/investigation`, body);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().investigation.whys).toEqual(['הרצפה רטובה', 'דליפה מהמזגן']);
    expect(r.json().investigation.categories).toEqual(['equipment', 'management']);
    expect((await v.get(`/api/items/${it.id}/investigation`)).json().investigation.rootCause).toBe('אין תחזוקה מונעת');
    const hist = JSON.stringify((await m.get(`/api/items/${it.id}/activity`)).json());
    expect(hist).toContain('investigation_updated');
    expect(hist).not.toContain('אין תחזוקה מונעת');

    const action = { boardId: capa.id, groupId: capa.groups[0]!.id, name: 'תוכנית תחזוקה למזגנים' };
    expect((await e.post(`/api/items/${it.id}/investigation/action`, action)).statusCode).toBe(404); // e cannot see CAPA
    const created = await m.post(`/api/items/${it.id}/investigation/action`, action);
    expect(created.statusCode, created.body).toBe(201);
    const links = (await m.get(`/api/items/${it.id}/links`)).json().links;
    expect(links[0].kind).toBe('investigation_action');

    // Effectiveness reminder: once per due date, to owners (and assignees).
    expect(ctx.app.services.investigations.runDue(new Date(), true)).toBeGreaterThan(0);
    expect(ctx.app.services.investigations.runDue(new Date(), true)).toBe(0);
    const n = (await m.get('/api/notifications')).json().notifications;
    expect(n.some((x: { kind: string }) => x.kind === 'effectiveness')).toBe(true);
    // Recording a result stops reminders even after the date moves.
    await e.put(`/api/items/${it.id}/investigation`, { ...body, effectivenessDue: addDaysIso(today(), -1), effectivenessResult: 'effective' });
    expect(ctx.app.services.investigations.runDue(new Date(), true)).toBe(0);
  });
});

describe('C3 compliance', () => {
  it('owner configures; percentages per group; overview shows only visible boards', async () => {
    const eq = (await m.post('/api/boards', { name: 'ציוד', templateKey: 'equipment' })).json().board as BoardDetail;
    const date = eq.columns.find((c) => c.type === 'date')!;
    const loc = eq.columns.find((c) => c.type === 'text')!;
    await m.put(`/api/boards/${eq.id}/members`, { userId: ids.e, role: 'editor' });
    expect((await e.put(`/api/boards/${eq.id}/compliance`, { settings: { dateColumnId: date.id } })).statusCode).toBe(403);
    expect((await m.put(`/api/boards/${eq.id}/compliance`, { settings: { dateColumnId: loc.id } })).statusCode).toBe(400);
    const ok = await m.put(`/api/boards/${eq.id}/compliance`, { settings: { dateColumnId: date.id, groupByColumnId: loc.id, windowDays: 30 } });
    expect(ok.statusCode, ok.body).toBe(200);
    const add = (name: string, d: string | null, where: string) => newItem(eq, name, { ...(d ? { [date.id]: d } : {}), [loc.id]: where }, m);
    await add('מטף 1', addDaysIso(today(), 90), 'בניין A');
    await add('מטף 2', addDaysIso(today(), -3), 'בניין A');
    await add('מטף 3', addDaysIso(today(), 10), 'בניין B');
    await add('מטף 4', null, 'בניין B');
    const c = (await e.get(`/api/boards/${eq.id}/compliance`)).json().compliance;
    expect(c.summary).toMatchObject({ total: 4, ok: 1, dueSoon: 1, overdue: 1, missing: 1, percent: 50 });
    expect(c.groups.map((g: { label: string; percent: number }) => [g.label, g.percent])).toEqual([
      ['בניין A', 50],
      ['בניין B', 50],
    ]);
    expect(c.overdueItems[0].name).toBe('מטף 2');
    expect((await e.get('/api/compliance')).json().boards).toHaveLength(1);
    expect((await o.get('/api/compliance')).json().boards).toHaveLength(0);
    expect((await o.get(`/api/boards/${eq.id}/compliance`)).statusCode).toBe(404);
  });
});

describe('C6 internal forms', () => {
  it('an all-users form lets anyone signed in report without seeing the board', async () => {
    const inc = (await m.post('/api/boards', { name: 'אירועים', templateKey: 'incidents' })).json().board as BoardDetail;
    const type = col(inc, 'סוג אירוע');
    const where = col(inc, 'מיקום');
    const desc = col(inc, 'תיאור (ללא פרטים רפואיים)');
    const person = col(inc, 'אחראי בירור');
    const base = { name: 'דיווח כמעט-אירוע', groupId: inc.groups[0]!.id, audience: 'all_users', allowPhotos: true };
    expect((await m.post(`/api/boards/${inc.id}/forms`, { ...base, fields: [{ columnId: person.id }] })).statusCode).toBe(400);
    expect((await e.post(`/api/boards/${inc.id}/forms`, { ...base, fields: [] })).statusCode).toBe(404);
    const f = await m.post(`/api/boards/${inc.id}/forms`, {
      ...base,
      fields: [{ columnId: type.id, required: true, label: 'מה קרה?' }, { columnId: where.id }, { columnId: desc.id }],
    });
    expect(f.statusCode, f.body).toBe(201);
    const formId = f.json().form.id;

    // A rule on the board fires for form submissions too.
    await m.post(`/api/boards/${inc.id}/automations`, {
      name: 'דיווח חדש',
      trigger: { type: 'item_created' },
      actions: [{ type: 'notify', to: { owners: true }, message: 'התקבל דיווח חדש' }],
    });

    const list = (await o.get('/api/forms')).json().forms;
    expect(list.map((x: { name: string }) => x.name)).toEqual(['דיווח כמעט-אירוע']);
    const fill = (await o.get(`/api/forms/${formId}`)).json().form;
    expect(fill.fields).toHaveLength(3);
    expect(fill.members).toEqual([]);
    expect((await o.post(`/api/forms/${formId}/submit`, { name: 'רטיבות', values: {} })).statusCode).toBe(400); // required
    expect((await o.post(`/api/forms/${formId}/submit`, { name: 'רטיבות', values: { [type.id]: 'near_miss', [person.id]: [ids.o] } })).statusCode).toBe(400); // not a form field
    const sub = await o.post(`/api/forms/${formId}/submit`, { name: 'רטיבות ליד המעלית', values: { [type.id]: 'near_miss', [where.id]: 'בניין C' } });
    expect(sub.statusCode, sub.body).toBe(201);
    const { itemId, ref } = sub.json();
    expect(ref).toMatch(/^#\d+$/);
    expect((await o.get(`/api/boards/${inc.id}`)).statusCode).toBe(404);
    expect((await m.get('/api/notifications')).json().notifications.some((n: { detail: string }) => n.detail === 'התקבל דיווח חדש')).toBe(true);

    const mine = (await o.get('/api/forms/mine')).json().submissions;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ itemId, name: 'רטיבות ליד המעלית', statusLabel: null });
    expect((await e.get('/api/forms/mine')).json().submissions).toHaveLength(0);

    // Photo: only the reporter, only their own submission.
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c00000000049454e44ae426082', 'hex');
    expect((await o.upload(`/api/forms/${formId}/items/${itemId}/attachments`, 'photo.png', png)).statusCode).toBe(201);
    expect((await e.upload(`/api/forms/${formId}/items/${itemId}/attachments`, 'photo.png', png)).statusCode).toBe(404);
    // After the window, no more photos.
    ctx.db.prepare('UPDATE items SET created_at = ? WHERE id = ?').run(new Date(Date.now() - 2 * 3600_000).toISOString(), itemId);
    expect((await o.upload(`/api/forms/${formId}/items/${itemId}/attachments`, 'photo.png', png)).statusCode).toBe(400);

    // Disabled → gone for reporters.
    await m.patch(`/api/forms/${formId}`, { enabled: false });
    expect((await o.get(`/api/forms/${formId}`)).statusCode).toBe(404);
  });

  it('a members form is invisible to people outside the board', async () => {
    const f = await m.post(`/api/boards/${survey.id}/forms`, { name: 'בקשת סקר', groupId: survey.groups[0]!.id, fields: [{ columnId: col(survey, 'סוקר').id }] });
    expect(f.statusCode, f.body).toBe(201);
    const id = f.json().form.id;
    expect((await o.get('/api/forms')).json().forms).toHaveLength(0);
    expect((await o.get(`/api/forms/${id}`)).statusCode).toBe(404);
    expect((await v.get(`/api/forms/${id}`)).statusCode).toBe(404); // viewers cannot create items
    const fill = (await e.get(`/api/forms/${id}`)).json().form;
    expect(fill.members.length).toBeGreaterThan(0);
  });
});

describe('C1 QR card', () => {
  it('returns the item for board members only', async () => {
    const it = await newItem(survey, 'מנדף 3');
    const card = (await v.get(`/api/items/${it.id}/card`)).json().card;
    expect(card.item.name).toBe('מנדף 3');
    expect(card.myRole).toBe('viewer');
    expect((await o.get(`/api/items/${it.id}/card`)).statusCode).toBe(404);
  });
});
