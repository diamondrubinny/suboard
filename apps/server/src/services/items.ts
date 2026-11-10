import { cellValueSchema, LIMITS, type CellValue, type Column, type ImportResult, type Item, type ItemUpdate, type TrashedItem } from '@suboard/shared';
import { nowIso, type DB } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { AppError, badRequest, forbidden, notFound } from '../lib/errors.js';
import type { AccessService, Actor } from './access.js';
import type { ActivityService } from './activity.js';
import type { BoardService } from './boards.js';
import { toItem, type ItemRow } from './mappers.js';
import type { NotificationService } from './notifications.js';

const DAY = 86_400_000;

export class ItemService {
  constructor(
    private readonly db: DB,
    private readonly access: AccessService,
    private readonly boards: BoardService,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationService,
  ) {}

  // ---------------------------------------------------------------- helpers
  /** User ids present in `next` person columns but not in `prev` (newly assigned). */
  private newAssignees(boardId: string, prev: Record<string, unknown>, next: Record<string, unknown>): string[] {
    const out: string[] = [];
    for (const c of this.boards.columns(boardId)) {
      if (c.type !== 'person' || !(c.id in next)) continue;
      const before = new Set(Array.isArray(prev[c.id]) ? (prev[c.id] as string[]) : []);
      for (const id of Array.isArray(next[c.id]) ? (next[c.id] as string[]) : []) if (!before.has(id)) out.push(id);
    }
    return out;
  }

  /** A live (not deleted) item, or 404. */
  private getRow(itemId: string): Item {
    const r = this.db.prepare('SELECT * FROM items WHERE id = ? AND deleted_at IS NULL').get(itemId) as ItemRow | undefined;
    if (!r) throw notFound('הפריט לא נמצא');
    return toItem(r);
  }

  private children(itemId: string): Item[] {
    return (this.db.prepare('SELECT * FROM items WHERE parent_id = ? AND deleted_at IS NULL ORDER BY position').all(itemId) as ItemRow[]).map(toItem);
  }

  private assertGroupInBoard(groupId: string, boardId: string): void {
    const g = this.db.prepare('SELECT 1 FROM board_groups WHERE id = ? AND board_id = ?').get(groupId, boardId);
    if (!g) throw badRequest('הקבוצה אינה שייכת ללוח', { groupId: 'קבוצה לא תקינה' });
  }

  private nextSeq(boardId: string): number {
    return (this.db.prepare('UPDATE boards SET item_seq = item_seq + 1 WHERE id = ? RETURNING item_seq').get(boardId) as { item_seq: number }).item_seq;
  }

  private nextPosition(groupId: string, parentId: string | null): number {
    const row = parentId
      ? this.db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM items WHERE parent_id = ?').get(parentId)
      : this.db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM items WHERE group_id = ? AND parent_id IS NULL').get(groupId);
    return (row as { p: number }).p + 1;
  }

