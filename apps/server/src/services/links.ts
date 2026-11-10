import { findPrimaryStatusColumn, isItemDone, type ItemCard, type ItemLink } from '@suboard/shared';
import type { DB } from '../db/index.js';
import type { AccessService, Actor } from './access.js';
import type { BoardService } from './boards.js';
import type { ItemService } from './items.js';
import { toItem, type ItemRow } from './mappers.js';

/** Linked items (checklist → corrective action, investigation → action) and the mobile QR card. */
export class LinkService {
  constructor(
    private readonly db: DB,
    private readonly access: AccessService,
    private readonly boards: BoardService,
    private readonly items: ItemService,
  ) {}

  /** Links of an item, both directions. Items on boards the actor cannot see are returned without details. */
  list(actor: Actor, itemId: string): ItemLink[] {
    const boardId = this.access.boardIdForItem(itemId);
    this.access.requireBoard(actor, boardId, 'viewer');
    const rows = this.db
      .prepare(
        `SELECT id, kind, from_item, to_item, created_at FROM item_links WHERE from_item = ? OR to_item = ? ORDER BY created_at DESC LIMIT 200`,
      )
      .all(itemId, itemId) as { id: string; kind: ItemLink['kind']; from_item: string; to_item: string; created_at: string }[];
    return rows.map((r) => {
      const otherId = r.from_item === itemId ? r.to_item : r.from_item;
      const row = this.db
        .prepare('SELECT i.*, b.name AS board_name FROM items i JOIN boards b ON b.id = i.board_id WHERE i.id = ? AND i.deleted_at IS NULL AND b.archived_at IS NULL')
        .get(otherId) as (ItemRow & { board_name: string }) | undefined;
      let item: ItemLink['item'] = null;
      if (row && this.access.boardRole(actor, row.board_id)) {
        const other = toItem(row);
        const status = findPrimaryStatusColumn(this.boards.columns(row.board_id));
        const opt = status?.settings.options?.find((o) => o.id === other.values[status.id]);
        item = {
          id: other.id,
          name: other.name,
          boardId: row.board_id,
          boardName: row.board_name,
          statusLabel: opt?.label ?? null,
          statusColor: opt?.color ?? null,
          done: isItemDone(other, status),
        };
      }
      return { id: r.id, kind: r.kind, direction: r.from_item === itemId ? 'out' : 'in', item, createdAt: r.created_at };
    });
  }

  /** Everything the QR landing page needs for one item (viewer access). */
  card(actor: Actor, itemId: string): ItemCard {
    const boardId = this.access.boardIdForItem(itemId);
    const myRole = this.access.requireBoard(actor, boardId, 'viewer');
    const board = this.db.prepare('SELECT name FROM boards WHERE id = ?').get(boardId) as { name: string };
    const members = this.db
      .prepare('SELECT u.id, u.name FROM board_members m JOIN users u ON u.id = m.user_id WHERE m.board_id = ? ORDER BY u.name')
      .all(boardId) as { id: string; name: string }[];
    return {
      boardId,
      boardName: board.name,
      myRole,
      item: this.items.getLive(itemId),
      columns: this.boards.columns(boardId),
      members,
      updates: this.items.listUpdates(actor, itemId).slice(0, 5),
    };
  }
}
