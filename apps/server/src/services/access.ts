import type { BoardRole, GlobalRole } from '@suboard/shared';
import type { DB } from '../db/index.js';
import { forbidden, notFound } from '../lib/errors.js';

export interface Actor {
  id: string;
  name: string;
  role: GlobalRole;
  /** An outside party limited to the boards it was invited to. */
  guest?: boolean;
}

const RANK: Record<BoardRole, number> = { viewer: 1, editor: 2, owner: 3 };

/**
 * Central authorization for board-scoped resources (defense against IDOR/BOLA).
 * Every route that receives a resource id resolves its board server-side and calls
 * `requireBoard` before reading or mutating anything.
 */
export class AccessService {
  constructor(private readonly db: DB) {}

  /** Returns the actor's effective role on a board, or null if no access / board missing. */
  boardRole(actor: Actor, boardId: string): BoardRole | null {
    const board = this.db.prepare('SELECT id, open_role FROM boards WHERE id = ? AND archived_at IS NULL').get(boardId) as { id: string; open_role: 'viewer' | 'editor' | null } | undefined;
    if (!board) return null;
    if (actor.role === 'admin') return 'owner';
    const row = this.db
      .prepare('SELECT role FROM board_members WHERE board_id = ? AND user_id = ?')
      .get(boardId, actor.id) as { role: BoardRole } | undefined;
    const mine = row?.role ?? null;
    // A board opened to everyone: every active, non-guest user gets at least that role.
    if (!board.open_role || (mine && RANK[mine] >= RANK[board.open_role]) || !this.isRegularUser(actor.id)) return mine;
    return board.open_role;
  }

  /** Active and not a guest — read from the database, never trusted from the caller. */
  private isRegularUser(userId: string): boolean {
    return this.db.prepare('SELECT 1 FROM users WHERE id = ? AND is_active = 1 AND is_guest = 0').get(userId) !== undefined;
  }

  /**
   * Throws 404 when the actor cannot see the board at all (does not reveal existence),
   * 403 when they can see it but their role is insufficient.
   */
  requireBoard(actor: Actor, boardId: string, minRole: BoardRole): BoardRole {
    const role = this.boardRole(actor, boardId);
    if (!role) throw notFound('הלוח לא נמצא');
    if (RANK[role] < RANK[minRole]) throw forbidden();
    return role;
  }

  boardIdForItem(itemId: string): string {
    const r = this.db.prepare('SELECT board_id FROM items WHERE id = ? AND deleted_at IS NULL').get(itemId) as { board_id: string } | undefined;
    if (!r) throw notFound('הפריט לא נמצא');
    return r.board_id;
  }

  boardIdForGroup(groupId: string): string {
    const r = this.db.prepare('SELECT board_id FROM board_groups WHERE id = ?').get(groupId) as
      | { board_id: string }
      | undefined;
    if (!r) throw notFound('הקבוצה לא נמצאה');
    return r.board_id;
  }

  boardIdForColumn(columnId: string): string {
    const r = this.db.prepare('SELECT board_id FROM board_columns WHERE id = ?').get(columnId) as
      | { board_id: string }
      | undefined;
    if (!r) throw notFound('העמודה לא נמצאה');
    return r.board_id;
  }

  /** Ids of all non-archived boards the actor can view. */
  accessibleBoardIds(actor: Actor): string[] {
    const rows =
      actor.role === 'admin'
        ? this.db.prepare('SELECT id FROM boards WHERE archived_at IS NULL').all()
        : this.db
            .prepare(
              `SELECT b.id FROM boards b LEFT JOIN board_members m ON m.board_id = b.id AND m.user_id = ?
               WHERE b.archived_at IS NULL AND (m.user_id IS NOT NULL OR (b.open_role IS NOT NULL AND ? = 1))`,
            )
            .all(actor.id, this.isRegularUser(actor.id) ? 1 : 0);
    return (rows as { id: string }[]).map((r) => r.id);
  }
}
