import {
  addDaysIso,
  findDueColumn,
  findPrimaryStatusColumn,
  formatDateHe,
  isItemDone,
  LIMITS,
  todayIso,
  weekdayOf,
  type BoardReportSummary,
  type ReportFrequency,
  type ReportItemRef,
  type ScheduledReport,
} from '@suboard/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../config.js';
import { nowIso, parseJson, type DB } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { badRequest, notFound } from '../lib/errors.js';
import type { AccessService, Actor } from './access.js';
import type { ActivityService } from './activity.js';
import type { BoardService } from './boards.js';
import type { ItemService } from './items.js';
import { toItem, type ItemRow } from './mappers.js';
import type { MailLine, NotificationService } from './notifications.js';

interface ReportRow {
  id: string;
  board_id: string;
  name: string;
  frequency: ReportFrequency;
  weekday: number;
  month_day: number;
  recipients: string;
  enabled: number;
  last_sent_day: string | null;
  created_by_name: string | null;
}

interface ReportInput {
  name: string;
  frequency: ReportFrequency;
  weekday: number;
  monthDay: number;
  recipients: string[];
  enabled: boolean;
}

const PERIOD_DAYS: Record<ReportFrequency, number> = { daily: 1, weekly: 7, monthly: 30 };
const LIST_MAX = 20;

/**
 * Board summary reports (status breakdown, overdue, upcoming, opened/closed in the period) and
 * their scheduled delivery. E-mails carry only names, counts and links — never free-text content.
 */
export class ReportService {
  constructor(
    private readonly db: DB,
    private readonly config: AppConfig,
    private readonly access: AccessService,
    private readonly boards: BoardService,
    private readonly items: ItemService,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationService,
    private log: Pick<FastifyBaseLogger, 'error' | 'info'> = console,
  ) {}

  setLogger(log: Pick<FastifyBaseLogger, 'error' | 'info'>) {
    this.log = log;
  }

  // ---------------------------------------------------------------- summary
  /** Board summary; `periodDays` controls the "opened / closed in the period" window. */
  summary(actor: Actor, boardId: string, periodDays = 7): BoardReportSummary {
    this.access.requireBoard(actor, boardId, 'viewer');
    return this.compute(boardId, periodDays);
  }

