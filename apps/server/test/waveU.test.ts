import type { BoardDetail } from '@suboard/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { loggedIn, setup, type TestCtx } from './helpers.js';

let ctx: TestCtx;
afterEach(async () => ctx?.close());

describe('wave U — workspaces', () => {
  it('organises boards without granting access, and never deletes boards', async () => {
    ctx = await setup();
    const { client: boss } = await loggedIn(ctx, 'boss@x.org', 'manager');
    const { client: noa, user: noaUser } = await loggedIn(ctx, 'noa@x.org', 'member');
    const { client: dan } = await loggedIn(ctx, 'dan@x.org', 'member');

    // only managers create; names are unique (case-insensitive) and validated
    expect((await noa.post('/api/workspaces', { name: 'שלי' })).statusCode).toBe(403);
    expect((await boss.post('/api/workspaces', { name: '' })).statusCode).toBe(400);
    const gas = (await boss.post('/api/workspaces', { name: 'תחזוקת גזים' })).json().workspace;
    const su = (await boss.post('/api/workspaces', { name: 'SU Workspace' })).json().workspace;
    expect((await boss.post('/api/workspaces', { name: 'su workspace' })).statusCode).toBe(400);

    const equipment = (await boss.post('/api/boards', { name: 'ציוד', templateKey: 'blank', workspaceId: gas.id })).json().board as BoardDetail;
    const tasks = (await boss.post('/api/boards', { name: 'משימות', templateKey: 'blank' })).json().board as BoardDetail;
    expect(equipment.workspaceId).toBe(gas.id);
    expect(tasks.workspaceId).toBeNull();
    // an unknown workspace on creation is ignored, not an error
    expect((await boss.post('/api/boards', { name: 'x', templateKey: 'blank', workspaceId: '00000000-0000-4000-8000-000000000000' })).json().board.workspaceId).toBeNull();

    // a member sees only workspaces that hold a board she can see — and being in a workspace grants nothing
    expect((await noa.get('/api/workspaces')).json().workspaces).toEqual([]);
    expect((await noa.get(`/api/boards/${equipment.id}`)).statusCode).toBe(404);
    await boss.put(`/api/boards/${equipment.id}/members`, { userId: noaUser.id, role: 'editor' });
    expect((await noa.get('/api/workspaces')).json().workspaces.map((w: { name: string }) => w.name)).toEqual(['תחזוקת גזים']);
    expect((await dan.get('/api/workspaces')).json().workspaces).toEqual([]);
    expect((await noa.get('/api/boards')).json().boards[0].workspaceId).toBe(gas.id);

    // moving a board: its owner, to an existing workspace or out of any
    expect((await noa.put(`/api/boards/${equipment.id}/workspace`, { workspaceId: su.id })).statusCode).toBe(403);
    expect((await dan.put(`/api/boards/${equipment.id}/workspace`, { workspaceId: su.id })).statusCode).toBe(404);
    expect((await boss.put(`/api/boards/${tasks.id}/workspace`, { workspaceId: '00000000-0000-4000-8000-000000000000' })).statusCode).toBe(400);
    expect((await boss.put(`/api/boards/${tasks.id}/workspace`, { workspaceId: su.id })).statusCode).toBe(200);
    expect((await boss.get(`/api/boards/${tasks.id}`)).json().board.workspaceId).toBe(su.id);
    expect((await boss.put(`/api/boards/${tasks.id}/workspace`, { workspaceId: null })).statusCode).toBe(200);

    // a duplicated board stays in the same workspace
    expect((await boss.post(`/api/boards/${equipment.id}/duplicate`, { name: 'ציוד 2027' })).json().board.workspaceId).toBe(gas.id);

    // rename; delete keeps the boards
    expect((await noa.patch(`/api/workspaces/${gas.id}`, { name: 'x' })).statusCode).toBe(403);
    expect((await boss.patch(`/api/workspaces/${gas.id}`, { name: 'SU Workspace' })).statusCode).toBe(400);
    expect((await boss.patch(`/api/workspaces/${gas.id}`, { name: 'גזים' })).json().workspace.name).toBe('גזים');
    expect((await noa.del(`/api/workspaces/${gas.id}`)).statusCode).toBe(403);
    expect((await boss.del(`/api/workspaces/${gas.id}`)).statusCode).toBe(200);
    expect((await boss.del(`/api/workspaces/${gas.id}`)).statusCode).toBe(404);
    const after = (await boss.get(`/api/boards/${equipment.id}`)).json().board as BoardDetail;
    expect(after.workspaceId).toBeNull();
    expect(after.name).toBe('ציוד');
    expect((ctx.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'workspace_changed'").get() as { n: number }).n).toBe(4);
  });
});
