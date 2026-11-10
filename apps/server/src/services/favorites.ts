import { RECENT_BOARDS_KEEP, RECENT_BOARDS_SHOW, type RecentBoard } from '@suboard/shared';
import { nowIso, type DB } from '../db/index.js';
import type { AccessService, Actor } from './access.js';

/** Personal board shortcuts: favourites (stars) and recently opened boards. Visible only to the user. */
export class FavoriteService {
  constructor(
    private readonly db: DB,
    private readonly access: AccessService,
  ) {}

  setFavorite(actor: Actor, boardId: string, on: boolean): void {
    this.access.requireBoard(actor, boardId, 'viewer');
    if (on) this.db.prepare('INSERT OR IGNORE INTO board_favorites (user_id, board_id, created_at) VALUES (?, ?, ?)').run(actor.id, boardId, nowIso());
    else this.db.prepare('DELETE FROM board_favorites WHERE user_id = ? AND board_id = ?').run(actor.id, boardId);
  }

  isFavorite(userId: string, boardId: string): boolean {
    return this.db.prepare('SELECT 1 FROM board_favorites WHERE user_id = ? AND board_id = ?').get(userId, boardId) !== undefined;
  }

  /** Called after a successful board read (access already checked). Keeps the newest N per user. */
  recordVisit(userId: string, boardId: string): void {
    this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO board_visits (user_id, board_id, visited_at) VALUES (?, ?, ?) ON CONFLICT (user_id, board_id) DO UPDATE SET visited_at = excluded.visited_at')
        .run(userId, boardId, nowIso());
      this.db
        .prepare(
          `DELETE FROM board_visits WHERE user_id = ? AND board_id NOT IN
             (SELECT board_id FROM board_visits WHERE user_id = ? ORDER BY visited_at DESC LIMIT ?)`,
        )
        .run(userId, userId, RECENT_BOARDS_KEEP);
    })();
  }

  /** Recently opened boards the user can still open (access re-checked: removed members drop out). */
  recent(actor: Actor): RecentBoard[] {
    const rows = this.db
      .prepare(
        `SELECT b.id, b.name, v.visited_at, (f.board_id IS NOT NULL) AS fav
         FROM board_visits v JOIN boards b ON b.id = v.board_id AND b.archived_at IS NULL
         LEFT JOIN board_favorites f ON f.user_id = v.user_id AND f.board_id = v.board_id
         WHERE v.user_id = ? ORDER BY v.visited_at DESC`,
      )
      .all(actor.id) as { id: string; name: string; visited_at: string; fav: number }[];
    return rows
      .filter((r) => this.access.boardRole(actor, r.id))
      .slice(0, RECENT_BOARDS_SHOW)
      .map((r) => ({ id: r.id, name: r.name, visitedAt: r.visited_at, favorite: r.fav === 1 }));
  }
}
