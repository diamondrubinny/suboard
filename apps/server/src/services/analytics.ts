import {
  addDaysIso,
  diffDaysIso,
  findDueColumn,
  findPrimaryStatusColumn,
  isItemDone,
  isRiskValue,
  riskLevel,
  riskScore,
  todayIso,
  type Column,
  type Item,
  type MonthlyReport,
  type TrendPoint,
  type Widget,
  type WidgetData,
  type WorkloadRow,
} from '@suboard/shared';
import type { AppConfig } from '../config.js';
import type { DB } from '../db/index.js';
import type { AccessService, Actor } from './access.js';
import type { BoardService } from './boards.js';
import type { ComplianceService } from './compliance.js';
import { toItem, type ItemRow } from './mappers.js';

const MONTHS_HE = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
type Level = 'low' | 'medium' | 'high' | 'critical';
const LEVELS: Level[] = ['low', 'medium', 'high', 'critical'];

/** Everything computed about one board, built once per request. */
interface BoardCtx {
  id: string;
  name: string;
  columns: Column[];
  status: Column | undefined;
  due: Column | undefined;
  items: Item[];
  /** item id → time of its first move to a "done" label (ISO), from the activity history. */
  closedAt: Map<string, string>;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const avg = (xs: number[]) => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/**
 * Read-only analytics over the boards an actor can see. Every public method intersects the
 * requested board ids with the actor's accessible boards — nothing outside them is ever counted.
 */
export class AnalyticsService {
  constructor(
    private readonly db: DB,
    private readonly config: AppConfig,
    private readonly access: AccessService,
    private readonly boards: BoardService,
    private readonly compliance: ComplianceService,
  ) {}

  private tz = () => this.config.timeZone;
  private localDay = (iso: string) => todayIso(this.tz(), new Date(iso));

  /** Requested ids ∩ accessible ids (empty request = all accessible boards). */
  scope(actor: Actor, requested: string[]): string[] {
    const allowed = this.access.accessibleBoardIds(actor);
    if (!requested.length) return allowed;
    const set = new Set(allowed);
    return requested.filter((id) => set.has(id));
  }

  private ctx(boardId: string): BoardCtx {
    const name = (this.db.prepare('SELECT name FROM boards WHERE id = ?').get(boardId) as { name: string } | undefined)?.name ?? '';
    const columns = this.boards.columns(boardId);
    const status = findPrimaryStatusColumn(columns);
    const items = (this.db.prepare('SELECT * FROM items WHERE board_id = ? AND parent_id IS NULL AND deleted_at IS NULL').all(boardId) as ItemRow[]).map(toItem);
    const closedAt = new Map<string, string>();
    if (status) {
      const done = new Set((status.settings.options ?? []).filter((o) => o.done).map((o) => o.id));
      const rows = this.db
        .prepare(
          `SELECT item_id, json_extract(detail, '$.to') AS to_value, created_at FROM activity
           WHERE board_id = ? AND action = 'item_value_changed' AND json_extract(detail, '$.columnId') = ?
           ORDER BY created_at, rowid`,
        )
        .all(boardId, status.id) as { item_id: string; to_value: string | null; created_at: string }[];
      for (const r of rows) if (r.to_value && done.has(r.to_value) && !closedAt.has(r.item_id)) closedAt.set(r.item_id, r.created_at);
      // Items created directly in a done state count as closed at creation.
      for (const i of items) if (!closedAt.has(i.id) && isItemDone(i, status)) closedAt.set(i.id, i.createdAt);
    }
    return { id: boardId, name, columns, status, due: findDueColumn(columns), items, closedAt };
  }

  private ctxs(ids: string[]): BoardCtx[] {
    return ids.map((id) => this.ctx(id));
  }

  private dueOf(c: BoardCtx, i: Item): string | null {
    const v = c.due ? i.values[c.due.id] : undefined;
    return typeof v === 'string' ? v : null;
  }

  // ---------------------------------------------------------------- periods
  private periods(period: 'week' | 'month', count: number, today: string): { start: string; end: string; label: string }[] {
    const out: { start: string; end: string; label: string }[] = [];
    if (period === 'month') {
      const [y, m] = today.split('-').map(Number) as [number, number];
      for (let k = count - 1; k >= 0; k--) {
        const d = new Date(Date.UTC(y, m - 1 - k, 1));
        const start = d.toISOString().slice(0, 10);
        const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
        out.push({ start, end, label: `${MONTHS_HE[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}` });
      }
    } else {
      const sunday = addDaysIso(today, -new Date(`${today}T00:00:00Z`).getUTCDay());
      for (let k = count - 1; k >= 0; k--) {
        const start = addDaysIso(sunday, -7 * k);
        out.push({ start, end: addDaysIso(start, 6), label: `${start.slice(8, 10)}/${start.slice(5, 7)}` });
      }
    }
    return out;
  }

