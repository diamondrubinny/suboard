import type { BoardDetail, Column } from '@suboard/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClamdScanner } from '../src/lib/clamav.js';
import { files, startFakeClamd } from './fakes.js';
import { Client, createUser, loggedIn, setup, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let m: Client; // manager, board owner
let e: Client; // editor
let v: Client; // viewer
let o: Client; // outsider
let ids: Record<'m' | 'e' | 'v' | 'o', string>;
let board: BoardDetail;
const cleanups: (() => void)[] = [];

async function init(overrides = {}) {
  ctx = await setup({}, overrides);
  const mm = await loggedIn(ctx, 'manager@x.org', 'manager');
  const ee = await loggedIn(ctx, 'editor@x.org', 'member');
  const vv = await loggedIn(ctx, 'viewer@x.org', 'member');
  const oo = await loggedIn(ctx, 'outsider@x.org', 'member');
  [m, e, v, o] = [mm.client, ee.client, vv.client, oo.client];
  ids = { m: mm.user.id, e: ee.user.id, v: vv.user.id, o: oo.user.id };
  board = (await m.post('/api/boards', { name: 'פעולות מתקנות', templateKey: 'capa' })).json().board;
  await m.put(`/api/boards/${board.id}/members`, { userId: ids.e, role: 'editor' });
  await m.put(`/api/boards/${board.id}/members`, { userId: ids.v, role: 'viewer' });
}
afterEach(async () => {
  cleanups.splice(0).forEach((f) => f());
  await ctx.close();
});

const newItem = async (name: string, client = m, values: Record<string, unknown> = {}) => {
  const r = await client.post(`/api/boards/${board.id}/items`, { groupId: board.groups[0]!.id, name, values });
  expect(r.statusCode, r.body).toBe(201);
  return r.json().item as { id: string; values: Record<string, unknown> };
};
const notes = async (c: Client) => (await c.get('/api/notifications')).json().notifications as { kind: string; itemId: string | null; detail: string | null; read: boolean }[];

describe('H1 active sessions', () => {
  beforeEach(() => init());

  it('lists own devices, revokes one, revokes the others, never exposes the token or stored hash', async () => {
    const second = new Client(ctx.app);
    await second.req('POST', '/api/auth/login', { email: 'editor@x.org', password: 'Correct-Horse-Battery-1' }, { headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1' } });
    const third = new Client(ctx.app);
    await third.login('editor@x.org');

    const list = (await e.get('/api/auth/sessions')).json().sessions as { handle: string; device: string; current: boolean }[];
    expect(list).toHaveLength(3);
    expect(list.filter((s) => s.current)).toHaveLength(1);
    expect(list.some((s) => s.device === 'Safari · iOS')).toBe(true);
    const stored = (ctx.db.prepare('SELECT id FROM sessions').all() as { id: string }[]).map((r) => r.id);
    for (const s of list) {
      expect(s.handle).toMatch(/^[0-9a-f]{32}$/);
      expect(stored.some((id) => id.startsWith(s.handle)) || [e.token, second.token, third.token].includes(s.handle)).toBe(false);
    }

    // someone else's handle is not found; malformed handle is not found
    const mine = list.find((s) => s.device === 'Safari · iOS')!.handle;
    expect((await m.del(`/api/auth/sessions/${mine}`)).statusCode).toBe(404);
    expect((await e.del('/api/auth/sessions/zzz')).statusCode).toBe(404);
    expect((await e.del(`/api/auth/sessions/${mine}`)).json()).toEqual({ ok: true, signedOut: false });
    expect((await second.get('/api/auth/me')).statusCode).toBe(401);

    expect((await e.post('/api/auth/sessions/revoke-others')).json().sessions).toHaveLength(1);
    expect((await third.get('/api/auth/me')).statusCode).toBe(401);
    expect((await e.get('/api/auth/me')).statusCode).toBe(200);

    // revoking the current device signs this browser out
    const current = (await e.get('/api/auth/sessions')).json().sessions[0].handle;
    expect((await e.del(`/api/auth/sessions/${current}`)).json().signedOut).toBe(true);
    expect((await e.get('/api/auth/me')).statusCode).toBe(401);
    expect(ctx.app.services.audit.list({ event: 'session_revoked' })).toHaveLength(2);
  });

  it('admin signs a user out everywhere (keeping their own session when it is themselves)', async () => {
    const admin = await loggedIn(ctx, 'admin@x.org', 'admin');
    expect((await m.post(`/api/users/${ids.e}/revoke-sessions`)).statusCode).toBe(403);
    expect((await admin.client.post(`/api/users/${ids.e}/revoke-sessions`)).statusCode).toBe(200);
    expect((await e.get('/api/auth/me')).statusCode).toBe(401);
    expect((await admin.client.post(`/api/users/${admin.user.id}/revoke-sessions`)).statusCode).toBe(200);
    expect((await admin.client.get('/api/auth/me')).statusCode).toBe(200);
    expect((await admin.client.post('/api/users/00000000-0000-4000-8000-000000000000/revoke-sessions')).statusCode).toBe(404);
    expect(ctx.app.services.audit.list({ event: 'sessions_revoked_by_admin' })).toHaveLength(2);
  });
});

describe('H2 favourites and recent boards', () => {
  beforeEach(() => init());

  it('stars only visible boards; recent boards follow visits and access', async () => {
    const other = (await m.post('/api/boards', { name: 'אחר', templateKey: 'blank' })).json().board as BoardDetail;
    expect((await o.put(`/api/boards/${board.id}/favorite`, {})).statusCode).toBe(404);
    expect((await v.put(`/api/boards/${board.id}/favorite`, {})).statusCode).toBe(200);
    expect((await v.get('/api/boards')).json().boards.find((b: { id: string }) => b.id === board.id).favorite).toBe(true);
    expect((await m.get('/api/boards')).json().boards.every((b: { favorite: boolean }) => !b.favorite)).toBe(true);
    expect((await v.get(`/api/boards/${board.id}`)).json().board.favorite).toBe(true);
    await v.del(`/api/boards/${board.id}/favorite`);
    expect((await v.get(`/api/boards/${board.id}`)).json().board.favorite).toBe(false);

    await m.get(`/api/boards/${board.id}`);
    await m.get(`/api/boards/${other.id}`);
    expect((await m.get('/api/me/recent-boards')).json().boards.map((b: { id: string }) => b.id)).toEqual([other.id, board.id]);
    await m.get(`/api/boards/${board.id}`);
    expect((await m.get('/api/me/recent-boards')).json().boards[0].id).toBe(board.id);
    // outsider's failed read records nothing
    await o.get(`/api/boards/${board.id}`);
    expect((await o.get('/api/me/recent-boards')).json().boards).toEqual([]);
    // removed from the board → drops out of recents
    expect((await v.get('/api/me/recent-boards')).json().boards).toHaveLength(1);
    await m.del(`/api/boards/${board.id}/members/${ids.v}`);
    expect((await v.get('/api/me/recent-boards')).json().boards).toEqual([]);
  });

  it('keeps at most 20 visits per user and shows 8', async () => {
    for (let i = 0; i < 25; i++) {
      const b = (await m.post('/api/boards', { name: `לוח ${i}`, templateKey: 'blank' })).json().board as BoardDetail;
      await m.get(`/api/boards/${b.id}`);
    }
    expect((ctx.db.prepare('SELECT COUNT(*) AS n FROM board_visits WHERE user_id = ?').get(ids.m) as { n: number }).n).toBe(20);
    expect((await m.get('/api/me/recent-boards')).json().boards).toHaveLength(8);
  });
});

describe('H4 following items', () => {
  beforeEach(() => init());

  const statusCol = () => board.columns.find((c: Column) => c.type === 'status')!;
  const personCol = () => board.columns.find((c: Column) => c.type === 'person')!;

  it('auto-follows creator, assignees and writers; notifies others once per unread item', async () => {
    const item = await newItem('גידור פיר', m);
    expect((await m.get(`/api/items/${item.id}/follow`)).json().follow).toEqual({ following: true, count: 1 });
    expect((await o.get(`/api/items/${item.id}/follow`)).statusCode).toBe(404);

    await m.patch(`/api/items/${item.id}`, { values: { [personCol().id]: [ids.e] } });
    expect((await e.get(`/api/items/${item.id}/follow`)).json().follow.following).toBe(true);
    expect((await notes(m)).filter((n) => n.kind === 'followed')).toHaveLength(0); // own change

    // viewer follows explicitly
    expect((await v.put(`/api/items/${item.id}/follow`, {})).json().follow).toEqual({ following: true, count: 3 });

    // editor comments → manager + viewer hear about it, editor does not
    await e.post(`/api/items/${item.id}/updates`, { body: 'הוצב גידור זמני' });
    expect((await notes(m)).filter((n) => n.kind === 'followed')).toHaveLength(1);
    expect((await notes(v)).filter((n) => n.kind === 'followed')).toHaveLength(1);
    expect((await notes(e)).filter((n) => n.kind === 'followed')).toHaveLength(0);

    // status change while the previous notice is unread → refreshed, not duplicated
    const opt = statusCol().settings.options![1]!.id;
    await e.patch(`/api/items/${item.id}`, { values: { [statusCol().id]: opt } });
    const vf = (await notes(v)).filter((n) => n.kind === 'followed');
    expect(vf).toHaveLength(1);
    expect(vf[0]!.detail).toBe('status');
    // after reading, a new change makes a new notice
    await v.post('/api/notifications/read', { all: true });
    await e.post(`/api/items/${item.id}/updates`, { body: 'עוד' });
    expect((await notes(v)).filter((n) => n.kind === 'followed')).toHaveLength(2);

    // unfollow stops notices; removed from board stops notices
    await v.post('/api/notifications/read', { all: true });
    await v.del(`/api/items/${item.id}/follow`);
    await m.del(`/api/boards/${board.id}/members/${ids.e}`);
    await m.post(`/api/items/${item.id}/updates`, { body: 'סגור' });
    expect((await notes(v)).filter((n) => n.kind === 'followed' && !n.read)).toHaveLength(0);
    expect((await notes(e)).filter((n) => n.kind === 'followed')).toHaveLength(0);
  });

  it('a mention is not doubled by a follow notice; automation changes notify nobody', async () => {
    const item = await newItem('בדיקה', m);
    await e.put(`/api/items/${item.id}/follow`, {});
    await m.post(`/api/items/${item.id}/updates`, { body: '@editor ראה', mentions: [ids.e] });
    const en = await notes(e);
    expect(en.filter((n) => n.kind === 'mentioned')).toHaveLength(1);
    expect(en.filter((n) => n.kind === 'followed')).toHaveLength(0);
    ctx.app.services.items.systemUpdate({ id: null, name: 'אוטומציה' }, item.id, { values: { [statusCol().id]: statusCol().settings.options![2]!.id } });
    expect((await notes(e)).filter((n) => n.kind === 'followed')).toHaveLength(0);
  });
});

describe('H5 replies and reactions', () => {
  beforeEach(() => init());

  it('replies one level deep, notifies the author; reactions from the fixed set only', async () => {
    const item = await newItem('תחקיר', m);
    const root = (await m.post(`/api/items/${item.id}/updates`, { body: 'מה הסיבה?' })).json().update;
    const reply = (await e.post(`/api/items/${item.id}/updates`, { body: 'חוסר בגידור', parentId: root.id })).json().update;
    expect(reply.parentId).toBe(root.id);
    const nested = (await m.post(`/api/items/${item.id}/updates`, { body: 'תודה', parentId: reply.id })).json().update;
    expect(nested.parentId).toBe(root.id); // joins the same thread
    const mn = await notes(m);
    expect(mn.filter((n) => n.kind === 'reply')).toHaveLength(1);
    expect(mn.filter((n) => n.kind === 'followed')).toHaveLength(0); // the reply notice covers it
    expect((await notes(e)).filter((n) => n.kind === 'reply')).toHaveLength(0); // m replied to its own thread root

    // parent from another item is rejected
    const other = await newItem('אחר', m);
    expect((await m.post(`/api/items/${other.id}/updates`, { body: 'x', parentId: root.id })).statusCode).toBe(400);

    // reactions
    const enc = encodeURIComponent;
    expect((await e.put(`/api/updates/${root.id}/reactions/${enc('👍')}`, {})).statusCode).toBe(200);
    expect((await e.put(`/api/updates/${root.id}/reactions/${enc('👍')}`, {})).statusCode).toBe(200); // idempotent
    expect((await m.put(`/api/updates/${root.id}/reactions/${enc('👍')}`, {})).statusCode).toBe(200);
    expect((await m.put(`/api/updates/${root.id}/reactions/${enc('✅')}`, {})).statusCode).toBe(200);
    expect((await m.put(`/api/updates/${root.id}/reactions/${enc('<script>')}`, {})).statusCode).toBe(400);
    expect((await v.put(`/api/updates/${root.id}/reactions/${enc('👍')}`, {})).statusCode).toBe(403);
    expect((await o.put(`/api/updates/${root.id}/reactions/${enc('👍')}`, {})).statusCode).toBe(404);
    const ups = (await v.get(`/api/items/${item.id}/updates`)).json().updates as { id: string; reactions: { emoji: string; count: number; mine: boolean; users: string[] }[] }[];
    const r = ups.find((u) => u.id === root.id)!.reactions;
    expect(r).toEqual([
      { emoji: '👍', count: 2, mine: false, users: ['editor', 'manager'] },
      { emoji: '✅', count: 1, mine: false, users: ['manager'] },
    ]);
    await e.del(`/api/updates/${root.id}/reactions/${enc('👍')}`);
    const r2 = (await m.get(`/api/items/${item.id}/updates`)).json().updates.find((u: { id: string }) => u.id === root.id).reactions;
    expect(r2[0]).toMatchObject({ emoji: '👍', count: 1, mine: true });

    // deleting the root removes the thread and its reactions
    expect((await m.del(`/api/updates/${root.id}`)).statusCode).toBe(200);
    expect((await m.get(`/api/items/${item.id}/updates`)).json().updates).toHaveLength(0);
    expect((ctx.db.prepare('SELECT COUNT(*) AS n FROM update_reactions').get() as { n: number }).n).toBe(0);
  });
});

describe('H6 board files gallery', () => {
  it('lists only clean files of live items, to board members', async () => {
    const clamd = await startFakeClamd();
    cleanups.push(() => clamd.server.close());
    await init({ scanner: new ClamdScanner({ host: '127.0.0.1', port: clamd.port, timeoutMs: 5000 }) });
    const a = await newItem('מפגע א', e);
    const b = await newItem('מפגע ב', e);
    expect((await e.upload(`/api/items/${a.id}/attachments`, 'תמונה.png', files.png)).statusCode).toBe(201);
    expect((await e.upload(`/api/items/${b.id}/attachments`, 'דוח.pdf', files.pdf)).statusCode).toBe(201);
    const list = (await v.get(`/api/boards/${board.id}/files`)).json().files as { itemName: string; isImage: boolean; name: string }[];
    expect(list.map((f) => [f.itemName, f.isImage]).sort()).toEqual([
      ['מפגע א', true],
      ['מפגע ב', false],
    ]);
    expect((await o.get(`/api/boards/${board.id}/files`)).statusCode).toBe(404);
    await m.del(`/api/items/${b.id}`); // to the trash
    expect((await v.get(`/api/boards/${board.id}/files`)).json().files).toHaveLength(1);
    void createUser;
  });
});
