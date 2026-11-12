import { MODULE_KEYS, moduleOfApiPath } from '@suboard/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { loggedIn, setup, type TestCtx } from './helpers.js';

let ctx: TestCtx;
afterEach(async () => ctx?.close());

describe('optional modules', () => {
  it('maps API paths to modules without catching core routes', () => {
    expect(moduleOfApiPath('/forms')).toBe('forms');
    expect(moduleOfApiPath('/forms/quick')).toBe('forms');
    expect(moduleOfApiPath('/boards/abc/forms')).toBe('forms');
    expect(moduleOfApiPath('/trainings/matrix')).toBe('trainings');
    expect(moduleOfApiPath('/me/trainings')).toBe('trainings');
    expect(moduleOfApiPath('/reports/monthly')).toBe('monthly_report');
    for (const core of ['/boards', '/boards/abc', '/items/1', '/me/work', '/formsx', '/boards/abc/items', '/auth/me', '/modules', '/admin/modules', '/reports', '/notifications'])
      expect(moduleOfApiPath(core), core).toBeNull();
  });

  it('an administrator switches a module off for everyone: API 404, state shared, audit, and back on', async () => {
    ctx = await setup();
    const { client: admin } = await loggedIn(ctx, 'root@x.org', 'admin');
    const { client: boss } = await loggedIn(ctx, 'boss@x.org', 'manager');
    const { client: noa } = await loggedIn(ctx, 'noa@x.org', 'member');

    const all = (await noa.get('/api/modules')).json().modules;
    expect(Object.keys(all).sort()).toEqual([...MODULE_KEYS].sort());
    expect(Object.values(all).every(Boolean)).toBe(true);
    expect((await boss.get('/api/trainings')).statusCode).toBe(200);

    // only administrators change it; unknown keys are ignored
    expect((await boss.put('/api/admin/modules', { modules: { trainings: false } })).statusCode).toBe(403);
    expect((await admin.put('/api/admin/modules', { modules: 'x' })).statusCode).toBe(400);
    const off = await admin.put('/api/admin/modules', { modules: { trainings: false, forms: false, nonsense: false } });
    expect(off.statusCode).toBe(200);
    expect(off.json().modules).toMatchObject({ trainings: false, forms: false, procedures: true });
    expect(off.json().modules.nonsense).toBeUndefined();

    for (const c of [admin, boss, noa]) {
      const res = await c.get('/api/trainings');
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('MODULE_DISABLED');
    }
    expect((await noa.get('/api/me/trainings')).statusCode).toBe(404);
    expect((await boss.post('/api/forms/quick', { name: 'x', questions: [] })).statusCode).toBe(404);
    const board = (await boss.post('/api/boards', { name: 'לוח', templateKey: 'blank' })).json().board;
    expect((await boss.get(`/api/boards/${board.id}/forms`)).statusCode).toBe(404);
    // core and other modules keep working
    expect((await boss.get(`/api/boards/${board.id}`)).statusCode).toBe(200);
    expect((await boss.get('/api/procedures')).statusCode).toBe(200);
    expect((await noa.get('/api/modules')).json().modules.trainings).toBe(false);
    // signed-out callers still get 401, not a hint about modules
    expect((await ctx.app.inject({ method: 'GET', url: '/api/trainings' })).statusCode).toBe(401);

    // survives a "restart" (a fresh service reads the stored setting) and comes back with its data
    expect(JSON.parse((ctx.db.prepare("SELECT value FROM app_settings WHERE key = 'modules'").get() as { value: string }).value).trainings).toBe(false);
    expect((await admin.put('/api/admin/modules', { modules: { trainings: true } })).json().modules.trainings).toBe(true);
    expect((await boss.get('/api/trainings')).statusCode).toBe(200);
    const audit = ctx.db.prepare("SELECT meta FROM audit_log WHERE event = 'modules_changed'").all() as { meta: string }[];
    expect(audit).toHaveLength(2);
    expect(JSON.parse(audit[0]!.meta)).toEqual({ trainings: false, forms: false });
  });
});
