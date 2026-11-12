import type { BoardDetail } from '@suboard/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { loggedIn, setup, type TestCtx } from './helpers.js';

let ctx: TestCtx;
afterEach(async () => ctx?.close());

describe('wave V — columns locked to the board owners', () => {
  it('editors cannot write a locked column through any path; owners, automations and unlocking still work', async () => {
    ctx = await setup();
    const { client: boss } = await loggedIn(ctx, 'boss@x.org', 'manager');
    const { client: noa, user: noaUser } = await loggedIn(ctx, 'noa@x.org', 'member');
    const b = (await boss.post('/api/boards', { name: 'ציוד', templateKey: 'blank' })).json().board as BoardDetail;
    await boss.put(`/api/boards/${b.id}/members`, { userId: noaUser.id, role: 'editor' });
    const opts = [{ id: 'ok', label: 'תקין', color: 'green' }, { id: 'bad', label: 'פסול', color: 'red' }];
    const verdict = (await boss.post(`/api/boards/${b.id}/columns`, { title: 'פסיקה', type: 'status', settings: { options: opts, editBy: 'owners' } })).json().column;
    const note = (await boss.post(`/api/boards/${b.id}/columns`, { title: 'הערה', type: 'text' })).json().column;
    expect(verdict.settings.editBy).toBe('owners');
    expect(note.settings.editBy).toBeUndefined();
    const g = b.groups[0]!.id;
    const item = (await boss.post(`/api/boards/${b.id}/items`, { groupId: g, name: 'מנדף', values: { [verdict.id]: 'ok' } })).json().item as { id: string };

    // the editor: every write path is refused for the locked column, and allowed for the open one
    const no = async (res: { statusCode: number; json: () => { error: { message: string } } }) => {
      expect(res.statusCode).toBe(403);
      expect(res.json().error.message).toContain('רק בעלי הלוח');
    };
    await no(await noa.patch(`/api/items/${item.id}`, { values: { [verdict.id]: 'bad' } }));
    await no(await noa.patch(`/api/items/${item.id}`, { values: { [note.id]: 'x', [verdict.id]: null } }));
    await no(await noa.post(`/api/boards/${b.id}/items`, { groupId: g, name: 'חדש', values: { [verdict.id]: 'bad' } }));
    await no(await noa.post(`/api/boards/${b.id}/items/bulk`, { action: 'set_value', itemIds: [item.id], columnId: verdict.id, value: 'bad' }));
    await no(await noa.post(`/api/boards/${b.id}/import`, { groupId: g, rows: [{ name: 'מיובא', values: { [verdict.id]: 'bad' } }] }));
    expect((await noa.patch(`/api/items/${item.id}`, { values: { [note.id]: 'נבדק' } })).statusCode).toBe(200);
    expect((await noa.post(`/api/boards/${b.id}/items`, { groupId: g, name: 'בלי פסיקה' })).statusCode).toBe(201);
    const now = (await boss.get(`/api/boards/${b.id}`)).json().board as BoardDetail;
    expect(now.items.find((i) => i.id === item.id)!.values).toEqual({ [verdict.id]: 'ok', [note.id]: 'נבדק' });
    expect(now.items.filter((i) => i.name === 'חדש' || i.name === 'מיובא')).toEqual([]);

    // the lock survives saving the labels; editors cannot unlock (column settings are the owner's)
    expect((await boss.patch(`/api/columns/${verdict.id}`, { settings: { options: [...opts, { id: 'na', label: 'לא רלוונטי', color: 'gray' }] } })).json().column.settings.editBy).toBe('owners');
    expect((await noa.patch(`/api/columns/${verdict.id}`, { settings: { options: opts, editBy: 'editors' } })).statusCode).toBe(403);
    // the owner edits freely
    expect((await boss.patch(`/api/items/${item.id}`, { values: { [verdict.id]: 'bad' } })).statusCode).toBe(200);

    // a locked connect-boards column
    const other = (await boss.post('/api/boards', { name: 'אנשים', templateKey: 'blank' })).json().board as BoardDetail;
    await boss.put(`/api/boards/${other.id}/members`, { userId: noaUser.id, role: 'viewer' });
    const person = (await boss.post(`/api/boards/${other.id}/items`, { groupId: other.groups[0]!.id, name: 'טכנאי' })).json().item as { id: string };
    const rel = (await boss.post(`/api/boards/${b.id}/columns`, { title: 'אחראי', type: 'relation', settings: { relation: { boardId: other.id }, editBy: 'owners' } })).json().column;
    await no(await noa.put(`/api/items/${item.id}/relations/${rel.id}`, { itemIds: [person.id] }));
    expect((await boss.put(`/api/items/${item.id}/relations/${rel.id}`, { itemIds: [person.id] })).statusCode).toBe(200);

    // unlock → the editor may write again
    expect((await boss.patch(`/api/columns/${verdict.id}`, { settings: { options: opts, editBy: 'editors' } })).json().column.settings.editBy).toBeUndefined();
    expect((await noa.patch(`/api/items/${item.id}`, { values: { [verdict.id]: 'ok' } })).statusCode).toBe(200);
  });
});
