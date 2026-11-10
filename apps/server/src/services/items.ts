import { cellValueSchema, type CellValue, type Column, type Item, type ItemUpdate } from '@suboard/shared';
import { nowIso, type DB } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import type { AccessService, Actor } from './access.js';
import type { ActivityService } from './activity.js';
import type { BoardService } from './boards.js';
import { toItem, type ItemRow } from './mappers.js';
import type { NotificationService } from './notifications.js';

export class ItemService {
  constructor(
    private readonly db: DB,
    private readonly access: AccessService,
    private readonly boards: BoardService,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationService,
  ) {}

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

  private getRow(itemId: string): Item {
    const r = this.db.prepare('SELECT * FROM items WHERE id = ?').get(itemId) as ItemRow | undefined;
    if (!r) throw notFound('הפריט לא נמצא');
    return toItem(r);
  }

  private assertGroupInBoard(groupId: string, boardId: string): void {
    const g = this.db.prepare('SELECT 1 FROM board_groups WHERE id = ? AND board_id = ?').get(groupId, boardId);
    if (!g) throw badRequest('הקבוצה אינה שייכת ללוח', { groupId: 'קבוצה לא תקינה' });
  }

  /**
   * Validates a partial `values` patch against the board's columns:
   * shape by type, status option existence, and that referenced users exist and are active.
   */
  private validateValues(boardId: string, patch: Record<string, unknown>): Record<string, CellValue> {
    const columns = new Map<string, Column>(this.boards.columns(boardId).map((c) => [c.id, c]));
    const out: Record<string, CellValue> = {};
    for (const [columnId, raw] of Object.entries(patch)) {
      const col = columns.get(columnId);
      if (!col) throw badRequest('עמודה לא קיימת בלוח', { [columnId]: 'עמודה לא קיימת' });
      let value: unknown = raw;
      if (typeof value === 'string' && value.trim() === '' && col.type !== 'long_text') value = null;
      const parsed = cellValueSchema(col.type).safeParse(value);
      if (!parsed.success) throw badRequest(`ערך לא תקין בעמודה "${col.title}"`, { [columnId]: parsed.error.issues[0]?.message ?? 'ערך לא תקין' });
      let v = parsed.data as CellValue;
      if (col.type === 'status' && typeof v === 'string' && !col.settings.options?.some((o) => o.id === v)) {
        throw badRequest(`תווית לא קיימת בעמודה "${col.title}"`, { [columnId]: 'תווית לא קיימת' });
      }
      if (col.type === 'person' && Array.isArray(v)) {
        const ids = [...new Set(v)];
        if (ids.length) {
          // Assignees must be active and able to see the board (members, or system admins).
          const found = this.db
            .prepare(
              `SELECT COUNT(*) AS n FROM users u
               WHERE u.is_active = 1 AND u.id IN (${ids.map(() => '?').join(',')})
                 AND (u.role = 'admin' OR EXISTS (SELECT 1 FROM board_members m WHERE m.board_id = ? AND m.user_id = u.id))`,
            )
            .get(...ids, boardId) as { n: number };
          if (found.n !== ids.length) throw badRequest(`ניתן לשייך רק חברי לוח פעילים (עמודה "${col.title}")`, { [columnId]: 'משתמש לא תקין' });
        }
        v = ids.length ? ids : null;
      }
      if (col.type === 'long_text' && typeof v === 'string' && v.trim() === '') v = null;
      out[columnId] = v;
    }
    return out;
  }

  create(actor: Actor, boardId: string, input: { groupId: string; name: string; values?: Record<string, unknown> }): Item {
    this.access.requireBoard(actor, boardId, 'editor');
    this.assertGroupInBoard(input.groupId, boardId);
    const values = Object.fromEntries(Object.entries(this.validateValues(boardId, input.values ?? {})).filter(([, v]) => v !== null));
    const max = (this.db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM items WHERE group_id = ?').get(input.groupId) as { p: number }).p;
    const id = newId();
    const ts = nowIso();
    this.db.transaction(() => {
      this.db
        .prepare(
          'INSERT INTO items (id, board_id, group_id, name, cell_values, position, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(id, boardId, input.groupId, input.name, JSON.stringify(values), max + 1, actor.id, ts, ts);
      this.activity.record(boardId, actor.id, 'item_created', { name: input.name }, id);
      this.boards.touch(boardId);
    })();
    this.notifications.onAssigned(actor, boardId, id, input.name, this.newAssignees(boardId, {}, values));
    return this.getRow(id);
  }

  update(
    actor: Actor,
    itemId: string,
    input: { name?: string; groupId?: string; position?: number; values?: Record<string, unknown> },
  ): Item {
    const boardId = this.access.boardIdForItem(itemId);
    this.access.requireBoard(actor, boardId, 'editor');
    const item = this.getRow(itemId);
    if (input.groupId) this.assertGroupInBoard(input.groupId, boardId);
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
          const max = (this.db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM items WHERE group_id = ?').get(input.groupId) as { p: number }).p;
          sets.push('position = ?');
          params.push(max + 1);
        }
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

  delete(actor: Actor, itemId: string): void {
    const boardId = this.access.boardIdForItem(itemId);
    this.access.requireBoard(actor, boardId, 'editor');
    const item = this.getRow(itemId);
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM items WHERE id = ?').run(itemId);
      this.activity.record(boardId, actor.id, 'item_deleted', { name: item.name });
      this.boards.touch(boardId);
    })();
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

  addUpdate(actor: Actor, itemId: string, body: string): ItemUpdate {
    const boardId = this.access.boardIdForItem(itemId);
    this.access.requireBoard(actor, boardId, 'editor');
    const id = newId();
    const ts = nowIso();
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO item_updates (id, item_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)').run(id, itemId, actor.id, body.trim(), ts);
      this.db.prepare('UPDATE items SET updated_at = ? WHERE id = ?').run(ts, itemId);
      this.activity.record(boardId, actor.id, 'update_added', {}, itemId);
      this.boards.touch(boardId);
    })();
    return { id, itemId, userId: actor.id, userName: actor.name, body: body.trim(), createdAt: ts };
  }

  /** Authors may delete their own update; board owners may delete any. */
  deleteUpdate(actor: Actor, updateId: string): void {
    const row = this.db
      .prepare('SELECT up.user_id, up.item_id, i.board_id FROM item_updates up JOIN items i ON i.id = up.item_id WHERE up.id = ?')
      .get(updateId) as { user_id: string | null; item_id: string; board_id: string } | undefined;
    if (!row) throw notFound('העדכון לא נמצא');
    const role = this.access.requireBoard(actor, row.board_id, 'editor');
    if (row.user_id !== actor.id && role !== 'owner') throw forbidden('ניתן למחוק רק עדכונים שכתבת');
    this.db.prepare('DELETE FROM item_updates WHERE id = ?').run(updateId);
    this.activity.record(row.board_id, actor.id, 'update_deleted', {}, row.item_id);
  }
}
