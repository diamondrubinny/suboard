import {
  findPrimaryStatusColumn,
  isDateRange,
  isItemDone,
  todayIso,
  type CustomDashboard,
  type DependencyInfo,
  type Widget,
  type WidgetData,
} from '@suboard/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../config.js';
import { nowIso, parseJson, type DB } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import type { AccessService, Actor } from './access.js';
import type { ActivityService } from './activity.js';
import type { AnalyticsService } from './analytics.js';
import type { BoardService } from './boards.js';
import { toItem, type ItemRow } from './mappers.js';
import type { MailLine, NotificationService } from './notifications.js';

interface DashboardRow {
  id: string;
  owner_id: string;
  owner_name: string | null;
  name: string;
  shared: number;
  widgets: string;
  updated_at: string;
}

/**
 * Custom dashboards. A shared dashboard is visible to every signed-in user, but each widget is
 * computed for the viewer: boards they cannot see are never counted or named.
 */
export class DashboardService {
  constructor(
    private readonly db: DB,
    private readonly access: AccessService,
    private readonly analytics: AnalyticsService,
  ) {}

  private toDashboard(r: DashboardRow, actor: Actor): CustomDashboard {
    return {
      id: r.id,
      name: r.name,
      shared: r.shared === 1,
      ownerId: r.owner_id,
      ownerName: r.owner_name,
      isOwner: r.owner_id === actor.id,
      widgets: parseJson<Widget[]>(r.widgets, []),
      updatedAt: r.updated_at,
    };
  }

  private row(actor: Actor, id: string): DashboardRow {
    const r = this.db
      .prepare('SELECT d.*, u.name AS owner_name FROM dashboards d LEFT JOIN users u ON u.id = d.owner_id WHERE d.id = ?')
      .get(id) as DashboardRow | undefined;
    // Someone else's private dashboard reads as not found.
    if (!r || (r.owner_id !== actor.id && r.shared !== 1)) throw notFound('הדשבורד לא נמצא');
    return r;
  }

  private ownRow(actor: Actor, id: string): DashboardRow {
    const r = this.row(actor, id);
    if (r.owner_id !== actor.id) throw forbidden('רק יוצר/ת הדשבורד יכול/ה לערוך אותו');
    return r;
  }

  /** Board references must be boards the owner can see at save time. */
  private validate(actor: Actor, widgets: Widget[], shared: boolean): void {
    if (shared && actor.role === 'member') throw forbidden('שיתוף דשבורד מותר למנהלים');
    const allowed = new Set(this.access.accessibleBoardIds(actor));
    for (const w of widgets) {
      const ids = w.type === 'status' ? [w.boardId] : w.boardIds;
      if (ids.some((id) => !allowed.has(id))) throw badRequest('אחד הלוחות בווידג\'ט אינו זמין', { widgets: 'לוח לא זמין' });
    }
    if (new Set(widgets.map((w) => w.id)).size !== widgets.length) throw badRequest('מזהי ווידג\'טים כפולים');
  }

  list(actor: Actor): CustomDashboard[] {
    return (
      this.db
        .prepare(
          `SELECT d.*, u.name AS owner_name FROM dashboards d LEFT JOIN users u ON u.id = d.owner_id
           WHERE d.owner_id = ? OR d.shared = 1 ORDER BY d.owner_id = ? DESC, d.name`,
        )
        .all(actor.id, actor.id) as DashboardRow[]
    ).map((r) => this.toDashboard(r, actor));
  }

  get(actor: Actor, id: string): CustomDashboard {
    return this.toDashboard(this.row(actor, id), actor);
  }

