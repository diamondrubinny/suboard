import type { BoardDetail, ItemTime } from '@suboard/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { Client, createUser, loggedIn, setup, type TestCtx } from './helpers.js';

let ctx: TestCtx;
afterEach(async () => ctx?.close());

describe('time tracking', () => {
  it('is off by default; timers and manual entries add up; details stay with the person and the owners', async () => {
    ctx = await setup();
    const { client: admin } = await loggedIn(ctx, 'root@x.org', 'admin');
    const { client: boss } = await loggedIn(ctx, 'boss@x.org', 'manager');
    const b = (await boss.post('/api/boards', { name: 'משימות', templateKey: 'blank' })).json().board as BoardDetail;
    const item = (await boss.post(`/api/boards/${b.id}/items`, { groupId: b.groups[0]!.id, name: 'סקר' })).json().item as { id: string };
    const second = (await boss.post(`/api/boards/${b.id}/items`, { groupId: b.groups[0]!.id, name: 'דוח' })).json().item as { id: string };

    // module off: no column, no API
    expect((await boss.post(`/api/boards/${b.id}/columns`, { title: 'זמן', type: 'time' })).statusCode).toBe(400);
    expect((await boss.get(`/api/items/${item.id}/time`)).json().error.code).toBe('MODULE_DISABLED');
    await admin.put('/api/admin/modules', { modules: { time_tracking: true } });
    // no time column yet → nothing to log against
    expect((await boss.post(`/api/items/${item.id}/time/start`)).statusCode).toBe(400);
    const col = (await boss.post(`/api/boards/${b.id}/columns`, { title: 'זמן', type: 'time' })).json().column;
    expect((await boss.patch(`/api/items/${item.id}`, { values: { [col.id]: 5 } })).statusCode).toBe(400); // read-only cell

    const noa = await createUser(ctx, 'noa@x.org', 'member');
    const dan = await createUser(ctx, 'dan@x.org', 'member');
    await boss.put(`/api/boards/${b.id}/members`, { userId: noa.id, role: 'editor' });
    await boss.put(`/api/boards/${b.id}/members`, { userId: dan.id, role: 'viewer' });
    const n = new Client(ctx.app);
    await n.login('noa@x.org');
    const d = new Client(ctx.app);
    await d.login('dan@x.org');

    // manual entries
    expect((await n.post(`/api/items/${item.id}/time`, { minutes: 0, date: '2026-11-10' })).statusCode).toBe(400);
    expect((await n.post(`/api/items/${item.id}/time`, { minutes: 5000, date: '2026-11-10' })).statusCode).toBe(400);
    expect((await n.post(`/api/items/${item.id}/time`, { minutes: 30, date: '2999-01-01' })).statusCode).toBe(400);
    expect((await d.post(`/api/items/${item.id}/time`, { minutes: 30, date: '2026-11-10' })).statusCode).toBe(403); // viewers do not log time
    expect(((await n.post(`/api/items/${item.id}/time`, { minutes: 90, date: '2026-11-10', note: 'סיור' })).json().time as ItemTime).totalSeconds).toBe(5400);
    await boss.post(`/api/items/${item.id}/time`, { minutes: 30, date: '2026-11-11' });

    // one running timer per person: starting on another item stops the first
    await n.post(`/api/items/${item.id}/time/start`);
    ctx.db.prepare('UPDATE time_entries SET started_at = ? WHERE user_id = ? AND ended_at IS NULL').run(new Date(Date.now() - 600_000).toISOString(), noa.id);
    await n.post(`/api/items/${second.id}/time/start`);
    const running = ctx.db.prepare('SELECT item_id FROM time_entries WHERE user_id = ? AND ended_at IS NULL').all(noa.id) as { item_id: string }[];
    expect(running).toEqual([{ item_id: second.id }]);
    const closed = ctx.db.prepare('SELECT seconds FROM time_entries WHERE user_id = ? AND item_id = ? AND ended_at IS NOT NULL ORDER BY started_at DESC').get(noa.id, item.id) as { seconds: number };
    expect(closed.seconds).toBeGreaterThanOrEqual(599);
    expect(closed.seconds).toBeLessThan(700);

    // board payload: totals for everyone; "running since" only for the person; others see a count
    const forNoa = (await n.get(`/api/boards/${b.id}`)).json().board as BoardDetail;
    expect(forNoa.timeTotals![item.id]!.seconds).toBeGreaterThanOrEqual(5400 + 1800 + 599);
    expect(forNoa.timeTotals![second.id]).toMatchObject({ othersRunning: 0 });
    expect(forNoa.timeTotals![second.id]!.runningSince).toBeTruthy();
    const forBoss = (await boss.get(`/api/boards/${b.id}`)).json().board as BoardDetail;
    expect(forBoss.timeTotals![second.id]).toMatchObject({ runningSince: null, othersRunning: 1 });

    // who logged what: the person sees only their own entries; a viewer sees none; the owner sees all
    const mine = (await n.get(`/api/items/${item.id}/time`)).json().time as ItemTime;
    expect(mine.detailed).toBe(false);
    expect(mine.entries.every((e) => e.mine)).toBe(true);
    expect(mine.entries).toHaveLength(2);
    expect(mine.totalSeconds).toBeGreaterThan(mine.mineSeconds); // the total includes the owner's half hour
    const viewer = (await d.get(`/api/items/${item.id}/time`)).json().time as ItemTime;
    expect(viewer.entries).toEqual([]);
    expect(viewer.totalSeconds).toBe(mine.totalSeconds);
    expect(JSON.stringify(viewer)).not.toContain('noa');
    const all = (await boss.get(`/api/items/${item.id}/time`)).json().time as ItemTime;
    expect(all.detailed).toBe(true);
    expect(new Set(all.entries.map((e) => e.userName))).toEqual(new Set(['noa', 'boss']));

    // stop; a forgotten timer is capped
    expect((await n.post(`/api/items/${item.id}/time/stop`)).statusCode).toBe(400); // her timer is on the other item
    ctx.db.prepare('UPDATE time_entries SET started_at = ? WHERE user_id = ? AND ended_at IS NULL').run(new Date(Date.now() - 3 * 86_400_000).toISOString(), noa.id);
    expect(((await n.post(`/api/items/${second.id}/time/stop`)).json().time as ItemTime).totalSeconds).toBe(12 * 3600);

    // delete: own entry yes, someone else's no (unless owner); strangers 404
    const bossEntry = all.entries.find((e) => e.userName === 'boss')!.id;
    const noaEntry = mine.entries[0]!.id;
    expect((await n.del(`/api/time/${bossEntry}`)).statusCode).toBe(403);
    expect((await n.del(`/api/time/${noaEntry}`)).statusCode).toBe(200);
    expect((await boss.del(`/api/time/${mine.entries[1]!.id}`)).statusCode).toBe(200);
    await createUser(ctx, 'eve@x.org', 'member');
    const e = new Client(ctx.app);
    await e.login('eve@x.org');
    expect((await e.del(`/api/time/${bossEntry}`)).statusCode).toBe(404);
    expect((await e.get(`/api/items/${item.id}/time`)).statusCode).toBe(404);

    // export shows the total; deleting the item removes its entries
    expect((await boss.get(`/api/boards/${b.id}/export.csv`)).body).toContain('0:30');
    await boss.del(`/api/items/${second.id}`);
    expect((await boss.get(`/api/boards/${b.id}`)).json().board.timeTotals[second.id]).toBeUndefined();
    // switching the module off hides the data without deleting it
    await admin.put('/api/admin/modules', { modules: { time_tracking: false } });
    expect((await boss.get(`/api/boards/${b.id}`)).json().board.timeTotals).toBeUndefined();
    expect((ctx.db.prepare('SELECT COUNT(*) AS n FROM time_entries').get() as { n: number }).n).toBeGreaterThan(0);
  });
});
