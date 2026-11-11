import type { BoardDetail, BoardForm, Column } from '@suboard/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loggedIn, setup, type Client, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let m: Client; // manager, owner
let e: Client; // board editor
let o: Client; // outsider (fills all_users forms)
let ids: Record<'m' | 'e' | 'o', string>;
let boardId: string;
let form: BoardForm;
let cols: Record<string, Column>;

beforeEach(async () => {
  ctx = await setup();
  const mm = await loggedIn(ctx, 'manager@x.org', 'manager');
  const ee = await loggedIn(ctx, 'editor@x.org', 'member');
  const oo = await loggedIn(ctx, 'outsider@x.org', 'member');
  [m, e, o] = [mm.client, ee.client, oo.client];
  ids = { m: mm.user.id, e: ee.user.id, o: oo.user.id };
  const res = (
    await m.post('/api/forms/quick', {
      name: 'דיווח מפגע',
      questions: [
        { title: 'סוג', type: 'choice', required: true, options: ['חשמל', 'כימי'] },
        { title: 'שם החומר', type: 'text', required: true },
        { title: 'יש נפגעים', type: 'yes_no' },
        { title: 'פרטי הפגיעה', type: 'long_text', required: true },
      ],
    })
  ).json();
  form = res.form;
  boardId = res.boardId;
  await m.put(`/api/boards/${boardId}/members`, { userId: ids.e, role: 'editor' });
  const board = (await m.get(`/api/boards/${boardId}`)).json().board as BoardDetail;
  cols = Object.fromEntries(board.columns.map((c) => [c.title, c]));
});
afterEach(async () => ctx.close());

const opt = (label: string) => cols['סוג']!.settings.options!.find((x) => x.label === label)!.id;
const withConditions = () =>
  form.fields.map((f) =>
    f.columnId === cols['שם החומר']!.id
      ? { ...f, section: 'פרטים', showIf: { columnId: cols['סוג']!.id, optionIds: [opt('כימי')] } }
      : f.columnId === cols['פרטי הפגיעה']!.id
        ? { ...f, showIf: { columnId: cols['יש נפגעים']!.id, optionIds: ['true'] } }
        : f,
  );

describe('L3 conditional questions', () => {
  it('validates conditions, hides and un-requires questions, and drops hidden answers', async () => {
    // a condition must point to an earlier choice / yes-no question with existing answers
    const bad1 = form.fields.map((f, i) => (i === 0 ? { ...f, showIf: { columnId: cols['שם החומר']!.id, optionIds: ['x'] } } : f));
    expect((await m.patch(`/api/forms/${form.id}`, { fields: bad1 })).statusCode).toBe(400);
    const bad2 = form.fields.map((f) => (f.columnId === cols['שם החומר']!.id ? { ...f, showIf: { columnId: cols['סוג']!.id, optionIds: ['nope'] } } : f));
    expect((await m.patch(`/api/forms/${form.id}`, { fields: bad2 })).statusCode).toBe(400);
    const ok = await m.patch(`/api/forms/${form.id}`, { fields: withConditions(), successMessage: 'תודה! נחזור אליך תוך יומיים.' });
    expect(ok.statusCode, ok.body).toBe(200);

    const fill = (await o.get(`/api/forms/${form.id}`)).json().form;
    expect(fill.successMessage).toBe('תודה! נחזור אליך תוך יומיים.');
    expect(fill.fields[1]).toMatchObject({ section: 'פרטים', showIf: { optionIds: [opt('כימי')] } });

    // electrical, no injuries: both conditional questions are hidden → not required, values dropped
    const r1 = await o.post(`/api/forms/${form.id}/submit`, { name: 'שקע שרוף', values: { [cols['סוג']!.id]: opt('חשמל'), [cols['שם החומר']!.id]: 'לא רלוונטי' } });
    expect(r1.statusCode, r1.body).toBe(201);
    const item1 = ((await m.get(`/api/boards/${boardId}`)).json().board as BoardDetail).items.find((i) => i.name === 'שקע שרוף')!;
    expect(item1.values[cols['שם החומר']!.id]).toBeUndefined();
    // chemical: the material name becomes required
    expect((await o.post(`/api/forms/${form.id}/submit`, { name: 'דליפה', values: { [cols['סוג']!.id]: opt('כימי') } })).statusCode).toBe(400);
    // injuries = yes: details become required
    const base = { [cols['סוג']!.id]: opt('כימי'), [cols['שם החומר']!.id]: 'אצטון', [cols['יש נפגעים']!.id]: true };
    expect((await o.post(`/api/forms/${form.id}/submit`, { name: 'דליפה', values: base })).statusCode).toBe(400);
    expect((await o.post(`/api/forms/${form.id}/submit`, { name: 'דליפה', values: { ...base, [cols['פרטי הפגיעה']!.id]: 'גירוי בעיניים' } })).statusCode).toBe(201);
  });
});

