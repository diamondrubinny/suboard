import type { BoardDetail } from '@suboard/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { loggedIn, setup, type TestCtx } from './helpers.js';

let ctx: TestCtx;
afterEach(async () => ctx?.close());

describe('maintenance and inspections kit', () => {
  it('creates three connected boards that work together end to end', async () => {
    ctx = await setup();
    const { client: boss } = await loggedIn(ctx, 'boss@x.org', 'manager');
    const { client: noa } = await loggedIn(ctx, 'noa@x.org', 'member');
    expect((await noa.post('/api/kits/maintenance', {})).statusCode).toBe(403);

    const made = await boss.post('/api/kits/maintenance', { workspaceName: 'תחזוקת גזים' });
    expect(made.statusCode).toBe(201);
    const { equipment, inspections, faults, workspaceId } = made.json() as { equipment: BoardDetail; inspections: BoardDetail; faults: BoardDetail; workspaceId: string };
    expect([equipment.name, inspections.name, faults.name]).toEqual(['ציוד', 'ביקורות', 'תקלות']);
    expect([equipment.itemTerm, inspections.itemTerm, faults.itemTerm]).toEqual(['פריט ציוד', 'ביקורת', 'תקלה']);
    expect([equipment.workspaceId, inspections.workspaceId, faults.workspaceId]).toEqual([workspaceId, workspaceId, workspaceId]);
    expect((await boss.get('/api/workspaces')).json().workspaces.map((w: { name: string }) => w.name)).toEqual(['תחזוקת גזים']);
    const col = (b: BoardDetail, title: string) => b.columns.find((c) => c.title === title)!;
    expect(col(inspections, 'ציוד').settings.relation).toEqual({ boardId: equipment.id });
    expect(col(faults, 'מיקום הציוד').settings.mirror).toEqual({ relationColumnId: col(faults, 'ציוד').id, targetColumnId: col(equipment, 'מיקום').id });
    expect(col(inspections, "צ'קליסט ביקורת").settings.checklist).toMatchObject({ capaBoardId: faults.id });

    // the flow: a piece of equipment, an inspection of it with a failed line → a fault opens by itself
    const hood = (await boss.post(`/api/boards/${equipment.id}/items`, { groupId: equipment.groups[0]!.id, name: 'מנדף כימי 3', values: { [col(equipment, 'מיקום').id]: 'בניין כימיה, חדר 214' } })).json().item as { id: string };
    const insp = (await boss.post(`/api/boards/${inspections.id}/items`, { groupId: inspections.groups[0]!.id, name: 'ביקורת רבעונית — מנדף 3' })).json().item as { id: string };
    expect((await boss.put(`/api/items/${insp.id}/relations/${col(inspections, 'ציוד').id}`, { itemIds: [hood.id] })).statusCode).toBe(200);
    const checklist = col(inspections, "צ'קליסט ביקורת");
    expect((await boss.patch(`/api/items/${insp.id}`, { values: { [checklist.id]: { visual: { r: 'pass' }, function: { r: 'fail' } } } })).statusCode).toBe(200);
    const inspBoard = (await boss.get(`/api/boards/${inspections.id}`)).json().board as BoardDetail;
    expect(inspBoard.mirrors![insp.id]![col(inspections, 'מיקום הציוד').id]).toEqual(['בניין כימיה, חדר 214']);
    const faultBoard = (await boss.get(`/api/boards/${faults.id}`)).json().board as BoardDetail;
    expect(faultBoard.items).toHaveLength(1);
    expect(faultBoard.items[0]!.name).toContain('בדיקת תפקוד');
    // the equipment row counts what is connected to it
    const eq = (await boss.get(`/api/boards/${equipment.id}`)).json().board as BoardDetail;
    expect(eq.linkStats![hood.id]).toEqual({ total: 1, done: 0 });

    // a second kit gets distinct names instead of three more boards called the same
    const again = (await boss.post('/api/kits/maintenance', {})).json() as { equipment: BoardDetail };
    expect(again.equipment.name).toMatch(/^ציוד \(\d{4}\)$/);
    expect((await boss.post('/api/kits/maintenance', {})).statusCode).toBe(400);
  });
});
