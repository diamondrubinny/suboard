import { MAX_SUBITEM_DEPTH, isReadonlyColumnType, cellValueSchema, LIMITS, REACTIONS, type CellValue, type Group, type Reaction, type UpdateReaction, type ChecklistResult, type ChecklistValue, type Column, type ImportResult, type Item, type ItemUpdate, type TrashedItem } from '@suboard/shared';
import { nowIso, type DB } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { AppError, badRequest, forbidden, notFound } from '../lib/errors.js';
import type { AccessService, Actor } from './access.js';
import type { ActivityService } from './activity.js';
import type { BoardService } from './boards.js';
import { toItem, type ItemRow } from './mappers.js';
import type { NotificationService } from './notifications.js';

const DAY = 86_400_000;

/**
 * Who performs a change: a signed-in user, or the system on behalf of an automation / recurring
 * item (`id: null`, shown in history as "אוטומציה «name»").
 */
export interface Doer {
  id: string | null;
  name: string;
  /** Set for system changes: the rule / recurrence label recorded in the activity log. */
  automation?: string;
}

/** Emitted after a user's change is committed (never for system changes: no automation chaining). */
export interface ItemEvent {
  kind: 'created' | 'changed';
  boardId: string;
  /** The signed-in user who made the change; null when a system rule created the item (e.g. CAPA). */
  actorId: string | null;
  before: Item | null;
  after: Item;
}

/** Emitted after a user writes an update (comment) on an item. */
export interface CommentEvent {
  actor: Actor;
  boardId: string;
  itemId: string;
  itemName: string;
  /** Already notified as mentioned / replied-to: followers' notice skips them. */
  notified: string[];
}

/** Largest group / board that can be copied in one action. */
export const MAX_BULK_COPY = 2000;

export class ItemService {
  constructor(
    private readonly db: DB,
    private readonly access: AccessService,
    private readonly boards: BoardService,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationService,
  ) {}

  private listeners: ((e: ItemEvent) => void)[] = [];
  private commentListeners: ((e: CommentEvent) => void)[] = [];

  /** Subscribe to new updates written by users (used by item following). */
  onComment(fn: (e: CommentEvent) => void): void {
    this.commentListeners.push(fn);
  }

  /** Subscribe to committed user changes (used by the automation engine). */
  onItemEvent(fn: (e: ItemEvent) => void): void {
    this.listeners.push(fn);
  }

