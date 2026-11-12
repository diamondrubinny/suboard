import { MAX_MANUAL_LINKS, MAX_RELATION_ITEMS, type RelatedItem, findPrimaryStatusColumn, isItemDone, type ItemCard, type ItemLink } from '@suboard/shared';
import { nowIso, type DB } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import type { ActivityService } from './activity.js';
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
    private readonly activity: ActivityService,
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

  /** Links one item to another (any board the actor can at least view). */
  add(actor: Actor, itemId: string, toItemId: string): ItemLink[] {
    const boardId = this.access.boardIdForItem(itemId);
    this.access.requireBoard(actor, boardId, 'editor');
    if (itemId === toItemId) throw badRequest('אי אפשר לקשר פריט לעצמו');
    // A target the actor cannot see is answered exactly like one that does not exist.
    const target = this.db
      .prepare('SELECT i.id, i.name, i.board_id FROM items i JOIN boards b ON b.id = i.board_id WHERE i.id = ? AND i.deleted_at IS NULL AND b.archived_at IS NULL')
      .get(toItemId) as { id: string; name: string; board_id: string } | undefined;
    if (!target || !this.access.boardRole(actor, target.board_id)) throw notFound('הפריט לקישור לא נמצא');
    this.items.getLive(itemId);
    const pair = [itemId, toItemId, toItemId, itemId];
    if (this.db.prepare("SELECT 1 FROM item_links WHERE kind = 'related' AND column_id IS NULL AND ((from_item = ? AND to_item = ?) OR (from_item = ? AND to_item = ?))").get(...pair)) {
      throw badRequest('הפריטים כבר מקושרים');
    }
    const count = (this.db.prepare("SELECT COUNT(*) AS n FROM item_links WHERE kind = 'related' AND column_id IS NULL AND (from_item = ? OR to_item = ?)").get(itemId, itemId) as { n: number }).n;
    if (count >= MAX_MANUAL_LINKS) throw badRequest(`אפשר לקשר עד ${MAX_MANUAL_LINKS} פריטים לפריט אחד`);
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO item_links (id, from_item, to_item, kind, created_by, created_at) VALUES (?, ?, ?, 'related', ?, ?)").run(newId(), itemId, toItemId, actor.id, nowIso());
      // No name in the history: other members of this board may not be allowed to see the linked item.
      this.activity.record(boardId, actor.id, 'item_linked', {}, itemId);
      this.boards.touch(boardId);
      if (target.board_id !== boardId) this.boards.touch(target.board_id);
    })();
    return this.list(actor, itemId);
  }

  /**
   * Replaces what one item is connected to through a relation column. Targets must be live items of
   * the column's board, and the actor must be able to see that board.
   */
  setRelation(actor: Actor, itemId: string, columnId: string, targetIds: string[]): RelatedItem[] {
    const boardId = this.access.boardIdForItem(itemId);
    this.access.requireBoard(actor, boardId, 'editor');
    this.items.getLive(itemId);
    const col = this.boards.columns(boardId).find((c) => c.id === columnId);
    if (!col || col.type !== 'relation' || !col.settings.relation) throw notFound('העמודה לא נמצאה');
    const targetBoard = col.settings.relation.boardId;
    if (!this.access.boardRole(actor, targetBoard)) throw forbidden('אין לך גישה ללוח המחובר');
    const ids = [...new Set(targetIds)].filter((id) => id !== itemId);
    if (ids.length > MAX_RELATION_ITEMS) throw badRequest(`אפשר לחבר עד ${MAX_RELATION_ITEMS} פריטים בתא`);
    const found = ids.length
      ? (this.db.prepare(`SELECT id, name FROM items WHERE board_id = ? AND deleted_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`).all(targetBoard, ...ids) as { id: string; name: string }[])
      : [];
    if (found.length !== ids.length) throw badRequest('אחד הפריטים אינו שייך ללוח המחובר');
    this.db.transaction(() => {
      // Connected items on the target board that the actor could see are replaced as a set.
      this.db.prepare("DELETE FROM item_links WHERE kind = 'related' AND from_item = ? AND column_id = ?").run(itemId, columnId);
      const ins = this.db.prepare("INSERT INTO item_links (id, from_item, to_item, kind, created_by, created_at, column_id) VALUES (?, ?, ?, 'related', ?, ?, ?)");
      for (const id of ids) ins.run(newId(), itemId, id, actor.id, nowIso(), columnId);
      this.activity.record(boardId, actor.id, 'item_linked', { column: col.title, count: ids.length }, itemId);
      this.boards.touch(boardId);
    })();
    return ids.map((id) => ({ id, name: found.find((f) => f.id === id)!.name, boardId: targetBoard }));
  }

  /** Names of a board's items for the relation picker (viewer access to that board). */
  itemNames(actor: Actor, boardId: string, q: string): { id: string; name: string }[] {
    this.access.requireBoard(actor, boardId, 'viewer');
    const like = `%${q.trim().slice(0, 100).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    return this.db
      .prepare("SELECT id, name FROM items WHERE board_id = ? AND deleted_at IS NULL AND name LIKE ? ESCAPE '\\' ORDER BY name LIMIT 50")
      .all(boardId, like) as { id: string; name: string }[];
  }

  /** Removes a manual link. An editor of either item's board may do it. */
  remove(actor: Actor, linkId: string): void {
    const l = this.db
      .prepare(
        `SELECT l.kind, l.column_id, l.from_item, l.to_item, a.board_id AS from_board, b.board_id AS to_board, a.name AS from_name, b.name AS to_name
         FROM item_links l JOIN items a ON a.id = l.from_item JOIN items b ON b.id = l.to_item WHERE l.id = ?`,
      )
      .get(linkId) as { kind: string; column_id: string | null; from_item: string; to_item: string; from_board: string; to_board: string; from_name: string; to_name: string } | undefined;
    const roles = l ? [this.access.boardRole(actor, l.from_board), this.access.boardRole(actor, l.to_board)] : [];
    if (!l || !roles.some(Boolean)) throw notFound('הקישור לא נמצא');
    if (l.kind !== 'related') throw badRequest('קישור שנוצר אוטומטית אינו ניתן להסרה');
    if (l.column_id) throw badRequest('החיבור הזה מנוהל בעמודת החיבור של הפריט');
    if (!roles.some((r) => r === 'editor' || r === 'owner')) throw forbidden('נדרשת הרשאת עריכה באחד הלוחות');
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM item_links WHERE id = ?').run(linkId);
      this.activity.record(l.from_board, actor.id, 'item_unlinked', {}, l.from_item);
      this.boards.touch(l.from_board);
      if (l.to_board !== l.from_board) this.boards.touch(l.to_board);
    })();
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