describe('L5/L6 workflow wiring', () => {
  it('assigns every response and notifies the chosen members; only board members can be wired', async () => {
    expect((await m.patch(`/api/forms/${form.id}`, { notifyUserIds: [ids.o] })).statusCode).toBe(400); // not on the board
    expect((await m.patch(`/api/forms/${form.id}`, { fields: withConditions(), notifyUserIds: [ids.m], assignUserIds: [ids.e] })).statusCode).toBe(200);
    const r = await o.post(`/api/forms/${form.id}/submit`, { name: 'כבל חשוף', values: { [cols['סוג']!.id]: opt('חשמל') } });
    expect(r.statusCode, r.body).toBe(201);
    const board = (await m.get(`/api/boards/${boardId}`)).json().board as BoardDetail;
    const person = board.columns.find((c) => c.type === 'person')!;
    expect(board.items.find((i) => i.name === 'כבל חשוף')!.values[person.id]).toEqual([ids.e]);
    const kinds = async (c: Client) => ((await c.get('/api/notifications')).json().notifications as { kind: string; detail: string | null }[]).map((n) => n.kind);
    expect(await kinds(e)).toContain('assigned');
    expect(await kinds(m)).toContain('automation');
    expect((await e.get('/api/me/work')).json().items.map((x: { itemName: string }) => x.itemName)).toContain('כבל חשוף');
    // a member removed from the board stops being assigned / notified
    await m.del(`/api/boards/${boardId}/members/${ids.e}`);
    expect((await o.post(`/api/forms/${form.id}/submit`, { name: 'שני', values: { [cols['סוג']!.id]: opt('חשמל') } })).statusCode).toBe(201);
    const b2 = (await m.get(`/api/boards/${boardId}`)).json().board as BoardDetail;
    expect(b2.items.find((i) => i.name === 'שני')!.values[person.id] ?? null).toBeNull();
  });
});

describe('L1 forms hub', () => {
  it('lists forms on boards I own and duplicates a form as a disabled copy', async () => {
    expect((await m.get('/api/forms/managed')).json().forms.map((f: BoardForm) => f.name)).toEqual(['דיווח מפגע']);
    expect((await e.get('/api/forms/managed')).json().forms).toEqual([]); // editor, not owner
    expect((await o.get('/api/forms/managed')).json().forms).toEqual([]);
    expect((await e.post(`/api/forms/${form.id}/duplicate`)).statusCode).toBe(403);
    expect((await o.post(`/api/forms/${form.id}/duplicate`)).statusCode).toBe(404);
    const copy = (await m.post(`/api/forms/${form.id}/duplicate`)).json().form as BoardForm;
    expect(copy).toMatchObject({ name: 'דיווח מפגע (עותק)', enabled: false, boardId });
    expect(copy.fields).toEqual(form.fields);
    expect((await o.get(`/api/forms/${copy.id}`)).statusCode).toBe(404); // disabled until reviewed
  });
});