  private trendOf(ctxs: BoardCtx[], period: 'week' | 'month', count: number, now: Date = new Date()): TrendPoint[] {
    const ps = this.periods(period, count, todayIso(this.tz(), now));
    return ps.map((p) => {
      let created = 0;
      const closeDays: number[] = [];
      for (const c of ctxs) {
        for (const i of c.items) {
          const cd = this.localDay(i.createdAt);
          if (cd >= p.start && cd <= p.end) created++;
          const closed = c.closedAt.get(i.id);
          if (closed) {
            const day = this.localDay(closed);
            if (day >= p.start && day <= p.end) closeDays.push(Math.max(0, diffDaysIso(cd, day)));
          }
        }
      }
      return { start: p.start, label: p.label, created, closed: closeDays.length, avgCloseDays: avg(closeDays) };
    });
  }

  trend(actor: Actor, boardIds: string[], period: 'week' | 'month', count: number): TrendPoint[] {
    return this.trendOf(this.ctxs(this.scope(actor, boardIds)), period, count);
  }

  // ---------------------------------------------------------------- workload
  private workloadOf(ctxs: BoardCtx[], now: Date = new Date()): WorkloadRow[] {
    const today = todayIso(this.tz(), now);
    const week = addDaysIso(today, 7);
    const names = new Map((this.db.prepare('SELECT id, name FROM users WHERE is_active = 1').all() as { id: string; name: string }[]).map((u) => [u.id, u.name]));
    const rows = new Map<string, WorkloadRow>();
    for (const c of ctxs) {
      const persons = c.columns.filter((x) => x.type === 'person');
      for (const i of c.items) {
        if (isItemDone(i, c.status)) continue;
        const ids = new Set<string>();
        for (const p of persons) if (Array.isArray(i.values[p.id])) (i.values[p.id] as string[]).forEach((u) => ids.add(u));
        const due = this.dueOf(c, i);
        for (const u of ids) {
          if (!names.has(u)) continue; // inactive / deleted users are not listed
          const r = rows.get(u) ?? { userId: u, name: names.get(u)!, open: 0, overdue: 0, dueWeek: 0, noDue: 0, boards: [] };
          rows.set(u, r);
          r.open++;
          const late = Boolean(due && due < today);
          if (late) r.overdue++;
          else if (due && due <= week) r.dueWeek++;
          if (!due) r.noDue++;
          let b = r.boards.find((x) => x.boardId === c.id);
          if (!b) r.boards.push((b = { boardId: c.id, boardName: c.name, open: 0, overdue: 0 }));
          b.open++;
          if (late) b.overdue++;
        }
      }
    }
    return [...rows.values()].sort((a, b) => b.overdue - a.overdue || b.open - a.open || a.name.localeCompare(b.name, 'he'));
  }

  workload(actor: Actor, boardIds: string[] = []): WorkloadRow[] {
    return this.workloadOf(this.ctxs(this.scope(actor, boardIds)));
  }

  // ---------------------------------------------------------------- helpers for widgets / monthly
  private overdueOf(ctxs: BoardCtx[], limit: number, now: Date = new Date()) {
    const today = todayIso(this.tz(), now);
    const out: { id: string; boardId: string; boardName: string; name: string; due: string; daysLate: number }[] = [];
    for (const c of ctxs) {
      for (const i of c.items) {
        const due = this.dueOf(c, i);
        if (due && due < today && !isItemDone(i, c.status)) out.push({ id: i.id, boardId: c.id, boardName: c.name, name: i.name, due, daysLate: diffDaysIso(due, today) });
      }
    }
    return out.sort((a, b) => b.daysLate - a.daysLate).slice(0, limit);
  }

  private riskOf(ctxs: BoardCtx[]): { levels: { level: Level; count: number }[]; unassessed: number } {
    const counts: Record<Level, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    let unassessed = 0;
    for (const c of ctxs) {
      const col = c.columns.find((x) => x.type === 'risk');
      if (!col) continue;
      for (const i of c.items) {
        if (isItemDone(i, c.status)) continue;
        const v = i.values[col.id];
        if (isRiskValue(v)) counts[riskLevel(riskScore(v))]++;
        else unassessed++;
      }
    }
    return { levels: LEVELS.map((level) => ({ level, count: counts[level] })), unassessed };
  }

