import {
  addDaysIso,
  LIMITS,
  nextOccurrence,
  todayIso,
  type CellValue,
  type Recurrence,
  type RecurrenceSchedule,
} from '@suboard/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../config.js';
import { nowIso, parseJson, type DB } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { AppError, badRequest, notFound } from '../lib/errors.js';
import type { AccessService, Actor } from './access.js';
import type { ActivityService } from './activity.js';
import type { BoardService } from './boards.js';
import type { ItemService } from './items.js';

interface RecurrenceRow {
  id: string;
  board_id: string;
  group_id: string;
  name: string;
  cell_values: string;
  schedule: string;
  due_column_id: string | null;
  due_offset_days: number;
  enabled: number;
  next_date: string | null;
  last_item_id: string | null;
  last_created_at: string | null;
  created_by_name: string | null;
}

interface RecurrenceInput {
  name: string;
  groupId: string;
  values?: Record<string, unknown>;
  schedule: RecurrenceSchedule;
  dueColumnId?: string | null;
  dueOffsetDays: number;
  enabled: boolean;
}

/**
 * Recurring items: a template (name, group, values) created automatically on a schedule.
 * If several occurrences were missed (server down), only one item is created and the schedule
 * moves forward — no flood of back-dated items.
 */
export class RecurrenceService {
  constructor(
    private readonly db: DB,
    private readonly config: AppConfig,
    private readonly access: AccessService,
    private readonly boards: BoardService,
    private readonly items: ItemService,
    private readonly activity: ActivityService,
    private log: Pick<FastifyBaseLogger, 'error' | 'info'> = console,
  ) {}

  setLogger(log: Pick<FastifyBaseLogger, 'error' | 'info'>) {
    this.log = log;
  }

  private toRecurrence(r: RecurrenceRow): Recurrence {
    return {
      id: r.id,
      boardId: r.board_id,
      groupId: r.group_id,
      name: r.name,
      values: parseJson<Record<string, CellValue>>(r.cell_values, {}),
      schedule: parseJson<RecurrenceSchedule>(r.schedule, { frequency: 'daily', interval: 1, startDate: '2000-01-01' }),
      dueColumnId: r.due_column_id,
      dueOffsetDays: r.due_offset_days,
      enabled: r.enabled === 1,
      nextDate: r.next_date,
      lastItemId: r.last_item_id,
      lastCreatedAt: r.last_created_at,
      createdByName: r.created_by_name,
    };
  }

  private getRow(id: string): RecurrenceRow {
    const r = this.db
      .prepare('SELECT r.*, u.name AS created_by_name FROM recurrences r LEFT JOIN users u ON u.id = r.created_by WHERE r.id = ?')
      .get(id) as RecurrenceRow | undefined;
    if (!r) throw notFound('הפריט החוזר לא נמצא');
    return r;
  }

  list(actor: Actor, boardId: string): Recurrence[] {
    this.access.requireBoard(actor, boardId, 'viewer');
    return (
      this.db
        .prepare('SELECT r.*, u.name AS created_by_name FROM recurrences r LEFT JOIN users u ON u.id = r.created_by WHERE r.board_id = ? ORDER BY r.created_at')
        .all(boardId) as RecurrenceRow[]
    ).map((r) => this.toRecurrence(r));
  }