  private emit(e: ItemEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(e);
      } catch {
        // Listeners record their own failures; a listener must never fail the user's request.
      }
    }
  }

  private record(doer: Doer, boardId: string, action: Parameters<ActivityService['record']>[2], detail: Record<string, unknown>, itemId?: string): void {
    this.activity.record(boardId, doer.id, action, doer.automation ? { ...detail, automation: doer.automation } : detail, itemId);
  }

  // ---------------------------------------------------------------- helpers
  /** User ids present in `next` person columns but not in `prev` (newly assigned). */
  /** People newly added to person columns between two value sets. */
  newAssignees(boardId: string, prev: Record<string, unknown>, next: Record<string, unknown>): string[] {
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

  /** Every live descendant (all levels), parents before their children. */
  private descendants(itemId: string): Item[] {
    const out: Item[] = [];
    for (const c of this.children(itemId)) out.push(c, ...this.descendants(c.id));
    return out;
  }

  /** 0 for a top-level item, 1 for its sub-item, and so on. */
  private depthOf(item: Item): number {
    let d = 0;
    for (let cur = item; cur.parentId && d <= MAX_SUBITEM_DEPTH; d++) cur = this.getRow(cur.parentId);
    return d;
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
  assertUsersOnBoard(boardId: string, ids: string[], label: string, field: string): void {
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
  validateValues(boardId: string, patch: Record<string, unknown>): Record<string, CellValue> {
    const columns = new Map<string, Column>(this.boards.columns(boardId).map((c) => [c.id, c]));
    const out: Record<string, CellValue> = {};
    for (const [columnId, raw] of Object.entries(patch)) {
      const col = columns.get(columnId);
      if (!col) throw badRequest('עמודה לא קיימת בלוח', { [columnId]: 'עמודה לא קיימת' });
      if (isReadonlyColumnType(col.type)) throw badRequest(`העמודה "${col.title}" מחושבת אוטומטית`, { [columnId]: 'לא ניתן לעריכה' });
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
      if (col.type === 'checklist' && v && typeof v === 'object') {
        const allowed = new Set(col.settings.checklist?.items.map((i) => i.id));
        const entries = Object.entries(v as Record<string, { r: ChecklistResult }>);
        if (entries.some(([k]) => !allowed.has(k))) throw badRequest(`סעיף לא קיים בעמודה "${col.title}"`, { [columnId]: 'סעיף לא קיים' });
        v = entries.length ? (Object.fromEntries(entries.map(([k, e]) => [k, { r: e.r }])) as ChecklistValue) : null;
      }
      out[columnId] = v;
    }
    return out;
  }

  private insertItem(
    actor: Doer,
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

  /**
   * Columns locked to the board's owners: an editor may not write their cells, through any path a
   * person drives (edit, create, bulk edit, import, connect-boards). Automations and forms, which the
   * owner configured, are not people and keep working.
   */
  assertMayEditColumns(actor: Actor, boardId: string, columnIds: string[]): void {
    if (!columnIds.length || this.access.boardRole(actor, boardId) === 'owner') return;
    const locked = this.boards.columns(boardId).find((c) => columnIds.includes(c.id) && c.settings.editBy === 'owners');
    if (locked) throw forbidden(`רק בעלי הלוח יכולים לערוך את העמודה "${locked.title}"`);
  }

  // ---------------------------------------------------------------- CRUD
  create(actor: Actor, boardId: string, input: { groupId: string; parentId?: string; name: string; values?: Record<string, unknown> }): Item {
    this.access.requireBoard(actor, boardId, 'editor');
    this.assertMayEditColumns(actor, boardId, Object.keys(input.values ?? {}));
    const item = this.createAs(actor, boardId, input);
    this.emit({ kind: 'created', boardId, actorId: actor.id, before: null, after: item });
    return item;
  }

  /**
   * Item from a form submission. The FormService has already checked that the actor may submit this
   * form (audience) and which columns it may fill; values get the same validation as a manual edit.
   */
  createFromForm(actor: Actor, boardId: string, formId: string, formName: string, input: { groupId: string; name: string; values: Record<string, unknown> }): Item {
    const item = this.createAs(actor, boardId, input);
    this.db.prepare('UPDATE items SET form_id = ? WHERE id = ?').run(formId, item.id);
    this.activity.record(boardId, actor.id, 'form_submitted', { form: formName }, item.id);
    this.emit({ kind: 'created', boardId, actorId: actor.id, before: null, after: item });
    return item;
  }

  /** System create (automation / recurring item): validated like a user's, but never emits events. */
  systemCreate(doer: Doer, boardId: string, input: { groupId: string; parentId?: string; name: string; values?: Record<string, unknown> }): Item {
    return this.createAs(doer, boardId, input);
  }

  private createAs(actor: Doer, boardId: string, input: { groupId: string; parentId?: string; name: string; values?: Record<string, unknown> }): Item {
    let groupId = input.groupId;
    if (input.parentId) {
      const parent = this.getRow(input.parentId);
      if (parent.boardId !== boardId) throw badRequest('פריט האב אינו שייך ללוח', { parentId: 'פריט לא תקין' });
      if (this.depthOf(parent) >= MAX_SUBITEM_DEPTH) throw badRequest(`ניתן לקנן תת-פריטים עד ${MAX_SUBITEM_DEPTH} רמות`, { parentId: `עד ${MAX_SUBITEM_DEPTH} רמות` });
      groupId = parent.groupId;
    } else {
      this.assertGroupInBoard(groupId, boardId);
    }
    const values = this.validateValues(boardId, input.values ?? {});
    let id = '';
    this.db.transaction(() => {
      id = this.insertItem(actor, boardId, groupId, input.parentId ?? null, input.name, values);
      this.record(actor, boardId, 'item_created', { name: input.name, ...(input.parentId ? { parentId: input.parentId } : {}) }, id);
      this.boards.touch(boardId);
    })();
    this.notifications.onAssigned(actor, boardId, id, input.name, this.newAssignees(boardId, {}, values));
    this.openCorrectiveActions(id);
    return this.getRow(id);
  }

  update(actor: Actor, itemId: string, input: { name?: string; groupId?: string; position?: number; values?: Record<string, unknown> }): Item {
    const boardId = this.access.boardIdForItem(itemId);
    this.access.requireBoard(actor, boardId, 'editor');
    this.assertMayEditColumns(actor, boardId, Object.keys(input.values ?? {}));
    const before = this.getRow(itemId);
    const after = this.updateAs(actor, boardId, before, input);
    const changed = before.name !== after.name || before.groupId !== after.groupId || JSON.stringify(before.values) !== JSON.stringify(after.values);
    if (changed) this.emit({ kind: 'changed', boardId, actorId: actor.id, before, after });
    return after;
  }

  /** System update (automation): same validation and history as a user's, never emits events. */
  systemUpdate(doer: Doer, itemId: string, input: { groupId?: string; values?: Record<string, unknown> }): Item {
    const boardId = this.access.boardIdForItem(itemId);
    return this.updateAs(doer, boardId, this.getRow(itemId), input);
  }

  /** A live item (internal use by trusted services that already checked access). */
  getLive(itemId: string): Item {
    return this.getRow(itemId);
  }

  private updateAs(
    actor: Doer,
    boardId: string,
    item: Item,
    input: { name?: string; groupId?: string; position?: number; values?: Record<string, unknown> },
  ): Item {
    const itemId = item.id;
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
        this.record(actor, boardId, 'item_renamed', { from: item.name, to: input.name }, itemId);
      }
      if (input.groupId !== undefined && input.groupId !== item.groupId) {
        sets.push('group_id = ?');
        params.push(input.groupId);
        if (input.position === undefined) {
          sets.push('position = ?');
          params.push(this.nextPosition(input.groupId, null));
        }
        // Sub-items always live in their parent's group.
        for (const d of this.descendants(itemId)) this.db.prepare('UPDATE items SET group_id = ? WHERE id = ?').run(input.groupId, d.id);
        this.record(actor, boardId, 'item_moved', { fromGroupId: item.groupId, toGroupId: input.groupId }, itemId);
      }
      if (input.position !== undefined) {
        sets.push('position = ?');
        params.push(input.position);
      }
      if (Object.keys(patch).length) {
        const values = { ...item.values };
        for (const [columnId, raw] of Object.entries(patch)) {
          const before = values[columnId] ?? null;
          let v = raw;
          if (columns.get(columnId)?.type === 'checklist' && v && before && typeof before === 'object') {
            // Corrective-action links are server-maintained: carry them over from the stored value.
            const prev = before as ChecklistValue;
            v = Object.fromEntries(Object.entries(v as ChecklistValue).map(([k, e]) => [k, prev[k]?.capa ? { r: e.r, capa: prev[k]!.capa } : e])) as ChecklistValue;
          }
          if (JSON.stringify(before) === JSON.stringify(v)) continue;
          if (v === null) delete values[columnId];
          else values[columnId] = v;
          const col = columns.get(columnId);
          this.record(
            actor,
            boardId,
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
    if (Object.keys(patch).length) {
      this.notifications.onAssigned(actor, boardId, itemId, this.getRow(itemId).name, this.newAssignees(boardId, item.values, patch));
      this.openCorrectiveActions(itemId);
    }
    return this.getRow(itemId);
  }

  // ---------------------------------------------------------------- checklist → corrective action (wave C)
  /**
   * For every checklist entry marked "fail" without a corrective action yet, opens one on the
   * column's corrective-action board (on behalf of the system — wired by a board owner who could
   * edit that board), links both items and records the new item's id in the checklist value.
   */
  private openCorrectiveActions(itemId: string): void {
    const item = this.getRow(itemId);
    const cols = this.boards.columns(item.boardId).filter((c) => c.type === 'checklist' && c.settings.checklist?.capaBoardId);
    if (!cols.length) return;
    const values = { ...item.values };
    let changed = false;
    for (const col of cols) {
      const cl = col.settings.checklist!;
      const v = values[col.id] as ChecklistValue | undefined;
      if (!v) continue;
      const target = this.db.prepare('SELECT id FROM boards WHERE id = ? AND archived_at IS NULL').get(cl.capaBoardId) as { id: string } | undefined;
      if (!target) continue;
      const groupId =
        (cl.capaGroupId && (this.db.prepare('SELECT id FROM board_groups WHERE id = ? AND board_id = ?').get(cl.capaGroupId, target.id) as { id: string } | undefined)?.id) ||
        (this.db.prepare('SELECT id FROM board_groups WHERE board_id = ? ORDER BY position LIMIT 1').get(target.id) as { id: string } | undefined)?.id;
      if (!groupId) continue;
      for (const entry of cl.items) {
        const e = v[entry.id];
        if (e?.r !== 'fail' || e.capa) continue;
        const doer: Doer = { id: null, name: `צ'קליסט «${col.title}»`, automation: `צ'קליסט «${col.title}»` };
        const capa = this.createAs(doer, target.id, { groupId, name: `${entry.label} — ${item.name}`.slice(0, LIMITS.itemName) });
        this.db
          .prepare("INSERT INTO item_links (id, from_item, to_item, kind, created_by, created_at) VALUES (?, ?, ?, 'checklist_capa', NULL, ?)")
          .run(newId(), item.id, capa.id, nowIso());
        v[entry.id] = { r: 'fail', capa: capa.id };
        changed = true;
        this.emit({ kind: 'created', boardId: target.id, actorId: null, before: null, after: capa });
      }
      values[col.id] = v;
    }
    if (changed) this.db.prepare('UPDATE items SET cell_values = ? WHERE id = ?').run(JSON.stringify(values), item.id);
  }

  /** Links two items (used by investigations). */
  link(fromItem: string, toItem: string, kind: 'investigation_action', userId: string): void {
    this.db.prepare('INSERT INTO item_links (id, from_item, to_item, kind, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(newId(), fromItem, toItem, kind, userId, nowIso());
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
        for (const id of [item.id, ...this.descendants(item.id).map((d) => d.id)]) this.db.prepare('UPDATE items SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(ts, id);
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
      // The item, and every descendant that went to the trash in the same action.
      this.db
        .prepare(
          `WITH RECURSIVE tree(id) AS (
             SELECT ? UNION ALL SELECT i.id FROM items i JOIN tree t ON i.parent_id = t.id WHERE i.deleted_at = ?
           )
           UPDATE items SET deleted_at = NULL WHERE id IN (SELECT id FROM tree)`,
        )
        .run(itemId, row.deleted_at);
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

  /** Turns a sub-item into a top-level item of the same group (its own sub-items stay with it). */
  promote(actor: Actor, itemId: string): Item {
    const boardId = this.access.boardIdForItem(itemId);
    this.access.requireBoard(actor, boardId, 'editor');
    const item = this.getRow(itemId);
    if (!item.parentId) throw badRequest('הפריט כבר פריט ראשי');
    const parent = this.getRow(item.parentId);
    this.db.transaction(() => {
      this.db.prepare('UPDATE items SET parent_id = NULL, position = ?, updated_at = ? WHERE id = ?').run(this.nextPosition(item.groupId, null), nowIso(), itemId);
      this.activity.record(boardId, actor.id, 'item_promoted', { name: item.name, fromParent: parent.name }, itemId);
      this.boards.touch(boardId);
    })();
    return this.getRow(itemId);
  }

  // ---------------------------------------------------------------- duplicate / move
  duplicate(actor: Actor, itemId: string): Item {
    const boardId = this.access.boardIdForItem(itemId);
    this.access.requireBoard(actor, boardId, 'editor');
    const item = this.getRow(itemId);
    let newIdValue = '';
    this.db.transaction(() => {
      // A copy stays next to the original (same parent), with its own sub-items.
      newIdValue = this.insertItem(actor, boardId, item.groupId, item.parentId, `${item.name} (עותק)`.slice(0, LIMITS.itemName), item.values);
      const copyKids = (fromId: string, toId: string) => {
        for (const child of this.children(fromId)) copyKids(child.id, this.insertItem(actor, boardId, item.groupId, toId, child.name, child.values));
      };
      copyKids(itemId, newIdValue);
      this.activity.record(boardId, actor.id, 'item_duplicated', { fromItemId: itemId, name: item.name }, newIdValue);
      this.boards.touch(boardId);
    })();
    const copy = this.getRow(newIdValue);
    this.emit({ kind: 'created', boardId, actorId: actor.id, before: null, after: copy });
    return copy;
  }

  /** Live items of a board, parents before their children. */
  private liveTree(boardId: string): Item[] {
    return (this.db.prepare('SELECT * FROM items WHERE board_id = ? AND deleted_at IS NULL ORDER BY position').all(boardId) as ItemRow[]).map(toItem);
  }

  /**
   * Copies a group with all its items and sub-items into a new group right in the same board.
   * A bulk copy: no notifications and no automations run for the copies.
   */
  duplicateGroup(actor: Actor, groupId: string): { group: Group; items: number } {
    const boardId = this.access.boardIdForGroup(groupId);
    this.access.requireBoard(actor, boardId, 'editor');
    const source = this.boards.groups(boardId).find((g) => g.id === groupId)!;
    const all = this.liveTree(boardId).filter((i) => i.groupId === groupId);
    if (all.length > MAX_BULK_COPY) throw badRequest(`אפשר לשכפל קבוצה של עד ${MAX_BULK_COPY} פריטים`);
    const group = this.boards.createGroup(actor, boardId, { name: `${source.name} (עותק)`.slice(0, LIMITS.groupName), color: source.color });
    this.db.transaction(() => {
      const copy = (parentFrom: string | null, parentTo: string | null) => {
        for (const it of all.filter((i) => i.parentId === parentFrom)) copy(it.id, this.insertItem(actor, boardId, group.id, parentTo, it.name, it.values));
      };
      copy(null, null);
      this.activity.record(boardId, actor.id, 'group_duplicated', { name: source.name, items: all.length });
      this.boards.touch(boardId);
    })();
    return { group, items: all.length };
  }

  countLive(boardId: string): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM items WHERE board_id = ? AND deleted_at IS NULL').get(boardId) as { n: number }).n;
  }

  /**
   * Fills a freshly duplicated board with copies of the source board's items (groups and columns
   * are matched by position). People, checklist results, updates and files are not copied: the new
   * board starts with its creator as the only member. Callers check access to both boards.
   */
  copyBoardItems(actor: Actor, fromBoardId: string, toBoardId: string): number {
    const fromGroups = this.boards.groups(fromBoardId);
    const toGroups = this.boards.groups(toBoardId);
    const fromCols = this.boards.columns(fromBoardId);
    const toCols = this.boards.columns(toBoardId);
    const colMap = new Map<string, string>();
    fromCols.forEach((c, i) => {
      const dst = toCols[i];
      if (dst && dst.type === c.type && !isReadonlyColumnType(c.type) && c.type !== 'person' && c.type !== 'checklist') colMap.set(c.id, dst.id);
    });
    const all = this.liveTree(fromBoardId);
    this.db.transaction(() => {
      const copy = (parentFrom: string | null, parentTo: string | null) => {
        for (const it of all.filter((i) => i.parentId === parentFrom)) {
          const group = toGroups[fromGroups.findIndex((g) => g.id === it.groupId)] ?? toGroups[0];
          if (!group) continue;
          const values = Object.fromEntries(Object.entries(it.values).flatMap(([k, v]) => (colMap.has(k) ? [[colMap.get(k)!, v]] : [])));
          copy(it.id, this.insertItem(actor, toBoardId, group.id, parentTo, it.name, values));
        }
      };
      copy(null, null);
      this.boards.touch(toBoardId);
    })();
    return all.length;
  }

  /**
   * Moves an item (with sub-items, updates and files) to another board. Values move to columns
   * with the same title and type; labels by label text; people only if they may be on the
   * target board. Everything else is dropped and reported back.
   */
  moveToBoard(actor: Actor, itemId: string, target: { boardId: string; groupId: string }): { item: Item; dropped: string[] } {
    // Values never land in a column of the target board that is locked to its owners, unless the mover is one.
    const targetOwner = this.access.boardRole(actor, target.boardId) === 'owner';
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
        const dst = toCols.find((c) => c.title === src.title && c.type === src.type && !isReadonlyColumnType(c.type) && (targetOwner || c.settings.editBy !== 'owners'));
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

    const kids = this.descendants(itemId);
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
    this.assertMayEditColumns(actor, boardId, [...new Set(input.rows.flatMap((r) => Object.keys(r.values ?? {})))]);
    const errors: ImportResult['errors'] = [];
    let created = 0;
    input.rows.forEach((row, idx) => {
      try {
        const values = this.validateValues(boardId, row.values ?? {});
        let id = '';
        this.db.transaction(() => {
          id = this.insertItem(actor, boardId, input.groupId, null, row.name, values);
        })();
        created++;
        this.emit({ kind: 'created', boardId, actorId: actor.id, before: null, after: this.getRow(id) });
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
    const rows = this.db
      .prepare(
        `SELECT up.id, up.item_id, up.user_id, COALESCE(u.name, 'משתמש שנמחק') AS user_name, up.body, up.created_at, up.parent_id
         FROM item_updates up LEFT JOIN users u ON u.id = up.user_id WHERE up.item_id = ? ORDER BY up.created_at DESC`,
      )
      .all(itemId) as { id: string; item_id: string; user_id: string; user_name: string; body: string; created_at: string; parent_id: string | null }[];
    const reactions = this.db
      .prepare(
        `SELECT r.update_id, r.emoji, r.user_id, COALESCE(u.name, 'משתמש שנמחק') AS user_name
         FROM update_reactions r JOIN item_updates up ON up.id = r.update_id LEFT JOIN users u ON u.id = r.user_id
         WHERE up.item_id = ? ORDER BY r.created_at`,
      )
      .all(itemId) as { update_id: string; emoji: Reaction; user_id: string; user_name: string }[];
    const byUpdate = new Map<string, UpdateReaction[]>();
    for (const r of reactions) {
      const list = byUpdate.get(r.update_id) ?? [];
      let entry = list.find((x) => x.emoji === r.emoji);
      if (!entry) list.push((entry = { emoji: r.emoji, count: 0, mine: false, users: [] }));
      entry.count++;
      entry.users.push(r.user_name);
      if (r.user_id === actor.id) entry.mine = true;
      byUpdate.set(r.update_id, list);
    }
    const order = (list: UpdateReaction[]) => list.sort((a, b) => REACTIONS.indexOf(a.emoji) - REACTIONS.indexOf(b.emoji));
    return rows.map((r) => ({
      id: r.id,
      itemId: r.item_id,
      userId: r.user_id,
      userName: r.user_name,
      body: r.body,
      createdAt: r.created_at,
      parentId: r.parent_id,
      reactions: order(byUpdate.get(r.id) ?? []),
    }));
  }

  addUpdate(actor: Actor, itemId: string, body: string, mentions: string[] = [], parentId?: string): ItemUpdate {
    const boardId = this.access.boardIdForItem(itemId);
    this.access.requireBoard(actor, boardId, 'editor');
    const mentioned = [...new Set(mentions)].filter((id) => id !== actor.id);
    this.assertUsersOnBoard(boardId, mentioned, 'אזכור', 'mentions');
    let parent: { id: string; user_id: string | null } | undefined;
    if (parentId) {
      const p = this.db.prepare('SELECT id, user_id, parent_id FROM item_updates WHERE id = ? AND item_id = ?').get(parentId, itemId) as
        | { id: string; user_id: string | null; parent_id: string | null }
        | undefined;
      if (!p) throw badRequest('העדכון שאליו עונים לא נמצא', { parentId: 'עדכון לא תקין' });
      // One level only: a reply to a reply joins the same thread.
      parent = p.parent_id ? (this.db.prepare('SELECT id, user_id FROM item_updates WHERE id = ?').get(p.parent_id) as { id: string; user_id: string | null }) : p;
    }
    const item = this.getRow(itemId);
    const id = newId();
    const ts = nowIso();
    this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO item_updates (id, item_id, user_id, body, created_at, parent_id) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, itemId, actor.id, body.trim(), ts, parent?.id ?? null);
      this.db.prepare('UPDATE items SET updated_at = ? WHERE id = ?').run(ts, itemId);
      this.activity.record(boardId, actor.id, 'update_added', {}, itemId);
      this.boards.touch(boardId);
    })();
    this.notifications.onMentioned(actor, boardId, itemId, item.name, mentioned);
    const notified = [...mentioned];
    if (parent?.user_id && parent.user_id !== actor.id && !mentioned.includes(parent.user_id)) {
      this.notifications.onReply(actor, boardId, itemId, item.name, parent.user_id);
      notified.push(parent.user_id);
    }
    for (const fn of this.commentListeners) {
      try {
        fn({ actor, boardId, itemId, itemName: item.name, notified });
      } catch {
        // Following is best-effort; never fails the user's request.
      }
    }
    return { id, itemId, userId: actor.id, userName: actor.name, body: body.trim(), createdAt: ts, parentId: parent?.id ?? null, reactions: [] };
  }

  /** Toggle one reaction of the actor on an update (fixed emoji set). Same right as writing an update. */
  react(actor: Actor, updateId: string, emoji: Reaction, on: boolean): void {
    const row = this.db
      .prepare('SELECT i.board_id FROM item_updates up JOIN items i ON i.id = up.item_id WHERE up.id = ? AND i.deleted_at IS NULL')
      .get(updateId) as { board_id: string } | undefined;
    if (!row) throw notFound('העדכון לא נמצא');
    this.access.requireBoard(actor, row.board_id, 'editor');
    if (on) this.db.prepare('INSERT OR IGNORE INTO update_reactions (update_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)').run(updateId, actor.id, emoji, nowIso());
    else this.db.prepare('DELETE FROM update_reactions WHERE update_id = ? AND user_id = ? AND emoji = ?').run(updateId, actor.id, emoji);
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
