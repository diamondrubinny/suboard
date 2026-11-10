import type { ActivityEntry } from '@suboard/shared';
import { nowIso, parseJson, type DB } from '../db/index.js';
import { newId } from '../lib/crypto.js';

export type ActivityAction =
  | 'board_created'
  | 'board_updated'
  | 'item_created'
  | 'item_renamed'
  | 'item_moved'
  | 'item_value_changed'
  | 'item_deleted'
  | 'update_added'
  | 'update_deleted'
  | 'group_created'
  | 'group_updated'
  | 'group_deleted'
  | 'column_created'
  | 'column_updated'
  | 'column_deleted'
  | 'member_set'
  | 'member_removed';

/** Business-level change history shown to board members (distinct from the security audit log). */
export class ActivityService {
  constructor(private readonly db: DB) {}

  record(boardId: string, userId: string | null, action: ActivityAction, detail: Record<string, unknown> = {}, itemId?: string): void {
    this.db
      .prepare('INSERT INTO activity (id, board_id, item_id, user_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(newId(), boardId, itemId ?? null, userId, action, JSON.stringify(detail), nowIso());
  }

  forBoard(boardId: string, limit = 100): ActivityEntry[] {
    return this.query('a.board_id = ?', [boardId], limit);
  }

  forItem(itemId: string, limit = 100): ActivityEntry[] {
    return this.query('a.item_id = ?', [itemId], limit);
  }

  private query(where: string, params: unknown[], limit: number): ActivityEntry[] {
    const rows = this.db
      .prepare(
        `SELECT a.id, a.board_id, a.item_id, a.user_id, u.name AS user_name, a.action, a.detail, a.created_at
         FROM activity a LEFT JOIN users u ON u.id = a.user_id
         WHERE ${where} ORDER BY a.created_at DESC, a.rowid DESC LIMIT ?`,
      )
      .all(...params, Math.min(limit, 500)) as {
      id: string;
      board_id: string;
      item_id: string | null;
      user_id: string | null;
      user_name: string | null;
      action: string;
      detail: string;
      created_at: string;
    }[];
    return rows.map((r) => ({
      id: r.id,
      boardId: r.board_id,
      itemId: r.item_id,
      userId: r.user_id,
      userName: r.user_name,
      action: r.action,
      detail: parseJson(r.detail, {}),
      createdAt: r.created_at,
    }));
  }
}