  private validate(boardId: string, input: RecurrenceInput): Record<string, CellValue> {
    if (!this.db.prepare('SELECT 1 FROM board_groups WHERE id = ? AND board_id = ?').get(input.groupId, boardId)) {
      throw badRequest('הקבוצה אינה שייכת ללוח', { groupId: 'קבוצה לא תקינה' });
    }
    if (input.dueColumnId) {
      const col = this.boards.columns(boardId).find((c) => c.id === input.dueColumnId);
      if (!col || col.type !== 'date') throw badRequest('עמודת היעד חייבת להיות עמודת תאריך בלוח', { dueColumnId: 'עמודה לא תקינה' });
    }
    const values = this.items.validateValues(boardId, input.values ?? {});
    return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null));
  }

  private nextFromToday(schedule: RecurrenceSchedule): string | null {
    return nextOccurrence(schedule, todayIso(this.config.timeZone));
  }

  create(actor: Actor, boardId: string, input: RecurrenceInput): Recurrence {
    this.access.requireBoard(actor, boardId, 'editor');
    const count = (this.db.prepare('SELECT COUNT(*) AS n FROM recurrences WHERE board_id = ?').get(boardId) as { n: number }).n;
    if (count >= LIMITS.recurrencesPerBoard) throw badRequest(`ניתן להגדיר עד ${LIMITS.recurrencesPerBoard} פריטים חוזרים ללוח`);
    const values = this.validate(boardId, input);
    const id = newId();
    const ts = nowIso();
    this.db
      .prepare(
        `INSERT INTO recurrences (id, board_id, group_id, name, cell_values, schedule, due_column_id, due_offset_days, enabled, next_date, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        boardId,
        input.groupId,
        input.name,
        JSON.stringify(values),
        JSON.stringify(input.schedule),
        input.dueColumnId ?? null,
        input.dueOffsetDays,
        input.enabled ? 1 : 0,
        this.nextFromToday(input.schedule),
        actor.id,
        ts,
        ts,
      );
    this.activity.record(boardId, actor.id, 'recurrence_created', { name: input.name });
    return this.toRecurrence(this.getRow(id));
  }

  update(actor: Actor, id: string, patch: Partial<RecurrenceInput>): Recurrence {
    const row = this.getRow(id);
    this.access.requireBoard(actor, row.board_id, 'editor');
    const cur = this.toRecurrence(row);
    const merged: RecurrenceInput = {
      name: patch.name ?? cur.name,
      groupId: patch.groupId ?? cur.groupId,
      values: patch.values ?? cur.values,
      schedule: patch.schedule ?? cur.schedule,
      dueColumnId: patch.dueColumnId !== undefined ? patch.dueColumnId : cur.dueColumnId,
      dueOffsetDays: patch.dueOffsetDays ?? cur.dueOffsetDays,
      enabled: patch.enabled ?? cur.enabled,
    };
    const values = this.validate(row.board_id, merged);
    this.db
      .prepare(
        `UPDATE recurrences SET name = ?, group_id = ?, cell_values = ?, schedule = ?, due_column_id = ?, due_offset_days = ?, enabled = ?, next_date = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        merged.name,
        merged.groupId,
        JSON.stringify(values),
        JSON.stringify(merged.schedule),
        merged.dueColumnId ?? null,
        merged.dueOffsetDays,
        merged.enabled ? 1 : 0,
        // A changed schedule restarts from today; otherwise keep the pending occurrence.
        patch.schedule ? this.nextFromToday(merged.schedule) : row.next_date,
        nowIso(),
        id,
      );
    this.activity.record(row.board_id, actor.id, 'recurrence_updated', { name: merged.name });
    return this.toRecurrence(this.getRow(id));
  }

  remove(actor: Actor, id: string): void {
    const row = this.getRow(id);
    this.access.requireBoard(actor, row.board_id, 'editor');
    this.db.prepare('DELETE FROM recurrences WHERE id = ?').run(id);
    this.activity.record(row.board_id, actor.id, 'recurrence_deleted', { name: row.name });
  }

  /**
   * Creates the items whose occurrence date has arrived. Safe to call often (every few minutes):
   * each occurrence is claimed with a conditional UPDATE before the item is created.
   */
  runDue(now: Date = new Date()): number {
    const today = todayIso(this.config.timeZone, now);
    const due = this.db
      .prepare(
        `SELECT r.*, NULL AS created_by_name FROM recurrences r JOIN boards b ON b.id = r.board_id
         WHERE r.enabled = 1 AND r.next_date IS NOT NULL AND r.next_date <= ? AND b.archived_at IS NULL`,
      )
      .all(today) as RecurrenceRow[];
    let created = 0;
    for (const row of due) {
      const rec = this.toRecurrence(row);
      const occurrence = row.next_date as string;
      const next = nextOccurrence(rec.schedule, addDaysIso(today, 1));
      const claimed = this.db
        .prepare('UPDATE recurrences SET next_date = ?, updated_at = ? WHERE id = ? AND next_date = ?')
        .run(next, nowIso(), row.id, occurrence).changes;
      if (!claimed) continue; // another worker already handled this occurrence
      try {
        // Columns deleted since the template was saved are skipped rather than failing the occurrence.
        const live = new Set(this.boards.columns(row.board_id).map((c) => c.id));
        const values: Record<string, unknown> = Object.fromEntries(Object.entries(rec.values).filter(([k]) => live.has(k)));
        if (rec.dueColumnId && live.has(rec.dueColumnId)) values[rec.dueColumnId] = addDaysIso(occurrence, rec.dueOffsetDays);
        const item = this.items.systemCreate(
          { id: null, name: `פריט חוזר «${rec.name}»`, automation: `פריט חוזר «${rec.name}»` },
          row.board_id,
          { groupId: row.group_id, name: rec.name, values },
        );
        this.db.prepare('UPDATE recurrences SET last_item_id = ?, last_created_at = ? WHERE id = ?').run(item.id, nowIso(), row.id);
        created++;
      } catch (err) {
        this.log.error({ recurrenceId: row.id, err: err instanceof AppError ? err.message : String(err) }, 'recurring item failed');
      }
    }
    if (created) this.log.info({ created }, 'recurring items created');
    return created;
  }
}
