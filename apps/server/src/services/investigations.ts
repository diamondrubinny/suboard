import { todayIso, type Investigation, type InvestigationInput, type Item } from '@suboard/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../config.js';
import { nowIso, parseJson, type DB } from '../db/index.js';
import type { AccessService, Actor } from './access.js';
import type { ActivityService } from './activity.js';
import type { BoardService } from './boards.js';
import type { ItemService } from './items.js';
import type { NotificationService } from './notifications.js';

type Data = Omit<Investigation, 'itemId' | 'updatedAt' | 'updatedByName'>;
const EMPTY: Data = { whys: [], rootCause: '', categories: [], effectivenessDue: null, effectivenessResult: null, effectivenessNote: '' };

/**
 * Structured investigation per item: 5 whys, root cause, cause categories, linked corrective actions
 * and an effectiveness check on a date. Free text is never copied into the activity history.
 */
export class InvestigationService {
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

  get(actor: Actor, itemId: string): Investigation {
    const boardId = this.access.boardIdForItem(itemId);
    this.access.requireBoard(actor, boardId, 'viewer');
    const r = this.db
      .prepare('SELECT i.data, i.updated_at, u.name AS updated_by_name FROM investigations i LEFT JOIN users u ON u.id = i.updated_by WHERE i.item_id = ?')
      .get(itemId) as { data: string; updated_at: string; updated_by_name: string | null } | undefined;
    const data = r ? { ...EMPTY, ...parseJson<Partial<Data>>(r.data, {}) } : EMPTY;
    return { itemId, ...data, updatedAt: r?.updated_at ?? null, updatedByName: r?.updated_by_name ?? null };
  }

  save(actor: Actor, itemId: string, input: Required<InvestigationInput>): Investigation {
    const boardId = this.access.boardIdForItem(itemId);
    this.access.requireBoard(actor, boardId, 'editor');
    const data: Data = {
      whys: input.whys.map((w) => w.trim()).filter(Boolean),
      rootCause: input.rootCause.trim(),
      categories: [...new Set(input.categories)],
      effectivenessDue: input.effectivenessDue,
      effectivenessResult: input.effectivenessResult,
      effectivenessNote: input.effectivenessNote.trim(),
    };
    const ts = nowIso();
    this.db
      .prepare(
        `INSERT INTO investigations (item_id, data, effectiveness_due, effectiveness_result, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(item_id) DO UPDATE SET data = excluded.data, effectiveness_due = excluded.effectiveness_due,
           effectiveness_result = excluded.effectiveness_result, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      )
      .run(itemId, JSON.stringify(data), data.effectivenessDue, data.effectivenessResult, actor.id, ts);
    // History records the fact (and the outcome), never the investigation text.
    this.activity.record(boardId, actor.id, 'investigation_updated', data.effectivenessResult ? { result: data.effectivenessResult } : {}, itemId);
    this.boards.touch(boardId);
    return this.get(actor, itemId);
  }

  /** Opens a corrective action on another (or the same) board, as the actor, linked to the investigated item. */
  createAction(actor: Actor, itemId: string, input: { boardId: string; groupId: string; name: string }): Item {
    const boardId = this.access.boardIdForItem(itemId);
    this.access.requireBoard(actor, boardId, 'editor');
    const created = this.items.create(actor, input.boardId, { groupId: input.groupId, name: input.name }); // checks editor on the target
    this.items.link(itemId, created.id, 'investigation_action', actor.id);
    this.activity.record(boardId, actor.id, 'action_linked', { name: input.name }, itemId);
    return created;
  }

  /**
   * Daily (after DIGEST_HOUR): investigations whose effectiveness date arrived without a result →
   * notify the item's assignees and the board owners, once per due date.
   */
  runDue(now: Date = new Date(), force = false): number {
    const today = todayIso(this.config.timeZone, now);
    if (!force) {
      const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: this.config.timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now));
      if (hour < this.config.digestHour) return 0;
    }
    const rows = this.db
      .prepare(
        `SELECT inv.item_id, inv.effectiveness_due FROM investigations inv
         JOIN items i ON i.id = inv.item_id AND i.deleted_at IS NULL
         JOIN boards b ON b.id = i.board_id AND b.archived_at IS NULL
         WHERE inv.effectiveness_due IS NOT NULL AND inv.effectiveness_due <= ? AND inv.effectiveness_result IS NULL
           AND (inv.reminded_for IS NULL OR inv.reminded_for <> inv.effectiveness_due)`,
      )
      .all(today) as { item_id: string; effectiveness_due: string }[];
    let sent = 0;
    for (const r of rows) {
      const claimed = this.db
        .prepare('UPDATE investigations SET reminded_for = ? WHERE item_id = ? AND (reminded_for IS NULL OR reminded_for <> ?)')
        .run(r.effectiveness_due, r.item_id, r.effectiveness_due).changes;
      if (!claimed) continue;
      try {
        const item = this.items.getLive(r.item_id);
        const ids = new Set<string>();
        for (const c of this.boards.columns(item.boardId)) {
          if (c.type === 'person' && Array.isArray(item.values[c.id])) (item.values[c.id] as string[]).forEach((u) => ids.add(u));
        }
        for (const o of this.db.prepare("SELECT user_id FROM board_members WHERE board_id = ? AND role = 'owner'").all(item.boardId) as { user_id: string }[]) {
          ids.add(o.user_id);
        }
        sent += this.notifications.onEffectivenessDue(item.boardId, item.id, item.name, [...ids]);
      } catch (err) {
        this.log.error({ itemId: r.item_id, err: err instanceof Error ? err.message : String(err) }, 'effectiveness reminder failed');
      }
    }
    return sent;
  }
}