  /** Users that may be assigned / mentioned on a board: active members, or system admins. */
  private assertUsersOnBoard(boardId: string, ids: string[], label: string, field: string): void {
    if (!ids.length) return;
    const found = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM users u
         WHERE u.is_active = 1 AND u.id IN (${ids.map(() => '?').join(',')})
           AND (u.role = 'admin' OR EXISTS (SELECT 1 FROM board_members m WHERE m.board_id = ? AND m.user_id = u.id))`,
      )
      .get(...ids, boardId) as { n: number };
    if (found.n !== ids.length) throw badRequest(`ניתן לבחור רק חברי לוח פעילים (${label})`, { [field]: 'משתמש לא תקין' });
  }

  /**
   * Validates a partial `values` patch against the board's columns: shape by type, label options
   * exist, referenced users are board members, computed columns are never written.
   */
  private validateValues(boardId: string, patch: Record<string, unknown>): Record<string, CellValue> {
    const columns = new Map<string, Column>(this.boards.columns(boardId).map((c) => [c.id, c]));
    const out: Record<string, CellValue> = {};
    for (const [columnId, raw] of Object.entries(patch)) {
      const col = columns.get(columnId);
      if (!col) throw badRequest('עמודה לא קיימת בלוח', { [columnId]: 'עמודה לא קיימת' });
      if (col.type === 'auto_id') throw badRequest(`העמודה "${col.title}" מחושבת אוטומטית`, { [columnId]: 'לא ניתן לעריכה' });
      let value: unknown = raw;
      if (typeof value === 'string' && value.trim() === '' && col.type !== 'long_text') value = null;
      if (Array.isArray(value) && value.length === 0) value = null;
      const parsed = cellValueSchema(col.type).safeParse(value);
      if (!parsed.success) throw badRequest(`ערך לא תקין בעמודה "${col.title}"`, { [columnId]: parsed.error.issues[0]?.message ?? 'ערך לא תקין' });
      let v = parsed.data as CellValue;
      const optionIds = new Set(col.settings.options?.map((o) => o.id));
      if (col.type === 'status' && typeof v === 'string' && !optionIds.has(v)) {
        throw badRequest(`תווית לא קיימת בעמודה "${col.title}"`, { [columnId]: 'תווית לא קיימת' });
      }
      if (col.type === 'tags' && Array.isArray(v)) {
        const ids = [...new Set(v as string[])];
        if (ids.some((id) => !optionIds.has(id))) throw badRequest(`תגית לא קיימת בעמודה "${col.title}"`, { [columnId]: 'תגית לא קיימת' });
        v = ids;
      }
      if (col.type === 'person' && Array.isArray(v)) {
        const ids = [...new Set(v as string[])];
        this.assertUsersOnBoard(boardId, ids, col.title, columnId);
        v = ids.length ? ids : null;
      }
      if (col.type === 'long_text' && typeof v === 'string' && v.trim() === '') v = null;
      out[columnId] = v;
    }
    return out;
  }

  private insertItem(
    actor: Actor,
    boardId: string,
    groupId: string,
    parentId: string | null,
    name: string,
    values: Record<string, CellValue>,
  ): string {
    const id = newId();
    const ts = nowIso();
    const clean = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null));
    this.db
      .prepare(
        `INSERT INTO items (id, board_id, group_id, parent_id, name, cell_values, position, seq, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, boardId, groupId, parentId, name, JSON.stringify(clean), this.nextPosition(groupId, parentId), this.nextSeq(boardId), actor.id, ts, ts);
    return id;
  }

  // ---------------------------------------------------------------- CRUD
  create(actor: Actor, boardId: string, input: { groupId: string; parentId?: string; name: string; values?: Record<string, unknown> }): Item {
    this.access.requireBoard(actor, boardId, 'editor');
    let groupId = input.groupId;
    if (input.parentId) {
      const parent = this.getRow(input.parentId);
      if (parent.boardId !== boardId) throw badRequest('פריט האב אינו שייך ללוח', { parentId: 'פריט לא תקין' });
      if (parent.parentId) throw badRequest('ניתן להוסיף תת-פריטים רק לפריט ראשי', { parentId: 'רמה אחת בלבד' });
      groupId = parent.groupId;
    } else {
      this.assertGroupInBoard(groupId, boardId);
    }
    const values = this.validateValues(boardId, input.values ?? {});
    let id = '';
    this.db.transaction(() => {
      id = this.insertItem(actor, boardId, groupId, input.parentId ?? null, input.name, values);
      this.activity.record(boardId, actor.id, 'item_created', { name: input.name, ...(input.parentId ? { parentId: input.parentId } : {}) }, id);
      this.boards.touch(boardId);
    })();
    this.notifications.onAssigned(actor, boardId, id, input.name, this.newAssignees(boardId, {}, values));
    return this.getRow(id);
  }