  private monthBounds(month: string): { start: string; end: string } {
    const [y, m] = month.split('-').map(Number) as [number, number];
    return { start: `${month}-01`, end: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
  }

  // ---------------------------------------------------------------- widgets
  widget(actor: Actor, w: Widget, now: Date = new Date()): WidgetData {
    if (w.type === 'status') {
      if (!this.access.boardRole(actor, w.boardId)) return { type: 'empty', reason: 'הלוח לא זמין עבורך' };
      const c = this.ctx(w.boardId);
      if (!c.status) return { type: 'empty', reason: 'אין עמודת סטטוס בלוח' };
      const counts = new Map<string | null, number>();
      for (const i of c.items) {
        const v = i.values[c.status.id];
        const k = typeof v === 'string' ? v : null;
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      const rows = (c.status.settings.options ?? []).map((o) => ({ label: o.label, color: o.color, count: counts.get(o.id) ?? 0 }));
      if (counts.get(null)) rows.push({ label: 'ללא סטטוס', color: null as never, count: counts.get(null)! });
      return { type: 'status', boardName: c.name, rows };
    }
    const ids = this.scope(actor, w.boardIds);
    if (!ids.length) return { type: 'empty', reason: w.boardIds.length ? 'הלוחות שנבחרו לא זמינים עבורך' : 'אין לוחות' };
    const ctxs = this.ctxs(ids);
    switch (w.type) {
      case 'count': {
        const today = todayIso(this.tz(), now);
        const monthStart = `${today.slice(0, 7)}-01`;
        let value = 0;
        for (const c of ctxs) {
          for (const i of c.items) {
            const done = isItemDone(i, c.status);
            const due = this.dueOf(c, i);
            if (w.metric === 'open' && !done) value++;
            else if (w.metric === 'overdue' && !done && due && due < today) value++;
            else if (w.metric === 'due_week' && !done && due && due >= today && due <= addDaysIso(today, 7)) value++;
            else if (w.metric === 'created_month' && this.localDay(i.createdAt) >= monthStart) value++;
            else if (w.metric === 'closed_month') {
              const cl = c.closedAt.get(i.id);
              if (cl && this.localDay(cl) >= monthStart) value++;
            }
          }
        }
        return { type: 'count', value, boards: ctxs.length };
      }
      case 'trend':
        return { type: 'trend', points: this.trendOf(ctxs, w.period, w.count, now) };
      case 'overdue':
        return { type: 'overdue', items: this.overdueOf(ctxs, w.limit, now) };
      case 'workload':
        return { type: 'workload', rows: this.workloadOf(ctxs, now).slice(0, 15) };
      case 'compliance':
        return {
          type: 'compliance',
          rows: this.compliance
            .computeMany(ids)
            .map((c) => ({ boardId: c.boardId, boardName: c.boardName, percent: c.summary.percent, overdue: c.summary.overdue, total: c.summary.total })),
        };
      case 'risk':
        return { type: 'risk', ...this.riskOf(ctxs) };
    }
  }

  // ---------------------------------------------------------------- monthly management report (N11)
  monthly(actor: Actor, month?: string, now: Date = new Date()): MonthlyReport {
    const today = todayIso(this.tz(), now);
    const m = month ?? (() => {
      const [y, mm] = today.split('-').map(Number) as [number, number];
      return new Date(Date.UTC(y, mm - 2, 1)).toISOString().slice(0, 7); // previous month
    })();
    const cur = this.monthBounds(m);
    const [y, mm] = m.split('-').map(Number) as [number, number];
    const prevMonth = new Date(Date.UTC(y, mm - 2, 1)).toISOString().slice(0, 7);
    const prev = this.monthBounds(prevMonth);
    const ctxs = this.ctxs(this.access.accessibleBoardIds(actor));

    const stats = (c: BoardCtx, b: { start: string; end: string }) => {
      let created = 0;
      const days: number[] = [];
      for (const i of c.items) {
        const cd = this.localDay(i.createdAt);
        if (cd >= b.start && cd <= b.end) created++;
        const cl = c.closedAt.get(i.id);
        if (cl) {
          const d = this.localDay(cl);
          if (d >= b.start && d <= b.end) days.push(Math.max(0, diffDaysIso(cd, d)));
        }
      }
      return { created, closed: days.length, avgCloseDays: avg(days) };
    };

    const boards = ctxs
      .map((c) => {
        const s = stats(c, cur);
        let openAtEnd = 0;
        let overdueAtEnd = 0;
        for (const i of c.items) {
          if (this.localDay(i.createdAt) > cur.end) continue;
          const cl = c.closedAt.get(i.id);
          if (cl && this.localDay(cl) <= cur.end) continue;
          openAtEnd++;
          const due = this.dueOf(c, i);
          if (due && due < cur.end) overdueAtEnd++;
        }
        return { boardId: c.id, boardName: c.name, ...s, openAtEnd, overdueAtEnd, prev: stats(c, prev) };
      })
      .filter((r) => r.created || r.closed || r.openAtEnd || r.prev.created || r.prev.closed)
      .sort((a, b) => b.overdueAtEnd - a.overdueAtEnd || b.created - a.created);

    const sum = (f: (r: (typeof boards)[number]) => number) => boards.reduce((a, r) => a + f(r), 0);
    return {
      month: m,
      label: `${MONTHS_HE[mm - 1]} ${y}`,
      generatedAt: now.toISOString(),
      boards,
      totals: {
        created: sum((r) => r.created),
        closed: sum((r) => r.closed),
        overdueAtEnd: sum((r) => r.overdueAtEnd),
        prevCreated: sum((r) => r.prev.created),
        prevClosed: sum((r) => r.prev.closed),
      },
      compliance: this.compliance.computeMany(ctxs.map((c) => c.id)).map((c) => ({ boardId: c.boardId, boardName: c.boardName, percent: c.summary.percent, overdue: c.summary.overdue })),
      risk: this.riskOf(ctxs).levels,
      topOverdue: this.overdueOf(ctxs, 10, now),
    };
  }
}
