import type { BoardDetail } from '@suboard/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { Client, loggedIn, setup, type TestCtx } from './helpers.js';

let ctx: TestCtx;
afterEach(async () => ctx?.close());

describe('boards open to every user', () => {
  it('gives every regular user the open role, never guests, and closes again', async () => {
    ctx = await setup();
    const { client: admin } = await loggedIn(ctx, 'root@x.org', 'admin');
    const { client: boss } = await loggedIn(ctx, 'boss@x.org', 'manager');
    const { client: noa, user: noaUser } = await loggedIn(ctx, 'noa@x.org', 'member');
    const { client: dan } = await loggedIn(ctx, 'dan@x.org', 'member');
    const ws = (await boss.post('/api/workspaces', { name: 'כללי' })).json().workspace;
    const b = (await boss.post('/api/boards', { name: 'לוח מודעות', templateKey: 'blank', workspaceId: ws.id })).json().board as BoardDetail;
    const priv = (await boss.post('/api/boards', { name: 'פרטי', templateKey: 'blank' })).json().board as BoardDetail;
    const item = (await boss.post(`/api/boards/${b.id}/items`, { groupId: b.groups[0]!.id, name: 'הודעה' })).json().item as { id: string };
    expect(b.openRole).toBeNull();
    await boss.put(`/api/boards/${b.id}/members`, { userId: noaUser.id, role: 'editor' });

    // closed by default; only an owner opens it
    expect((await dan.get(`/api/boards/${b.id}`)).statusCode).toBe(404);
    expect((await dan.get('/api/workspaces')).json().workspaces).toEqual([]);
    expect((await noa.patch(`/api/boards/${b.id}`, { openRole: 'viewer' })).statusCode).toBe(403);
    expect((await boss.patch(`/api/boards/${b.id}`, { openRole: 'owner' })).statusCode).toBe(400);
    expect((await boss.patch(`/api/boards/${b.id}`, { openRole: 'viewer' })).json().board.openRole).toBe('viewer');

    // everyone can read; nobody gains more than the open role; a member keeps a higher role
    const seen = (await dan.get(`/api/boards/${b.id}`)).json().board as BoardDetail;
    expect([seen.myRole, seen.openRole]).toEqual(['viewer', 'viewer']);
    expect((await dan.get('/api/boards')).json().boards.map((x: { name: string; myRole: string }) => [x.name, x.myRole])).toEqual([['לוח מודעות', 'viewer']]);
    expect((await dan.get('/api/workspaces')).json().workspaces.map((w: { name: string }) => w.name)).toEqual(['כללי']);
    expect((await dan.get(`/api/search?q=${encodeURIComponent('הודעה')}`)).body).toContain(item.id);
    expect((await dan.patch(`/api/items/${item.id}`, { name: 'x' })).statusCode).toBe(403);
    expect((await dan.patch(`/api/boards/${b.id}`, { name: 'x' })).statusCode).toBe(403);
    expect((await noa.patch(`/api/items/${item.id}`, { name: 'הודעה מעודכנת' })).statusCode).toBe(200);
    expect((await dan.get(`/api/boards/${priv.id}`)).statusCode).toBe(404); // other boards stay closed

    // open for editing: items yes, structure and settings no
    await boss.patch(`/api/boards/${b.id}`, { openRole: 'editor' });
    expect((await dan.patch(`/api/items/${item.id}`, { name: 'דן ערך' })).statusCode).toBe(200);
    expect((await dan.post(`/api/boards/${b.id}/columns`, { title: 'x', type: 'text' })).statusCode).toBe(403);
    expect((await dan.put(`/api/boards/${b.id}/members`, { userId: noaUser.id, role: 'owner' })).statusCode).toBe(403);

    // a guest never benefits, even without the flag on the caller
    await admin.put('/api/admin/modules', { modules: { guests: true } });
    const until = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const guest = (await admin.post('/api/users', { email: 'g@ext.org', name: 'אורח', role: 'member', password: 'Guest-Pass-2026!x', guest: { expiresAt: until } })).json().user as { id: string };
    ctx.db.prepare('UPDATE users SET must_change_password = 0, mfa_enabled = 0 WHERE id = ?').run(guest.id);
    const g = new Client(ctx.app);
    await g.login('g@ext.org', 'Guest-Pass-2026!x');
    ctx.db.prepare('UPDATE users SET mfa_enabled = 1 WHERE id = ?').run(guest.id);
    expect((await g.get('/api/boards')).json().boards).toEqual([]);
    expect((await g.get(`/api/boards/${b.id}`)).statusCode).toBe(404);
    expect((await g.get('/api/workspaces')).json().workspaces).toEqual([]);
    expect(ctx.app.services.access.boardRole({ id: guest.id, name: 'אורח', role: 'member' }, b.id)).toBeNull();

    // closing: back to members only
    expect((await boss.patch(`/api/boards/${b.id}`, { openRole: null })).json().board.openRole).toBeNull();
    expect((await dan.get(`/api/boards/${b.id}`)).statusCode).toBe(404);
    expect((await dan.get('/api/boards')).json().boards).toEqual([]);
    expect((await noa.get(`/api/boards/${b.id}`)).statusCode).toBe(200);
    expect((ctx.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'board_opened'").get() as { n: number }).n).toBe(3);
  });
});