  update(actor: Actor, itemId: string, input: { name?: string; groupId?: string; position?: number; values?: Record<string, unknown> }): Item {
    const boardId = this.access.boardIdForItem(itemId);
    this.access.requireBoard(actor, boardId, 'editor');
    const item = this.getRow(itemId);
    if (input.groupId) {
      this.assertGroupInBoard(input.groupId, boardId);
      if (item.parentId) throw badRequest('תת-פריט עובר קבוצה יחד עם פריט האב');
    }
    const patch = input.values ? this.validateValues(boardId, input.values) : {};
    const columns = new Map(this.boards.columns(boardId).map((c) => [c.id, c]));

    this.db.transaction(() => {
      const sets: string[] = [];
      const params: unknown[] = [];
      if (input.name !== undefined && input.name !== item.name) {
        sets.push('name = ?');
        params.push(input.name);
        this.activity.record(boardId, actor.id, 'item_renamed', { from: item.name, to: input.name }, itemId);
      }
      if (input.groupId !== undefined && input.groupId !== item.groupId) {
        sets.push('group_id = ?');
        params.push(input.groupId);
        if (input.position === undefined) {
          sets.push('position = ?');
          params.push(this.nextPosition(input.groupId, null));
        }
        // Sub-items always live in their parent's group.
        this.db.prepare('UPDATE items SET group_id = ? WHERE parent_id = ?').run(input.groupId, itemId);
        this.activity.record(boardId, actor.id, 'item_moved', { fromGroupId: item.groupId, toGroupId: input.groupId }, itemId);
      }
      if (input.position !== undefined) {
        sets.push('position = ?');
        params.push(input.position);
      }
      if (Object.keys(patch).length) {
        const values = { ...item.values };
        for (const [columnId, v] of Object.entries(patch)) {
          const before = values[columnId] ?? null;
          if (JSON.stringify(before) === JSON.stringify(v)) continue;
          if (v === null) delete values[columnId];
          else values[columnId] = v;
          const col = columns.get(columnId);
          this.activity.record(
            boardId,
            actor.id,
            'item_value_changed',
            // Long text is not copied into history (may be long / sensitive); only the fact of change.
            col?.type === 'long_text'
              ? { columnId, columnTitle: col.title, columnType: col.type }
              : { columnId, columnTitle: col?.title, columnType: col?.type, from: before, to: v },
            itemId,
          );
        }
        sets.push('cell_values = ?');
        params.push(JSON.stringify(values));
      }
      if (!sets.length) return;
      sets.push('updated_at = ?');
      params.push(nowIso());
      this.db.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`).run(...params, itemId);
      this.boards.touch(boardId);
    })();
    const updated = this.getRow(itemId);
    if (Object.keys(patch).length) this.notifications.onAssigned(actor, boardId, itemId, updated.name, this.newAssignees(boardId, item.values, patch));
    return updated;
  }

  // ---------------------------------------------------------------- trash (soft delete)
  /** Moves an item (and its sub-items) to the board's trash. Restorable for LIMITS.trashDays. */
  delete(actor: Actor, itemId: string): void {
    const boardId = this.access.boardIdForItem(itemId);
    this.access.requireBoard(actor, boardId, 'editor');
    const item = this.getRow(itemId);
    this.softDelete(actor, boardId, [item]);
  }

  private softDelete(actor: Actor, boardId: string, items: Item[]): void {
    const ts = nowIso();
    this.db.transaction(() => {
      for (const item of items) {
        this.db.prepare('UPDATE items SET deleted_at = ? WHERE (id = ? OR parent_id = ?) AND deleted_at IS NULL').run(ts, item.id, item.id);
        this.activity.record(boardId, actor.id, 'item_deleted', { name: item.name }, item.id);
      }
      this.boards.touch(boardId);
    })();
  }

  trash(actor: Actor, boardId: string): TrashedItem[] {
    this.access.requireBoard(actor, boardId, 'editor');
    const rows = this.db
      .prepare(
        // Sub-items deleted together with their parent are restored with it, so list only "roots".
        `SELECT i.id, i.name, i.parent_id, i.deleted_at FROM items i
         WHERE i.board_id = ? AND i.deleted_at IS NOT NULL
           AND NOT (i.parent_id IS NOT NULL AND EXISTS (SELECT 1 FROM items p WHERE p.id = i.parent_id AND p.deleted_at = i.deleted_at))
         ORDER BY i.deleted_at DESC LIMIT 500`,
      )
      .all(boardId) as { id: string; name: string; parent_id: string | null; deleted_at: string }[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      parentId: r.parent_id,
      deletedAt: r.deleted_at,
      purgeAt: new Date(Date.parse(r.deleted_at) + LIMITS.trashDays * DAY).toISOString(),
    }));
  }

  restore(actor: Actor, itemId: string): Item {
    const row = this.db.prepare('SELECT * FROM items WHERE id = ? AND deleted_at IS NOT NULL').get(itemId) as ItemRow | undefined;
    if (!row) throw notFound('הפריט לא נמצא בסל המחזור');
    this.access.requireBoard(actor, row.board_id, 'editor');
    if (row.parent_id) {
      const parent = this.db.prepare('SELECT deleted_at FROM items WHERE id = ?').get(row.parent_id) as { deleted_at: string | null } | undefined;
      if (parent?.deleted_at) throw badRequest('יש לשחזר קודם את פריט האב');
    }
    const groupOk = this.db.prepare('SELECT 1 FROM board_groups WHERE id = ? AND board_id = ?').get(row.group_id, row.board_id);
    if (!groupOk) throw badRequest('הקבוצה של הפריט נמחקה');
    this.db.transaction(() => {
      this.db
        .prepare('UPDATE items SET deleted_at = NULL WHERE (id = ? OR (parent_id = ? AND deleted_at = ?))')
        .run(itemId, itemId, row.deleted_at);
      this.activity.record(row.board_id, actor.id, 'item_restored', { name: row.name }, itemId);
      this.boards.touch(row.board_id);
    })();
    return this.getRow(itemId);
  }

  /** Housekeeping: permanently delete trashed items older than `days` (sub-items cascade). */
  purgeTrash(days: number = LIMITS.trashDays): number {
    const cutoff = new Date(Date.now() - days * DAY).toISOString();
    return this.db.prepare('DELETE FROM items WHERE deleted_at IS NOT NULL AND deleted_at < ?').run(cutoff).changes;
  }

  // ---------------------------------------------------------------- duplicate / move
  duplicate(actor: Actor, itemId: string): Item {
    const boardId = this.access.boardIdForItem(itemId);
    this.access.requireBoard(actor, boardId, 'editor');
    const item = this.getRow(itemId);
    if (item.parentId) throw badRequest('לשכפול תת-פריט יש לשכפל את פריט האב');
    let newIdValue = '';
    this.db.transaction(() => {
      newIdValue = this.insertItem(actor, boardId, item.groupId, null, `${item.name} (עותק)`.slice(0, LIMITS.itemName), item.values);
      for (const child of this.children(itemId)) this.insertItem(actor, boardId, item.groupId, newIdValue, child.name, child.values);
      this.activity.record(boardId, actor.id, 'item_duplicated', { fromItemId: itemId, name: item.name }, newIdValue);
      this.boards.touch(boardId);
    })();
    return this.getRow(newIdValue);
  }

  /**
   * Moves an item (with sub-items, updates and files) to another board. Values move to columns
   * with the same title and type; labels by label text; people only if they may be on the
   * target board. Everything else is dropped and reported back.
   */
  moveToBoard(actor: Actor, itemId: string, target: { boardId: string; groupId: string }): { item: Item; dropped: string[] } {
    const fromBoard = this.access.boardIdForItem(itemId);
    this.access.requireBoard(actor, fromBoard, 'editor');
    this.access.requireBoard(actor, target.boardId, 'editor');
    if (fromBoard === target.boardId) throw badRequest('הפריט כבר נמצא בלוח זה');
    this.assertGroupInBoard(target.groupId, target.boardId);
    const item = this.getRow(itemId);
    if (item.parentId) throw badRequest('ניתן להעביר רק פריט ראשי');

    const fromCols = this.boards.columns(fromBoard);
    const toCols = this.boards.columns(target.boardId);
    const dropped = new Set<string>();
    const mapValues = (values: Record<string, CellValue>): Record<string, CellValue> => {
      const out: Record<string, CellValue> = {};
      for (const [cid, v] of Object.entries(values)) {
        const src = fromCols.find((c) => c.id === cid);
        if (!src) continue;
        const dst = toCols.find((c) => c.title === src.title && c.type === src.type && c.type !== 'auto_id');
        if (!dst) {
          dropped.add(src.title);
          continue;
        }
        let mapped: CellValue = v;
        if (src.type === 'status' || src.type === 'tags') {
          const byLabel = (id: string) => {
            const label = src.settings.options?.find((o) => o.id === id)?.label;
            return dst.settings.options?.find((o) => o.label === label)?.id;
          };
          if (src.type === 'status') mapped = typeof v === 'string' ? (byLabel(v) ?? null) : null;
          else mapped = Array.isArray(v) ? (v as string[]).map(byLabel).filter((x): x is string => Boolean(x)) : null;
          if (mapped === null || (Array.isArray(mapped) && mapped.length === 0)) {
            dropped.add(src.title);
            continue;
          }
        }
        if (src.type === 'person' && Array.isArray(v)) {
          try {
            this.assertUsersOnBoard(target.boardId, v as string[], dst.title, dst.id);
          } catch {
            dropped.add(src.title);
            continue;
          }
        }
        out[dst.id] = mapped;
      }
      return out;
    };

    const kids = this.children(itemId);
    this.db.transaction(() => {
      for (const it of [item, ...kids]) {
        this.db
          .prepare('UPDATE items SET board_id = ?, group_id = ?, cell_values = ?, seq = ?, position = ?, updated_at = ? WHERE id = ?')
          .run(
            target.boardId,
            target.groupId,
            JSON.stringify(mapValues(it.values)),
            this.nextSeq(target.boardId),
            it.parentId ? it.position : this.nextPosition(target.groupId, null),
            nowIso(),
            it.id,
          );
        this.db.prepare('UPDATE attachments SET board_id = ? WHERE item_id = ?').run(target.boardId, it.id);
        this.db.prepare('UPDATE notifications SET board_id = ? WHERE item_id = ?').run(target.boardId, it.id);
        this.db.prepare('UPDATE activity SET board_id = ? WHERE item_id = ?').run(target.boardId, it.id);
      }
      this.activity.record(fromBoard, actor.id, 'item_moved_out', { name: item.name, toBoardId: target.boardId });
      this.activity.record(target.boardId, actor.id, 'item_moved_in', { name: item.name, fromBoardId: fromBoard, dropped: [...dropped] }, itemId);
      this.boards.touch(fromBoard);
      this.boards.touch(target.boardId);
    })();
    return { item: this.getRow(itemId), dropped: [...dropped] };
  }

  // ---------------------------------------------------------------- bulk
  bulk(
    actor: Actor,
    boardId: string,
    input: { action: 'delete'; itemIds: string[] } | { action: 'move_group'; itemIds: string[]; groupId: string } | { action: 'set_value'; itemIds: string[]; columnId: string; value: unknown },
  ): { affected: number } {
    this.access.requireBoard(actor, boardId, 'editor');
    const ids = [...new Set(input.itemIds)];
    const items = ids.map((id) => {
      const r = this.db.prepare('SELECT * FROM items WHERE id = ? AND board_id = ? AND deleted_at IS NULL').get(id, boardId) as ItemRow | undefined;
      // Any id outside this board is treated as not found: no partial work, no cross-board leakage.
      if (!r) throw notFound('אחד הפריטים לא נמצא בלוח');
      return toItem(r);
    });
    if (input.action === 'delete') {
      this.softDelete(actor, boardId, items);
    } else if (input.action === 'move_group') {
      this.assertGroupInBoard(input.groupId, boardId);
      if (items.some((i) => i.parentId)) throw badRequest('תת-פריטים עוברים קבוצה עם פריט האב');
      for (const i of items) this.update(actor, i.id, { groupId: input.groupId });
    } else {
      this.validateValues(boardId, { [input.columnId]: input.value }); // validate once before touching anything
      for (const i of items) this.update(actor, i.id, { values: { [input.columnId]: input.value } });
    }
    return { affected: items.length };
  }

  // ---------------------------------------------------------------- import
  /** Creates items from already-parsed rows (the file is read in the browser, never on the server). */
  importRows(actor: Actor, boardId: string, input: { groupId: string; rows: { name: string; values?: Record<string, unknown> }[] }): ImportResult {
    this.access.requireBoard(actor, boardId, 'editor');
    this.assertGroupInBoard(input.groupId, boardId);
    const errors: ImportResult['errors'] = [];
    let created = 0;
    input.rows.forEach((row, idx) => {
      try {
        const values = this.validateValues(boardId, row.values ?? {});
        this.db.transaction(() => {
          this.insertItem(actor, boardId, input.groupId, null, row.name, values);
        })();
        created++;
      } catch (err) {
        errors.push({ row: idx + 1, message: err instanceof AppError ? err.message : 'שגיאה' });
      }
    });
    if (created) {
      this.activity.record(boardId, actor.id, 'items_imported', { count: created });
      this.boards.touch(boardId);
    }
    return { created, errors: errors.slice(0, 100) };
  }

  // ---------------------------------------------------------------- updates (comments)
  listUpdates(actor: Actor, itemId: string): ItemUpdate[] {
    const boardId = this.access.boardIdForItem(itemId);
    this.access.requireBoard(actor, boardId, 'viewer');
    return (
      this.db
        .prepare(
          `SELECT up.id, up.item_id, up.user_id, COALESCE(u.name, 'משתמש שנמחק') AS user_name, up.body, up.created_at
           FROM item_updates up LEFT JOIN users u ON u.id = up.user_id WHERE up.item_id = ? ORDER BY up.created_at DESC`,
        )
        .all(itemId) as { id: string; item_id: string; user_id: string; user_name: string; body: string; created_at: string }[]
    ).map((r) => ({ id: r.id, itemId: r.item_id, userId: r.user_id, userName: r.user_name, body: r.body, createdAt: r.created_at }));
  }

  addUpdate(actor: Actor, itemId: string, body: string, mentions: string[] = []): ItemUpdate {
    const boardId = this.access.boardIdForItem(itemId);
    this.access.requireBoard(actor, boardId, 'editor');
    const mentioned = [...new Set(mentions)].filter((id) => id !== actor.id);
    this.assertUsersOnBoard(boardId, mentioned, 'אזכור', 'mentions');
    const item = this.getRow(itemId);
    const id = newId();
    const ts = nowIso();
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO item_updates (id, item_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)').run(id, itemId, actor.id, body.trim(), ts);
      this.db.prepare('UPDATE items SET updated_at = ? WHERE id = ?').run(ts, itemId);
      this.activity.record(boardId, actor.id, 'update_added', {}, itemId);
      this.boards.touch(boardId);
    })();
    this.notifications.onMentioned(actor, boardId, itemId, item.name, mentioned);
    return { id, itemId, userId: actor.id, userName: actor.name, body: body.trim(), createdAt: ts };
  }

  /** Authors may delete their own update; board owners may delete any. */
  deleteUpdate(actor: Actor, updateId: string): void {
    const row = this.db
      .prepare(
        'SELECT up.user_id, up.item_id, i.board_id FROM item_updates up JOIN items i ON i.id = up.item_id WHERE up.id = ? AND i.deleted_at IS NULL',
      )
      .get(updateId) as { user_id: string | null; item_id: string; board_id: string } | undefined;
    if (!row) throw notFound('העדכון לא נמצא');
    const role = this.access.requireBoard(actor, row.board_id, 'editor');
    if (row.user_id !== actor.id && role !== 'owner') throw forbidden('ניתן למחוק רק עדכונים שכתבת');
    this.db.prepare('DELETE FROM item_updates WHERE id = ?').run(updateId);
    this.activity.record(row.board_id, actor.id, 'update_deleted', {}, row.item_id);
  }
}
