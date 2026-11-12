import type { ItemTime, TimeEntry, TimeTotal } from '@suboard/shared';
import { nowIso, type DB } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import type { AccessService, Actor } from './access.js';
import type { BoardService } from './boards.js';

/** A forgotten timer is closed at this length instead of counting for days. */
export const MAX_ENTRY_SECONDS = 12 * 3600;

interface Row {
  id: string;
  item_id: string;
  board_id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  seconds: number | null;
  note: string;
  user_name?: string;
}

/**
 * Time tracking on items. Privacy by design — this is information about how employees spend their
 * time: every board member sees the item's TOTAL, but who logged what is shown only to that person
 * and to the board's owners. Nothing is tracked automatically; a person starts a timer or types minutes.
 */
export class TimeTrackingService {
  constructor(
    private readonly db: DB,
    private readonly access: AccessService,
    private readonly boards: BoardService,
  ) {}

  private requireTimeColumn(boardId: string): void {
    if (!this.boards.columns(boardId).some((c) => c.type === 'time')) throw badRequest('בלוח הזה אין עמודת מעקב זמן');
  }

  private static elapsed(r: Row, now = Date.now()): number {
    if (r.seconds !== null) return r.seconds;
    return Math.max(0, Math.min(MAX_ENTRY_SECONDS, Math.floor((now - Date.parse(r.started_at)) / 1000)));
  }

  /** Closes the actor's running timer, wherever it is. Returns the board it was on. */
  private stopRunning(userId: string): string | null {
    const r = this.db.prepare('SELECT * FROM time_entries WHERE user_id = ? AND ended_at IS NULL').get(userId) as Row | undefined;
    if (!r) return null;
    this.db.prepare('UPDATE time_entries SET ended_at = ?, seconds = ? WHERE id = ?').run(nowIso(), TimeTrackingService.elapsed(r), r.id);
    return r.board_id;
  }

  /** Totals per item of a board, for the `time` column. */
  totals(actor: Actor, boardId: string): Record<string, TimeTotal> {
    const rows = this.db
      .prepare('SELECT t.* FROM time_entries t JOIN items i ON i.id = t.item_id AND i.deleted_at IS NULL WHERE t.board_id = ?')
      .all(boardId) as Row[];
    const out: Record<string, TimeTotal> = {};
    const now = Date.now();
    for (const r of rows) {
      const t = (out[r.item_id] ??= { seconds: 0, runningSince: null, othersRunning: 0 });
      if (r.ended_at === null) {
        if (r.user_id === actor.id) t.runningSince = r.started_at;
        else t.othersRunning++;
        // A running timer of someone else counts up to "now"; the viewer's own is counted live in the browser.
        if (r.user_id !== actor.id) t.seconds += TimeTrackingService.elapsed(r, now);
      } else {
        t.seconds += r.seconds ?? 0;
      }
    }
    return out;
  }

  item(actor: Actor, itemId: string): ItemTime {
    const boardId = this.access.boardIdForItem(itemId);
    const role = this.access.requireBoard(actor, boardId, 'viewer');
    const rows = this.db
      .prepare('SELECT t.*, u.name AS user_name FROM time_entries t JOIN users u ON u.id = t.user_id WHERE t.item_id = ? ORDER BY t.started_at DESC LIMIT 500')
      .all(itemId) as Row[];
    const now = Date.now();
    const total = rows.reduce((a, r) => a + TimeTrackingService.elapsed(r, now), 0);
    // Who logged what: the person themself, and the board's owners. Everyone else gets the total only.
    const visible = rows.filter((r) => role === 'owner' || r.user_id === actor.id);
    const entries: TimeEntry[] = visible.map((r) => ({
      id: r.id,
      userId: r.user_id,
      userName: r.user_name ?? '',
      startedAt: r.started_at,
      endedAt: r.ended_at,
      seconds: TimeTrackingService.elapsed(r, now),
      note: r.note,
      mine: r.user_id === actor.id,
    }));
    return { totalSeconds: total, mineSeconds: rows.filter((r) => r.user_id === actor.id).reduce((a, r) => a + TimeTrackingService.elapsed(r, now), 0), entries, detailed: role === 'owner' };
  }

  /** Starts the actor's timer on an item; a timer running elsewhere is stopped first (one at a time). */
  start(actor: Actor, itemId: string): ItemTime {
    const boardId = this.access.boardIdForItem(itemId);
    this.access.requireBoard(actor, boardId, 'editor');
    this.requireTimeColumn(boardId);
    this.db.transaction(() => {
      const other = this.stopRunning(actor.id);
      if (other && other !== boardId) this.boards.touch(other);
      this.db.prepare("INSERT INTO time_entries (id, item_id, board_id, user_id, started_at, note) VALUES (?, ?, ?, ?, ?, '')").run(newId(), itemId, boardId, actor.id, nowIso());
      this.boards.touch(boardId);
    })();
    return this.item(actor, itemId);
  }

  stop(actor: Actor, itemId: string): ItemTime {
    const boardId = this.access.boardIdForItem(itemId);
    this.access.requireBoard(actor, boardId, 'viewer');
    const r = this.db.prepare('SELECT * FROM time_entries WHERE user_id = ? AND item_id = ? AND ended_at IS NULL').get(actor.id, itemId) as Row | undefined;
    if (!r) throw badRequest('אין שעון פעיל שלך בפריט הזה');
    this.stopRunning(actor.id);
    this.boards.touch(boardId);
    return this.item(actor, itemId);
  }

  /** Time typed in by hand (the work was done away from the screen). */
  addManual(actor: Actor, itemId: string, input: { minutes: number; date: string; note?: string }): ItemTime {
    const boardId = this.access.boardIdForItem(itemId);
    this.access.requireBoard(actor, boardId, 'editor');
    this.requireTimeColumn(boardId);
    const start = new Date(`${input.date}T09:00:00.000Z`);
    if (Number.isNaN(start.getTime()) || start.getTime() > Date.now() + 86_400_000) throw badRequest('תאריך לא תקין', { date: 'תאריך לא תקין' });
    const seconds = input.minutes * 60;
    this.db
      .prepare('INSERT INTO time_entries (id, item_id, board_id, user_id, started_at, ended_at, seconds, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(newId(), itemId, boardId, actor.id, start.toISOString(), new Date(start.getTime() + seconds * 1000).toISOString(), seconds, input.note ?? '');
    this.boards.touch(boardId);
    return this.item(actor, itemId);
  }

  /** A person deletes their own entry; a board owner may delete any entry on the board. */
  remove(actor: Actor, entryId: string): void {
    const r = this.db.prepare('SELECT * FROM time_entries WHERE id = ?').get(entryId) as Row | undefined;
    const role = r ? this.access.boardRole(actor, r.board_id) : null;
    if (!r || !role) throw notFound('הרישום לא נמצא');
    if (r.user_id !== actor.id && role !== 'owner') throw forbidden('אפשר למחוק רק רישומי זמן שלך');
    this.db.prepare('DELETE FROM time_entries WHERE id = ?').run(entryId);
    this.boards.touch(r.board_id);
  }
}