  create(actor: Actor, input: { name: string; shared: boolean; widgets: Widget[] }): CustomDashboard {
    const n = (this.db.prepare('SELECT COUNT(*) AS n FROM dashboards WHERE owner_id = ?').get(actor.id) as { n: number }).n;
    if (n >= 30) throw badRequest('ניתן ליצור עד 30 דשבורדים');
    this.validate(actor, input.widgets, input.shared);
    const id = newId();
    const ts = nowIso();
    this.db
      .prepare('INSERT INTO dashboards (id, owner_id, name, shared, widgets, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, actor.id, input.name, input.shared ? 1 : 0, JSON.stringify(input.widgets), ts, ts);
    return this.get(actor, id);
  }

  update(actor: Actor, id: string, patch: { name?: string; shared?: boolean; widgets?: Widget[] }): CustomDashboard {
    const r = this.ownRow(actor, id);
    const cur = this.toDashboard(r, actor);
    const next = { name: patch.name ?? cur.name, shared: patch.shared ?? cur.shared, widgets: patch.widgets ?? cur.widgets };
    // Sharing rights are checked when sharing is switched on.
    this.validate(actor, next.widgets, patch.shared === true && !cur.shared);
    this.db.prepare('UPDATE dashboards SET name = ?, shared = ?, widgets = ?, updated_at = ? WHERE id = ?').run(next.name, next.shared ? 1 : 0, JSON.stringify(next.widgets), nowIso(), id);
    return this.get(actor, id);
  }

  remove(actor: Actor, id: string): void {
    this.ownRow(actor, id);
    this.db.prepare('DELETE FROM dashboards WHERE id = ?').run(id);
  }

  /** Widget data computed for the viewer (not the owner). */
  data(actor: Actor, id: string): Record<string, WidgetData> {
    const d = this.get(actor, id);
    return Object.fromEntries(d.widgets.map((w) => [w.id, this.analytics.widget(actor, w)]));
  }
}

/** "Blocked by" dependencies between items of the same board (no cycles). */
export class DependencyService {
  constructor(
    private readonly db: DB,
    private readonly access: AccessService,
    private readonly boards: BoardService,
    private readonly activity: ActivityService,
  ) {}

  private liveItem(id: string): ItemRow {
    const r = this.db.prepare('SELECT * FROM items WHERE id = ? AND deleted_at IS NULL').get(id) as ItemRow | undefined;
    if (!r) throw notFound('הפריט לא נמצא');
    return r;
  }

  get(actor: Actor, itemId: string): DependencyInfo {
    const boardId = this.access.boardIdForItem(itemId);
    this.access.requireBoard(actor, boardId, 'viewer');
    const cols = this.boards.columns(boardId);
    const status = findPrimaryStatusColumn(cols);
    const range = cols.find((c) => c.type === 'date_range');
    const due = cols.find((c) => c.type === 'date' && c.settings.role === 'due') ?? cols.find((c) => c.type === 'date');
    const endOf = (i: ReturnType<typeof toItem>): string | null => {
      const r = range ? i.values[range.id] : undefined;
      if (isDateRange(r)) return r.to;
      const d = due ? i.values[due.id] : undefined;
      return typeof d === 'string' ? d : null;
    };
    const blockers = (
      this.db
        .prepare('SELECT i.* FROM item_dependencies d JOIN items i ON i.id = d.blocker_id WHERE d.blocked_id = ? AND i.deleted_at IS NULL ORDER BY i.name')
        .all(itemId) as ItemRow[]
    ).map(toItem);
    const blocks = (
      this.db
        .prepare('SELECT i.* FROM item_dependencies d JOIN items i ON i.id = d.blocked_id WHERE d.blocker_id = ? AND i.deleted_at IS NULL ORDER BY i.name')
        .all(itemId) as ItemRow[]
    ).map(toItem);
    return {
      itemId,
      blockedBy: blockers.map((b) => ({ id: b.id, name: b.name, done: isItemDone(b, status), end: endOf(b) })),
      blocks: blocks.map((b) => ({ id: b.id, name: b.name })),
    };
  }

  /** All dependencies of a board (for the Gantt view). */
  forBoard(actor: Actor, boardId: string): { blocker: string; blocked: string }[] {
    this.access.requireBoard(actor, boardId, 'viewer');
    return this.db
      .prepare(
        `SELECT d.blocker_id AS blocker, d.blocked_id AS blocked FROM item_dependencies d
         JOIN items a ON a.id = d.blocker_id AND a.deleted_at IS NULL
         JOIN items b ON b.id = d.blocked_id AND b.deleted_at IS NULL
         WHERE b.board_id = ?`,
      )
      .all(boardId) as { blocker: string; blocked: string }[];
  }

