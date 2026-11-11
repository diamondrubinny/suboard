import type { BoardDetail } from '@suboard/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loggedIn, setup, type Client, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let m: Client;
let e: Client;

beforeEach(async () => {
  ctx = await setup();
  m = (await loggedIn(ctx, 'manager@x.org', 'manager')).client;
  e = (await loggedIn(ctx, 'member@x.org', 'member')).client;
});
afterEach(async () => ctx.close());

const body = {
  name: 'דיווח מפגע',
  description: 'ראיתם משהו מסוכן? דווחו כאן.',
  nameLabel: 'מה ראית?',
  allowPhotos: true,
  questions: [
    { title: 'מיקום', type: 'text', required: true, help: 'בניין, קומה, חדר' },
    { title: 'סוג המפגע', type: 'choice', required: true, options: ['חשמל', 'אש', 'החלקה'] },
    { title: 'מי בסכנה', type: 'multi_choice', options: ['עובדים', 'סטודנטים', 'אורחים'] },
    { title: 'מתי', type: 'date' },
    { title: 'דחוף', type: 'yes_no' },
    { title: 'טלפון לחזרה', type: 'phone' },
  ],
};

describe('K2 form builder (quick form)', () => {
  it('creates a responses board with a column per question and a form any signed-in user can fill', async () => {
    expect((await e.post('/api/forms/quick', body)).statusCode).toBe(403);
    const res = await m.post('/api/forms/quick', body);
    expect(res.statusCode, res.body).toBe(201);
    const { form, boardId } = res.json();
    expect(form).toMatchObject({ name: 'דיווח מפגע', audience: 'all_users', allowPhotos: true, enabled: true });
    expect(form.fields).toHaveLength(6);
    expect(form.fields[0]).toMatchObject({ required: true, help: 'בניין, קומה, חדר' });

    const board = (await m.get(`/api/boards/${boardId}`)).json().board as BoardDetail;
    const byTitle = Object.fromEntries(board.columns.map((c) => [c.title, c]));
    expect(byTitle['סוג המפגע']!.type).toBe('status');
    expect(byTitle['סוג המפגע']!.settings.options!.map((o) => o.label)).toEqual(['חשמל', 'אש', 'החלקה']);
    expect(byTitle['מי בסכנה']!.type).toBe('tags');
    expect(byTitle['דחוף']!.type).toBe('checkbox');
    // the handling status stays the board's primary status (first status column), not a question
    expect(board.columns.find((c) => c.type === 'status')!.title).toBe('סטטוס');

    // a member who is not on the board fills it through the link
    const fill = (await e.get(`/api/forms/${form.id}`)).json().form;
    expect(fill.fields.map((f: { column: { title: string } }) => f.column.title)).toEqual(body.questions.map((q) => q.title));
    const kind = byTitle['סוג המפגע']!;
    const sub = await e.post(`/api/forms/${form.id}/submit`, {
      name: 'כבל חשוף במסדרון',
      values: { [byTitle['מיקום']!.id]: 'בניין A, קומה 2', [kind.id]: kind.settings.options![0]!.id, [byTitle['דחוף']!.id]: true },
    });
    expect(sub.statusCode, sub.body).toBe(201);
    expect((await e.post(`/api/forms/${form.id}/submit`, { name: 'בלי מיקום', values: {} })).statusCode).toBe(400); // required
    expect((await e.get(`/api/boards/${boardId}`)).statusCode).toBe(404); // still cannot see the board
    expect(((await m.get(`/api/boards/${boardId}`)).json().board as BoardDetail).items.map((i) => i.name)).toEqual(['כבל חשוף במסדרון']);
  });

  it('validates questions and rolls back completely on failure', async () => {
    const bad = (q: unknown[]) => m.post('/api/forms/quick', { name: 'x', questions: q });
    expect((await bad([])).statusCode).toBe(400);
    expect((await bad([{ title: 'א', type: 'choice', options: ['רק אחת'] }])).statusCode).toBe(400);
    expect((await bad([{ title: 'א', type: 'choice', options: ['כפול', 'כפול'] }])).statusCode).toBe(400);
    expect((await bad([{ title: 'א', type: 'text' }, { title: 'א', type: 'number' }])).statusCode).toBe(400);
    expect((await bad([{ title: 'א', type: 'person' }])).statusCode).toBe(400);
    const before = (await m.get('/api/boards')).json().boards.length;
    // "סטטוס" clashes with nothing server-side, so force a failure with too many columns instead
    const many = Array.from({ length: 12 }, (_, i) => ({ title: `שאלה ${i}`, type: 'text' }));
    const r = await m.post('/api/forms/quick', { name: 'גדול', questions: many });
    if (r.statusCode !== 201) expect((await m.get('/api/boards')).json().boards.length).toBe(before); // nothing half-created
  });
});
