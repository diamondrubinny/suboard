import type { BoardDetail } from '@suboard/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { loggedIn, setup, type TestCtx } from './helpers.js';

let ctx: TestCtx;
afterEach(async () => ctx?.close());

describe('wave R — removing a label in use, saved advanced filters', () => {
  it('never drops values silently: a removed label must be moved or cleared on purpose', async () => {
    ctx = await setup();
    const { client: c } = await loggedIn(ctx, 'boss@x.org', 'manager');
    const b = (await c.post('/api/boards', { name: 'ציוד', templateKey: 'blank' })).json().board as BoardDetail;
    const opts = [
      { id: 'ok', label: 'תקין', color: 'green' },
      { id: 'bad', label: 'תקול', color: 'red' },
      { id: 'old', label: 'פסול', color: 'gray' },
    ];
    const st = (await c.post(`/api/boards/${b.id}/columns`, { title: 'מצב', type: 'status', settings: { options: opts } })).json().column;
    const tags = (await c.post(`/api/boards/${b.id}/columns`, { title: 'תגיות', type: 'tags', settings: { options: opts } })).json().column;
    const mk = async (name: string, values: Record<string, unknown>) => (await c.post(`/api/boards/${b.id}/items`, { groupId: b.groups[0]!.id, name, values })).json().item as { id: string };
    const a = await mk('א', { [st.id]: 'old', [tags.id]: ['old', 'ok'] });
    const d = await mk('ב', { [st.id]: 'bad', [tags.id]: ['bad'] });
    const values = async (id: string) => ((await c.get(`/api/boards/${b.id}`)).json().board as BoardDetail).items.find((i) => i.id === id)!.values;
    const without = (id: string) => opts.filter((o) => o.id !== id);

    // in use and no plan → refused, nothing changes
    const refused = await c.patch(`/api/columns/${st.id}`, { settings: { options: without('old') } });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.message).toContain('בשימוש ב-1 פריטים');
    expect((await values(a.id))[st.id]).toBe('old');
    // a target that is not a label of the column
    expect((await c.patch(`/api/columns/${st.id}`, { settings: { options: without('old') }, replaceOptions: { old: 'nope' } })).statusCode).toBe(400);
    // move to another label
    expect((await c.patch(`/api/columns/${st.id}`, { settings: { options: without('old') }, replaceOptions: { old: 'bad' } })).statusCode).toBe(200);
    expect((await values(a.id))[st.id]).toBe('bad');
    expect((await values(d.id))[st.id]).toBe('bad');
    // tags: moved without duplicates; cleared on purpose
    expect((await c.patch(`/api/columns/${tags.id}`, { settings: { options: without('old') }, replaceOptions: { old: 'ok' } })).statusCode).toBe(200);
    expect((await values(a.id))[tags.id]).toEqual(['ok']);
    expect((await c.patch(`/api/columns/${tags.id}`, { settings: { options: [opts[0]] }, replaceOptions: { bad: null } })).statusCode).toBe(200);
    expect((await values(d.id))[tags.id]).toBeUndefined();
    // a label nobody uses goes without questions; renaming and recolouring never need a plan
    expect((await c.patch(`/api/columns/${st.id}`, { settings: { options: [{ id: 'bad', label: 'מושבת', color: 'orange' }] } })).statusCode).toBe(200);
    expect((await values(a.id))[st.id]).toBe('bad');
  });

  it('saves an advanced filter inside a view and rejects malformed rules', async () => {
    ctx = await setup();
    const { client: c } = await loggedIn(ctx, 'boss@x.org', 'manager');
    const b = (await c.post('/api/boards', { name: 'פעולות', templateKey: 'capa' })).json().board as BoardDetail;
    const due = b.columns.find((x) => x.type === 'date')!;
    const filter = { match: 'any', rules: [{ columnId: due.id, op: 'overdue' }, { columnId: 'name', op: 'contains', value: 'מנדף' }] };
    const made = await c.post(`/api/boards/${b.id}/views`, { name: 'באיחור', config: { view: 'table', filter } });
    expect(made.statusCode).toBe(201);
    expect(made.json().view.config.filter).toEqual(filter);
    expect((await c.post(`/api/boards/${b.id}/views`, { name: 'x', config: { view: 'table', filter: { match: 'all', rules: [{ columnId: due.id, op: 'explode' }] } } })).statusCode).toBe(400);
    expect((await c.post(`/api/boards/${b.id}/views`, { name: 'x', config: { view: 'table', filter: { match: 'all', rules: [{ columnId: '../x', op: 'empty' }] } } })).statusCode).toBe(400);
    const many = Array.from({ length: 11 }, () => ({ columnId: 'name', op: 'contains', value: 'a' }));
    expect((await c.post(`/api/boards/${b.id}/views`, { name: 'x', config: { view: 'table', filter: { match: 'all', rules: many } } })).statusCode).toBe(400);
  });
});