  private compute(boardId: string, periodDays: number, now: Date = new Date()): BoardReportSummary {
    const boardName = (this.db.prepare('SELECT name FROM boards WHERE id = ?').get(boardId) as { name: string }).name;
    const columns = this.boards.columns(boardId);
    const status = findPrimaryStatusColumn(columns);
    const due = findDueColumn(columns);
    const items = (this.db.prepare('SELECT * FROM items WHERE board_id = ? AND parent_id IS NULL AND deleted_at IS NULL').all(boardId) as ItemRow[]).map(toItem);
    const today = todayIso(this.config.timeZone, now);
    const cutoff = new Date(now.getTime() - periodDays * 86_400_000).toISOString();

    const counts = new Map<string | null, number>();
    for (const i of items) {
      const v = status ? i.values[status.id] : undefined;
      const key = typeof v === 'string' ? v : null;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const byStatus: BoardReportSummary['byStatus'] = (status?.settings.options ?? []).map((o) => ({
      optionId: o.id,
      label: o.label,
      color: o.color,
      count: counts.get(o.id) ?? 0,
    }));
    if (counts.get(null)) byStatus.push({ optionId: null, label: 'ללא סטטוס', color: null, count: counts.get(null) ?? 0 });

    const open = items.filter((i) => !isItemDone(i, status));
    const ref = (i: (typeof items)[number]): ReportItemRef => ({ id: i.id, name: i.name, date: due ? String(i.values[due.id]) : '' });
    const dated = due ? open.filter((i) => typeof i.values[due.id] === 'string').sort((a, b) => String(a.values[due.id]).localeCompare(String(b.values[due.id]))) : [];
    const horizon = addDaysIso(today, 7);
    const overdue = dated.filter((i) => String(i.values[due!.id]) < today);
    const upcoming = dated.filter((i) => String(i.values[due!.id]) >= today && String(i.values[due!.id]) <= horizon);

    let closedInPeriod = 0;
    if (status) {
      const doneIds = new Set((status.settings.options ?? []).filter((o) => o.done).map((o) => o.id));
      const changes = this.db
        .prepare(
          `SELECT DISTINCT a.item_id, json_extract(a.detail, '$.to') AS to_value FROM activity a
           WHERE a.board_id = ? AND a.action = 'item_value_changed' AND json_extract(a.detail, '$.columnId') = ? AND a.created_at >= ?`,
        )
        .all(boardId, status.id, cutoff) as { item_id: string; to_value: string | null }[];
      closedInPeriod = new Set(changes.filter((c) => c.to_value && doneIds.has(c.to_value)).map((c) => c.item_id)).size;
    }

    return {
      boardId,
      boardName,
      generatedAt: now.toISOString(),
      periodDays,
      total: items.length,
      open: open.length,
      byStatus,
      overdue: overdue.slice(0, LIST_MAX).map(ref),
      upcoming: upcoming.slice(0, LIST_MAX).map(ref),
      createdInPeriod: items.filter((i) => i.createdAt >= cutoff).length,
      closedInPeriod,
    };
  }

  // ---------------------------------------------------------------- CRUD
  private toReport(r: ReportRow): ScheduledReport {
    return {
      id: r.id,
      boardId: r.board_id,
      name: r.name,
      frequency: r.frequency,
      weekday: r.weekday,
      monthDay: r.month_day,
      recipients: parseJson<string[]>(r.recipients, []),
      enabled: r.enabled === 1,
      lastSentDay: r.last_sent_day,
      createdByName: r.created_by_name,
    };
  }

  private getRow(id: string): ReportRow {
    const r = this.db
      .prepare('SELECT r.*, u.name AS created_by_name FROM scheduled_reports r LEFT JOIN users u ON u.id = r.created_by WHERE r.id = ?')
      .get(id) as ReportRow | undefined;
    if (!r) throw notFound('הדוח לא נמצא');
    return r;
  }

  list(actor: Actor, boardId: string): ScheduledReport[] {
    this.access.requireBoard(actor, boardId, 'editor');
    return (
      this.db
        .prepare('SELECT r.*, u.name AS created_by_name FROM scheduled_reports r LEFT JOIN users u ON u.id = r.created_by WHERE r.board_id = ? ORDER BY r.created_at')
        .all(boardId) as ReportRow[]
    ).map((r) => this.toReport(r));
  }

  create(actor: Actor, boardId: string, input: ReportInput): ScheduledReport {
    this.access.requireBoard(actor, boardId, 'owner');
    const count = (this.db.prepare('SELECT COUNT(*) AS n FROM scheduled_reports WHERE board_id = ?').get(boardId) as { n: number }).n;
    if (count >= LIMITS.reportsPerBoard) throw badRequest(`ניתן להגדיר עד ${LIMITS.reportsPerBoard} דוחות ללוח`);
    const recipients = [...new Set(input.recipients)];
    this.items.assertUsersOnBoard(boardId, recipients, 'נמענים', 'recipients');
    const id = newId();
    const ts = nowIso();
    this.db
      .prepare(
        `INSERT INTO scheduled_reports (id, board_id, name, frequency, weekday, month_day, recipients, enabled, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, boardId, input.name, input.frequency, input.weekday, input.monthDay, JSON.stringify(recipients), input.enabled ? 1 : 0, actor.id, ts, ts);
    this.activity.record(boardId, actor.id, 'report_created', { name: input.name });
    return this.toReport(this.getRow(id));
  }

  update(actor: Actor, id: string, patch: Partial<ReportInput>): ScheduledReport {
    const row = this.getRow(id);
    this.access.requireBoard(actor, row.board_id, 'owner');
    const cur = this.toReport(row);
    const recipients = patch.recipients ? [...new Set(patch.recipients)] : cur.recipients;
    if (patch.recipients) this.items.assertUsersOnBoard(row.board_id, recipients, 'נמענים', 'recipients');
    this.db
      .prepare('UPDATE scheduled_reports SET name = ?, frequency = ?, weekday = ?, month_day = ?, recipients = ?, enabled = ?, updated_at = ? WHERE id = ?')
      .run(
        patch.name ?? cur.name,
        patch.frequency ?? cur.frequency,
        patch.weekday ?? cur.weekday,
        patch.monthDay ?? cur.monthDay,
        JSON.stringify(recipients),
        (patch.enabled ?? cur.enabled) ? 1 : 0,
        nowIso(),
        id,
      );
    this.activity.record(row.board_id, actor.id, 'report_updated', { name: patch.name ?? cur.name });
    return this.toReport(this.getRow(id));
  }

  remove(actor: Actor, id: string): void {
    const row = this.getRow(id);
    this.access.requireBoard(actor, row.board_id, 'owner');
    this.db.prepare('DELETE FROM scheduled_reports WHERE id = ?').run(id);
    this.activity.record(row.board_id, actor.id, 'report_deleted', { name: row.name });
  }

  // ---------------------------------------------------------------- delivery
  private isDue(r: ScheduledReport, today: string): boolean {
    if (r.frequency === 'daily') return true;
    if (r.frequency === 'weekly') return weekdayOf(today) === r.weekday;
    return Number(today.slice(8, 10)) === r.monthDay;
  }

  private mailLines(s: BoardReportSummary): MailLine[] {
    const b = s.boardId;
    const lines: MailLine[] = [
      { text: `סה"כ ${s.total} פריטים, ${s.open} פתוחים`, boardId: b, plain: true },
      { text: `ב-${s.periodDays} הימים האחרונים: נפתחו ${s.createdInPeriod}, נסגרו ${s.closedInPeriod}`, boardId: b, plain: true },
      ...s.byStatus.filter((x) => x.count > 0).map((x) => ({ text: `${x.label}: ${x.count}`, boardId: b, plain: true })),
      { text: `באיחור: ${s.overdue.length}${s.overdue.length >= LIST_MAX ? '+' : ''}`, boardId: b, plain: true },
      ...s.overdue.map((i) => ({ text: `באיחור — ${i.name} (יעד ${formatDateHe(i.date)})`, boardId: b, itemId: i.id })),
      ...s.upcoming.map((i) => ({ text: `יעד קרוב — ${i.name} (${formatDateHe(i.date)})`, boardId: b, itemId: i.id })),
      { text: 'פתיחת הלוח', boardId: b },
    ];
    return lines;
  }

  /** Sends the reports due today (after DIGEST_HOUR). Each report is sent at most once per local day. */
  async runDue(now: Date = new Date(), force = false): Promise<number> {
    const today = todayIso(this.config.timeZone, now);
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: this.config.timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now));
    if (!force && hour < this.config.digestHour) return 0;
    const rows = this.db
      .prepare(
        `SELECT r.*, NULL AS created_by_name FROM scheduled_reports r JOIN boards b ON b.id = r.board_id
         WHERE r.enabled = 1 AND b.archived_at IS NULL AND (r.last_sent_day IS NULL OR r.last_sent_day <> ?)`,
      )
      .all(today) as ReportRow[];
    let sent = 0;
    for (const row of rows) {
      const r = this.toReport(row);
      if (!this.isDue(r, today)) continue;
      const claimed = this.db
        .prepare('UPDATE scheduled_reports SET last_sent_day = ? WHERE id = ? AND (last_sent_day IS NULL OR last_sent_day <> ?)')
        .run(today, r.id, today).changes;
      if (!claimed) continue;
      try {
        const summary = this.compute(r.boardId, PERIOD_DAYS[r.frequency], now);
        sent += await this.notifications.onReport(r.boardId, r.name, r.recipients, this.mailLines(summary));
      } catch (err) {
        this.log.error({ reportId: r.id, err: err instanceof Error ? err.message : String(err) }, 'scheduled report failed');
      }
    }
    if (sent) this.log.info({ sent }, 'scheduled reports');
    return sent;
  }
}
