import {
  addDaysIso,
  findDueColumn,
  findPrimaryStatusColumn,
  isItemDone,
  todayIso,
  type Column,
  type Dashboard,
  type DashboardBoardStat,
  type DashboardItemRef,
  type Item,
  type MyWorkItem,
} from '@suboard/shared';
import type { DB } from '../db/index.js';
import type { AccessService, Actor } from './access.js';
import type { BoardService } from './boards.js';
import { toItem, type ItemRow } from './mappers.js';

const MAX_LIST = 50;

export class DashboardService {
  constructor(
    private readonly db: DB,
    private readonly access: AccessService,
    private readonly boards: BoardService,
    private readonly timeZone: string,
  ) {}

  build(actor: Actor, now: Date = new Date()): Dashboard {
    const today = todayIso(this.timeZone, now);
    const soon = addDaysIso(today, 7);
    const myOpenItems: DashboardItemRef[] = [];
    const overdue: DashboardItemRef[] = [];
    const dueSoon: DashboardItemRef[] = [];
    const stats: DashboardBoardStat[] = [];

    for (const boardId of this.access.accessibleBoardIds(actor)) {
      const { name: boardName } = this.db.prepare('SELECT name FROM boards WHERE id = ?').get(boardId) as { name: string };
      const columns = this.boards.columns(boardId);
      const items = (this.db.prepare('SELECT * FROM items WHERE board_id = ? AND deleted_at IS NULL').all(boardId) as ItemRow[]).map(toItem);
      const statusCol = findPrimaryStatusColumn(columns);
      const dueCol = findDueColumn(columns);
      const personCols = columns.filter((c) => c.type === 'person');

      const byStatus = new Map<string, { label: string; color: DashboardBoardStat['byStatus'][number]['color']; count: number }>();
      for (const o of statusCol?.settings.options ?? []) byStatus.set(o.id, { label: o.label, color: o.color, count: 0 });
      let open = 0;
      let overdueCount = 0;

      for (const item of items) {
        const done = isItemDone(item, statusCol);
        const statusVal = statusCol ? item.values[statusCol.id] : undefined;
        if (typeof statusVal === 'string') {
          const s = byStatus.get(statusVal);
          if (s) s.count++;
        }
        if (done) continue;
        open++;
        const ref = this.ref(item, boardName, statusCol, dueCol);
        const due = ref.dueDate;
        if (due && due < today) {
          overdueCount++;
          overdue.push(ref);
        } else if (due && due <= soon) {
          dueSoon.push(ref);
        }
        if (personCols.some((c) => Array.isArray(item.values[c.id]) && (item.values[c.id] as string[]).includes(actor.id))) {
          myOpenItems.push(ref);
        }
      }

      stats.push({
        boardId,
        boardName,
        total: items.length,
        open,
        overdue: overdueCount,
        byStatus: [...byStatus.values()],
      });
    }

    const byDue = (a: DashboardItemRef, b: DashboardItemRef) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999');
    return {
      myOpenItems: myOpenItems.sort(byDue).slice(0, MAX_LIST),
      overdue: overdue.sort(byDue).slice(0, MAX_LIST),
      dueSoon: dueSoon.sort(byDue).slice(0, MAX_LIST),
      boards: stats.sort((a, b) => b.overdue - a.overdue || b.open - a.open),
    };
  }

  /** Every open item / sub-item assigned to the actor, across the boards they can see, by due date. */
  myWork(actor: Actor): MyWorkItem[] {
    const out: MyWorkItem[] = [];
    for (const boardId of this.access.accessibleBoardIds(actor)) {
      const columns = this.boards.columns(boardId);
      const personCols = columns.filter((c) => c.type === 'person');
      if (!personCols.length) continue;
      const { name: boardName } = this.db.prepare('SELECT name FROM boards WHERE id = ?').get(boardId) as { name: string };
      const statusCol = findPrimaryStatusColumn(columns);
      const dueCol = findDueColumn(columns);
      const doneOption = statusCol?.settings.options?.find((o) => o.done);
      const role = this.access.boardRole(actor, boardId);
      const complete = statusCol && doneOption && role && role !== 'viewer' ? { columnId: statusCol.id, optionId: doneOption.id } : null;
      const items = (this.db.prepare('SELECT * FROM items WHERE board_id = ? AND deleted_at IS NULL').all(boardId) as ItemRow[]).map(toItem);
      const names = new Map(items.map((i) => [i.id, i.name]));
      for (const item of items) {
        if (isItemDone(item, statusCol)) continue;
        if (!personCols.some((c) => Array.isArray(item.values[c.id]) && (item.values[c.id] as string[]).includes(actor.id))) continue;
        out.push({ ...this.ref(item, boardName, statusCol, dueCol), parentId: item.parentId, parentName: item.parentId ? (names.get(item.parentId) ?? null) : null, complete, statusId: statusCol && typeof item.values[statusCol.id] === 'string' ? (item.values[statusCol.id] as string) : null });
      }
    }
    return out.sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.itemName.localeCompare(b.itemName, 'he')).slice(0, 500);
  }

  private ref(item: Item, boardName: string, statusCol: Column | undefined, dueCol: Column | undefined): DashboardItemRef {
    const statusVal = statusCol ? item.values[statusCol.id] : undefined;
    const option = typeof statusVal === 'string' ? statusCol?.settings.options?.find((o) => o.id === statusVal) : undefined;
    const due = dueCol ? item.values[dueCol.id] : undefined;
    return {
      itemId: item.id,
      itemName: item.name,
      boardId: item.boardId,
      boardName,
      dueDate: typeof due === 'string' ? due : null,
      statusLabel: option?.label ?? null,
      statusColor: option?.color ?? null,
    };
  }
}
