import type { BoardDetail } from '@suboard/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { Client, createUser, loggedIn, setup, type TestCtx } from './helpers.js';

let ctx: TestCtx;
afterEach(async () => ctx?.close());

describe('more column types and column options', () => {
  it('hour, week, colour and creation-date columns validate and export', async () => {
    ctx = await setup();
    const { client: c } = await loggedIn(ctx, 'boss@x.org', 'manager');
    const b = (await c.post('/api/boards', { name: 'משמרות', templateKey: 'blank' })).json().board as BoardDetail;
    const add = async (title: string, type: string, settings?: unknown) => (await c.post(`/api/boards/${b.id}/columns`, { title, type, ...(settings ? { settings } : {}) })).json().column;
    const hour = await add('שעה', 'hour');
    const week = await add('שבוע', 'week');
    const color = await add('צבע', 'color');
    const created = await add('נוצר', 'created_at');
    const item = (await c.post(`/api/boards/${b.id}/items`, { groupId: b.groups[0]!.id, name: 'משמרת' })).json().item as { id: string };
    const set = (values: Record<string, unknown>) => c.patch(`/api/items/${item.id}`, { values });

    for (const bad of ['8:30', '24:00', '12:60', 'noon', 830]) expect((await set({ [hour.id]: bad })).statusCode, String(bad)).toBe(400);
    expect((await set({ [hour.id]: '08:30' })).statusCode).toBe(200);
    expect((await set({ [color.id]: 'mauve' })).statusCode).toBe(400);
    expect((await set({ [color.id]: 'teal' })).statusCode).toBe(200);
    expect((await set({ [week.id]: '2026-13-40' })).statusCode).toBe(400);
    // any day of the week is stored as that week's Sunday (12.11.2026 is a Thursday)
    expect((await set({ [week.id]: '2026-11-12' })).json().item.values[week.id]).toBe('2026-11-08');
    expect((await set({ [created.id]: '2026-01-01' })).statusCode).toBe(400);
    const row = (await c.get(`/api/boards/${b.id}/export.csv`)).body.split('\n')[1]!;
    expect(row).toContain('08:30');
    expect(row).toContain('08/11 – 14/11/2026');
    expect(row).toContain('טורקיז');
  });

  it('votes: one per person, only your own, never through an ordinary edit', async () => {
    ctx = await setup();
    const { client: boss, user: bossUser } = await loggedIn(ctx, 'boss@x.org', 'manager');
    const b = (await boss.post('/api/boards', { name: 'רעיונות', templateKey: 'blank' })).json().board as BoardDetail;
    const vote = (await boss.post(`/api/boards/${b.id}/columns`, { title: 'בעד', type: 'vote' })).json().column;
    const text = (await boss.post(`/api/boards/${b.id}/columns`, { title: 'טקסט', type: 'text' })).json().column;
    const item = (await boss.post(`/api/boards/${b.id}/items`, { groupId: b.groups[0]!.id, name: 'רעיון' })).json().item as { id: string };
    const noa = await createUser(ctx, 'noa@x.org', 'member');
    const dan = await createUser(ctx, 'dan@x.org', 'member');
    await boss.put(`/api/boards/${b.id}/members`, { userId: noa.id, role: 'editor' });
    await boss.put(`/api/boards/${b.id}/members`, { userId: dan.id, role: 'viewer' });
    const n = new Client(ctx.app);
    await n.login('noa@x.org');
    const d = new Client(ctx.app);
    await d.login('dan@x.org');

    // stuffing the ballot through a normal edit is refused
    expect((await n.patch(`/api/items/${item.id}`, { values: { [vote.id]: [noa.id, bossUser.id, dan.id] } })).statusCode).toBe(400);
    expect((await n.post(`/api/items/${item.id}/vote/${vote.id}`)).json().votes).toEqual([noa.id]);
    expect((await boss.post(`/api/items/${item.id}/vote/${vote.id}`)).json().votes).toEqual([noa.id, bossUser.id]);
    expect((await n.post(`/api/items/${item.id}/vote/${vote.id}`)).json().votes).toEqual([bossUser.id]); // took hers back
    expect((await d.post(`/api/items/${item.id}/vote/${vote.id}`)).statusCode).toBe(403); // viewers do not vote
    expect((await n.post(`/api/items/${item.id}/vote/${text.id}`)).statusCode).toBe(404); // not a vote column
    expect((await boss.get(`/api/boards/${b.id}/export.csv`)).body.split('\n')[1]).toMatch(/,1,|,1$/m);
  });

  it('column options: description, unit and decimals survive other updates; a button sets a status through a normal edit', async () => {
    ctx = await setup();
    const { client: c } = await loggedIn(ctx, 'boss@x.org', 'manager');
    const b = (await c.post('/api/boards', { name: 'רכש', templateKey: 'capa' })).json().board as BoardDetail;
    const status = b.columns.find((x) => x.type === 'status')!;
    const done = status.settings.options!.find((o) => o.done)!;
    const cost = (await c.post(`/api/boards/${b.id}/columns`, { title: 'עלות', type: 'number', settings: { unit: '₪', decimals: 2, description: 'כולל מע"מ' } })).json().column;
    expect(cost.settings).toEqual({ unit: '₪', decimals: 2, description: 'כולל מע"מ' });
    // unit on a text column is refused; markup in a unit is refused
    expect((await c.post(`/api/boards/${b.id}/columns`, { title: 'x', type: 'text', settings: { unit: 'kg' } })).statusCode).toBe(400);
    expect((await c.patch(`/api/columns/${cost.id}`, { settings: { unit: '<b>' } })).statusCode).toBe(400);
    // a partial update keeps the rest
    expect((await c.patch(`/api/columns/${cost.id}`, { settings: { description: 'בלי מע"מ' } })).json().column.settings).toEqual({ unit: '₪', decimals: 2, description: 'בלי מע"מ' });
    expect((await c.patch(`/api/columns/${status.id}`, { settings: { description: 'מצב הטיפול' } })).json().column.settings.options).toHaveLength(status.settings.options!.length);
    // clearing: empty description, decimals null
    expect((await c.patch(`/api/columns/${cost.id}`, { settings: { description: '', decimals: null } })).json().column.settings).toEqual({ unit: '₪' });
    const item = (await c.post(`/api/boards/${b.id}/items`, { groupId: b.groups[0]!.id, name: 'קסדות', values: { [cost.id]: 1234.5 } })).json().item as { id: string };
    expect((await c.get(`/api/boards/${b.id}/export.csv`)).body).toContain('₪1,234.5');
    await c.patch(`/api/columns/${cost.id}`, { settings: { unit: 'ק"ג', decimals: 1 } });
    expect((await c.get(`/api/boards/${b.id}/export.csv`)).body).toContain('1,234.5 ק""ג');

    // button: target must be a status column and label of this board
    expect((await c.post(`/api/boards/${b.id}/columns`, { title: 'סיום', type: 'button', settings: { button: { label: 'סיימתי', columnId: cost.id, optionId: 'x' } } })).statusCode).toBe(400);
    expect((await c.post(`/api/boards/${b.id}/columns`, { title: 'סיום', type: 'button', settings: { button: { label: 'סיימתי', columnId: status.id, optionId: 'nope' } } })).statusCode).toBe(400);
    const btn = (await c.post(`/api/boards/${b.id}/columns`, { title: 'סיום', type: 'button' })).json().column; // configured later
    expect(btn.settings.button).toBeUndefined();
    expect((await c.patch(`/api/columns/${btn.id}`, { settings: { button: { label: 'סיימתי', columnId: status.id, optionId: done.id } } })).json().column.settings.button).toEqual({ label: 'סיימתי', action: 'set_status', columnId: status.id, optionId: done.id });
    // other actions: each needs a column of the right type (or a group) of this board
    const due = b.columns.find((x) => x.type === 'date')!;
    const who = b.columns.find((x) => x.type === 'person')!;
    const bad = (button: unknown) => c.patch(`/api/columns/${btn.id}`, { settings: { button } });
    expect((await bad({ label: 'היום', action: 'set_today', columnId: status.id })).statusCode).toBe(400);
    expect((await bad({ label: 'אני', action: 'assign_me', columnId: due.id })).statusCode).toBe(400);
    expect((await bad({ label: 'העבר', action: 'move_group', groupId: '00000000-0000-4000-8000-000000000000' })).statusCode).toBe(400);
    expect((await bad({ label: 'x', action: 'explode', columnId: due.id })).statusCode).toBe(400);
    expect((await bad({ label: 'היום', action: 'set_today', columnId: due.id })).json().column.settings.button).toEqual({ label: 'היום', action: 'set_today', columnId: due.id });
    expect((await bad({ label: 'אני', action: 'assign_me', columnId: who.id })).json().column.settings.button).toEqual({ label: 'אני', action: 'assign_me', columnId: who.id });
    expect((await bad({ label: 'העבר', action: 'move_group', groupId: b.groups[1]!.id })).json().column.settings.button).toEqual({ label: 'העבר', action: 'move_group', groupId: b.groups[1]!.id });
    await bad({ label: 'סיימתי', action: 'set_status', columnId: status.id, optionId: done.id });
    // the button column itself holds no value; pressing it is an ordinary, logged status change
    expect((await c.patch(`/api/items/${item.id}`, { values: { [btn.id]: 'x' } })).statusCode).toBe(400);
    expect((await c.patch(`/api/items/${item.id}`, { values: { [status.id]: done.id } })).statusCode).toBe(200);
    expect((await c.get(`/api/items/${item.id}/activity`)).json().activity.some((a: { action: string }) => a.action === 'item_value_changed')).toBe(true);
  });
});