  set(actor: Actor, itemId: string, blockedBy: string[]): DependencyInfo {
    const boardId = this.access.boardIdForItem(itemId);
    this.access.requireBoard(actor, boardId, 'editor');
    const ids = [...new Set(blockedBy)];
    for (const id of ids) {
      if (id === itemId) throw badRequest('פריט לא יכול לחסום את עצמו');
      if (this.liveItem(id).board_id !== boardId) throw badRequest('תלות אפשרית רק בין פריטים באותו לוח', { blockedBy: 'פריט מלוח אחר' });
    }
    // Cycle check: would any new blocker (transitively) be blocked by this item?
    const blockedOf = this.db.prepare('SELECT blocked_id FROM item_dependencies WHERE blocker_id = ?');
    const reachable = new Set<string>();
    const stack = [itemId];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const r of blockedOf.all(cur) as { blocked_id: string }[]) {
        if (!reachable.has(r.blocked_id)) {
          reachable.add(r.blocked_id);
          stack.push(r.blocked_id);
        }
      }
    }
    const cyc = ids.find((id) => reachable.has(id));
    if (cyc) throw badRequest('התלות יוצרת מעגל (פריט שתלוי בפריט הזה לא יכול לחסום אותו)', { blockedBy: 'מעגל' });

    const ts = nowIso();
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM item_dependencies WHERE blocked_id = ?').run(itemId);
      const ins = this.db.prepare('INSERT INTO item_dependencies (blocker_id, blocked_id, created_by, created_at) VALUES (?, ?, ?, ?)');
      for (const id of ids) ins.run(id, itemId, actor.id, ts);
      this.activity.record(boardId, actor.id, 'dependencies_updated', { count: ids.length }, itemId);
      this.boards.touch(boardId);
    })();
    return this.get(actor, itemId);
  }
}

/** Monthly management e-mail (N11): on the 1st after DIGEST_HOUR, to managers / admins who opted in. */
export class MonthlyReportJob {
  constructor(
    private readonly db: DB,
    private readonly config: AppConfig,
    private readonly analytics: AnalyticsService,
    private readonly notifications: NotificationService,
    private log: Pick<FastifyBaseLogger, 'error' | 'info'> = console,
  ) {}

  setLogger(log: Pick<FastifyBaseLogger, 'error' | 'info'>) {
    this.log = log;
  }

  async run(now: Date = new Date(), force = false): Promise<number> {
    const today = todayIso(this.config.timeZone, now);
    if (!force) {
      const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: this.config.timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now));
      if (today.slice(8, 10) !== '01' || hour < this.config.digestHour) return 0;
    }
    const key = today.slice(0, 7);
    const last = this.db.prepare("SELECT last_run_day FROM job_runs WHERE name = 'monthly_report'").get() as { last_run_day: string } | undefined;
    if (!force && last?.last_run_day === key) return 0;
    this.db
      .prepare("INSERT INTO job_runs (name, last_run_day) VALUES ('monthly_report', ?) ON CONFLICT(name) DO UPDATE SET last_run_day = excluded.last_run_day")
      .run(key);
    const users = this.db
      .prepare("SELECT id, name, role FROM users WHERE is_active = 1 AND monthly_report = 1 AND role IN ('admin','manager')")
      .all() as Actor[];
    let sent = 0;
    for (const u of users) {
      try {
        const r = this.analytics.monthly(u, undefined, now);
        // Counts and board names only — no item names in the e-mail (details are in the app).
        const lines: MailLine[] = [
          { text: `נפתחו ${r.totals.created} (בחודש הקודם ${r.totals.prevCreated}) · נסגרו ${r.totals.closed} (בחודש הקודם ${r.totals.prevClosed})`, boardId: '', plain: true },
          { text: `באיחור בסוף החודש: ${r.totals.overdueAtEnd}`, boardId: '', plain: true },
          ...r.boards.slice(0, 15).map((b) => ({ text: `${b.boardName}: נפתחו ${b.created}, נסגרו ${b.closed}, באיחור ${b.overdueAtEnd}`, boardId: '', plain: true })),
          ...r.compliance.map((c) => ({ text: `תאימות ${c.boardName}: ${c.percent === null ? '—' : `${c.percent}%`}`, boardId: '', plain: true })),
        ];
        sent += await this.notifications.onMonthly(u.id, r.month, `מבט מנהל — ${r.label}`, lines);
      } catch (err) {
        this.log.error({ userId: u.id, err: err instanceof Error ? err.message : String(err) }, 'monthly report failed');
      }
    }
    return sent;
  }
}
