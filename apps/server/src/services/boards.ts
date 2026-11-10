import {
  COLOR_KEYS,
  LIMITS,
  type BoardDetail,
  type BoardMember,
  type BoardRole,
  type BoardSummary,
  type ColorKey,
  type Column,
  type ColumnSettings,
  type ColumnType,
  type CreateColumnInput,
  type Group,
  type UpdateColumnInput,
} from '@suboard/shared';
import { nowIso, type DB } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import type { AccessService, Actor } from './access.js';
import type { ActivityService } from './activity.js';
import type { AuditService } from './audit.js';
import { toColumn, toGroup, toItem, type ColumnRow, type GroupRow, type ItemRow } from './mappers.js';
import { getTemplate } from './templates.js';

interface BoardRow {
  id: string;
  name: string;
  description: string;
  template_key: string;
  created_at: string;
  updated_at: string;
}

export class BoardService {
  constructor(
    private readonly db: DB,
    private readonly access: AccessService,
    private readonly activity: ActivityService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- boards
  list(actor: Actor): BoardSummary[] {
    const rows = (
      actor.role === 'admin'
        ? this.db
            .prepare(
              `SELECT b.*, COALESCE(m.role, 'owner') AS my_role,
                 (SELECT COUNT(*) FROM items i WHERE i.board_id = b.id AND i.deleted_at IS NULL AND i.parent_id IS NULL) AS item_count
               FROM boards b LEFT JOIN board_members m ON m.board_id = b.id AND m.user_id = ?
               WHERE b.archived_at IS NULL ORDER BY b.updated_at DESC`,
            )
            .all(actor.id)
        : this.db
            .prepare(
              `SELECT b.*, m.role AS my_role,
                 (SELECT COUNT(*) FROM items i WHERE i.board_id = b.id AND i.deleted_at IS NULL AND i.parent_id IS NULL) AS item_count
               FROM boards b JOIN board_members m ON m.board_id = b.id AND m.user_id = ?
               WHERE b.archived_at IS NULL ORDER BY b.updated_at DESC`,
            )
            .all(actor.id)
    ) as (BoardRow & { my_role: BoardRole; item_count: number })[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      templateKey: r.template_key,
      // Admins have owner-level rights on every board regardless of membership row.
      myRole: actor.role === 'admin' ? 'owner' : r.my_role,
      itemCount: r.item_count,
      updatedAt: r.updated_at,
    }));
  }

  create(actor: Actor, input: { name: string; description?: string; templateKey: string }): BoardDetail {
    if (actor.role === 'member') throw forbidden('רק מנהלים יכולים ליצור לוחות');
    const template = getTemplate(input.templateKey);
    if (!template) throw badRequest('תבנית לא קיימת', { templateKey: 'תבנית לא קיימת' });

    const id = newId();
    const ts = nowIso();
    this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO boards (id, name, description, template_key, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, input.name, input.description ?? '', template.key, actor.id, ts, ts);
      this.db.prepare("INSERT INTO board_members (board_id, user_id, role) VALUES (?, ?, 'owner')").run(id, actor.id);
      template.groups.forEach((g, i) => {
        this.db.prepare('INSERT INTO board_groups (id, board_id, name, color, position) VALUES (?, ?, ?, ?, ?)').run(newId(), id, g.name, g.color, i);
      });
      template.columns.forEach((c, i) => {
        this.db
          .prepare('INSERT INTO board_columns (id, board_id, title, type, settings, position) VALUES (?, ?, ?, ?, ?, ?)')
          .run(newId(), id, c.title, c.type, JSON.stringify(c.settings ?? {}), i);
      });
      this.activity.record(id, actor.id, 'board_created', { name: input.name, template: template.key });
    })();
    this.audit.log('board_created', { userId: actor.id, meta: { boardId: id, template: template.key } });
    return this.get(actor, id);
  }

  get(actor: Actor, boardId: string): BoardDetail {
    const myRole = this.access.requireBoard(actor, boardId, 'viewer');
    const b = this.db.prepare('SELECT * FROM boards WHERE id = ?').get(boardId) as BoardRow;
    return {
      id: b.id,
      name: b.name,
      description: b.description,
      templateKey: b.template_key,
      myRole,
      groups: this.groups(boardId),
      columns: this.columns(boardId),
      items: (this.db.prepare('SELECT * FROM items WHERE board_id = ? AND deleted_at IS NULL ORDER BY position, created_at').all(boardId) as ItemRow[]).map(toItem),
      members: this.members(boardId),
      createdAt: b.created_at,
      updatedAt: b.updated_at,
    };
  }

  update(actor: Actor, boardId: string, input: { name?: string; description?: string }): BoardDetail {
    this.access.requireBoard(actor, boardId, 'owner');
    const sets: string[] = [];
    const params: unknown[] = [];
    if (input.name !== undefined) {
      sets.push('name = ?');
      params.push(input.name);
    }
    if (input.description !== undefined) {
      sets.push('description = ?');
      params.push(input.description);
    }
    sets.push('updated_at = ?');
    params.push(nowIso());
    this.db.prepare(`UPDATE boards SET ${sets.join(', ')} WHERE id = ?`).run(...params, boardId);
    this.activity.record(boardId, actor.id, 'board_updated', { fields: Object.keys(input) });
    return this.get(actor, boardId);
  }

  archive(actor: Actor, boardId: string): void {
    this.access.requireBoard(actor, boardId, 'owner');
    this.db.prepare('UPDATE boards SET archived_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), boardId);
    this.audit.log('board_archived', { userId: actor.id, meta: { boardId } });
  }

  touch(boardId: string): void {
    this.db.prepare('UPDATE boards SET updated_at = ? WHERE id = ?').run(nowIso(), boardId);
  }

  // ---------------------------------------------------------------- members
  members(boardId: string): BoardMember[] {
    return (
      this.db
        .prepare(
          `SELECT m.user_id, u.name, u.email, m.role FROM board_members m JOIN users u ON u.id = m.user_id
           WHERE m.board_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, u.name`,
        )
        .all(boardId) as { user_id: string; name: string; email: string; role: BoardRole }[]
    ).map((r) => ({ userId: r.user_id, name: r.name, email: r.email, role: r.role }));
  }

  setMember(actor: Actor, boardId: string, userId: string, role: BoardRole): BoardMember[] {
    this.access.requireBoard(actor, boardId, 'owner');
    const user = this.db.prepare('SELECT id FROM users WHERE id = ? AND is_active = 1').get(userId);
    if (!user) throw badRequest('המשתמש לא נמצא או אינו פעיל', { userId: 'משתמש לא תקין' });
    const current = this.db.prepare('SELECT role FROM board_members WHERE board_id = ? AND user_id = ?').get(boardId, userId) as
      | { role: BoardRole }
      | undefined;
    if (current?.role === 'owner' && role !== 'owner') this.assertNotLastOwner(boardId);
    this.db
      .prepare('INSERT INTO board_members (board_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT(board_id, user_id) DO UPDATE SET role = excluded.role')
      .run(boardId, userId, role);
    this.activity.record(boardId, actor.id, 'member_set', { userId, role });
    this.audit.log('member_set', { userId: actor.id, meta: { boardId, targetUserId: userId, role } });
    return this.members(boardId);
  }

  removeMember(actor: Actor, boardId: string, userId: string): BoardMember[] {
    this.access.requireBoard(actor, boardId, 'owner');
    const current = this.db.prepare('SELECT role FROM board_members WHERE board_id = ? AND user_id = ?').get(boardId, userId) as
      | { role: BoardRole }
      | undefined;
    if (!current) throw notFound('החבר לא נמצא בלוח');
    if (current.role === 'owner') this.assertNotLastOwner(boardId);
    this.db.prepare('DELETE FROM board_members WHERE board_id = ? AND user_id = ?').run(boardId, userId);
    this.activity.record(boardId, actor.id, 'member_removed', { userId });
    this.audit.log('member_removed', { userId: actor.id, meta: { boardId, targetUserId: userId } });
    return this.members(boardId);
  }

  private assertNotLastOwner(boardId: string): void {
    const n = (this.db.prepare("SELECT COUNT(*) AS n FROM board_members WHERE board_id = ? AND role = 'owner'").get(boardId) as { n: number }).n;
    if (n <= 1) throw badRequest('ללוח חייב להיות לפחות בעלים אחד');
  }

  // ---------------------------------------------------------------- groups
  groups(boardId: string): Group[] {
    return (this.db.prepare('SELECT * FROM board_groups WHERE board_id = ? ORDER BY position').all(boardId) as GroupRow[]).map(toGroup);
  }

  createGroup(actor: Actor, boardId: string, input: { name: string; color?: string }): Group {
    this.access.requireBoard(actor, boardId, 'editor');
    const max = (this.db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM board_groups WHERE board_id = ?').get(boardId) as { p: number }).p;
    const id = newId();
    const color = (input.color ?? COLOR_KEYS[(max + 1 + COLOR_KEYS.length) % COLOR_KEYS.length]) as ColorKey;
    this.db.prepare('INSERT INTO board_groups (id, board_id, name, color, position) VALUES (?, ?, ?, ?, ?)').run(id, boardId, input.name, color, max + 1);
    this.activity.record(boardId, actor.id, 'group_created', { name: input.name });
    this.touch(boardId);
    return toGroup(this.db.prepare('SELECT * FROM board_groups WHERE id = ?').get(id) as GroupRow);
  }

  updateGroup(actor: Actor, groupId: string, input: { name?: string; color?: string; position?: number }): Group {
    const boardId = this.access.boardIdForGroup(groupId);
    this.access.requireBoard(actor, boardId, 'editor');
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(input)) {
      if (v === undefined) continue;
      sets.push(`${k === 'position' ? 'position' : k === 'color' ? 'color' : 'name'} = ?`);
      params.push(v);
    }
    this.db.prepare(`UPDATE board_groups SET ${sets.join(', ')} WHERE id = ?`).run(...params, groupId);
    this.activity.record(boardId, actor.id, 'group_updated', { groupId, fields: Object.keys(input) });
    this.touch(boardId);
    return toGroup(this.db.prepare('SELECT * FROM board_groups WHERE id = ?').get(groupId) as GroupRow);
  }

  /** Deleting a group deletes its items — owner only. */
  deleteGroup(actor: Actor, groupId: string): void {
    const boardId = this.access.boardIdForGroup(groupId);
    this.access.requireBoard(actor, boardId, 'owner');
    const n = (this.db.prepare('SELECT COUNT(*) AS n FROM board_groups WHERE board_id = ?').get(boardId) as { n: number }).n;
    if (n <= 1) throw badRequest('לא ניתן למחוק את הקבוצה האחרונה בלוח');
    const g = this.db.prepare('SELECT name FROM board_groups WHERE id = ?').get(groupId) as { name: string };
    this.db.prepare('DELETE FROM board_groups WHERE id = ?').run(groupId);
    this.activity.record(boardId, actor.id, 'group_deleted', { name: g.name });
    this.touch(boardId);
  }

  // ---------------------------------------------------------------- columns
  columns(boardId: string): Column[] {
    return (this.db.prepare('SELECT * FROM board_columns WHERE board_id = ? ORDER BY position').all(boardId) as ColumnRow[]).map(toColumn);
  }

  private normalizeSettings(type: ColumnType, settings: ColumnSettings | undefined): ColumnSettings {
    const s: ColumnSettings = {};
    if (type === 'status') {
      s.options = settings?.options?.length ? settings.options : [{ id: 'default', label: 'חדש', color: 'gray' }];
    } else if (type === 'tags') {
      s.options = settings?.options ?? [];
    } else if (settings?.options) {
      throw badRequest('תוויות מותרות רק בעמודות סטטוס ותגיות');
    }
    if (settings?.prefix !== undefined) {
      if (type !== 'auto_id') throw badRequest('תחילית מותרת רק בעמודת מזהה רץ');
      if (settings.prefix) s.prefix = settings.prefix;
    }
    if (settings?.role === 'due') {
      if (type !== 'date') throw badRequest('רק עמודת תאריך יכולה לשמש כתאריך יעד');
      s.role = 'due';
    }
    return s;
  }

  /** Only one "due" column per board: setting a new one clears the flag elsewhere. */
  private clearOtherDueColumns(boardId: string, exceptId: string): void {
    for (const c of this.columns(boardId)) {
      if (c.id !== exceptId && c.settings.role === 'due') {
        const { role: _role, ...rest } = c.settings;
        this.db.prepare('UPDATE board_columns SET settings = ? WHERE id = ?').run(JSON.stringify(rest), c.id);
      }
    }
  }

  createColumn(actor: Actor, boardId: string, input: CreateColumnInput): Column {
    this.access.requireBoard(actor, boardId, 'owner');
    const count = (this.db.prepare('SELECT COUNT(*) AS n FROM board_columns WHERE board_id = ?').get(boardId) as { n: number }).n;
    if (count >= LIMITS.columnsPerBoard) throw badRequest(`עד ${LIMITS.columnsPerBoard} עמודות בלוח`);
    const settings = this.normalizeSettings(input.type, input.settings);
    const max = (this.db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM board_columns WHERE board_id = ?').get(boardId) as { p: number }).p;
    const id = newId();
    this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO board_columns (id, board_id, title, type, settings, position) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, boardId, input.title, input.type, JSON.stringify(settings), max + 1);
      if (settings.role === 'due') this.clearOtherDueColumns(boardId, id);
      this.activity.record(boardId, actor.id, 'column_created', { title: input.title, type: input.type });
      this.touch(boardId);
    })();
    return toColumn(this.db.prepare('SELECT * FROM board_columns WHERE id = ?').get(id) as ColumnRow);
  }

  updateColumn(actor: Actor, columnId: string, input: UpdateColumnInput): Column {
    const boardId = this.access.boardIdForColumn(columnId);
    this.access.requireBoard(actor, boardId, 'owner');
    const col = toColumn(this.db.prepare('SELECT * FROM board_columns WHERE id = ?').get(columnId) as ColumnRow);

    this.db.transaction(() => {
      if (input.title !== undefined) this.db.prepare('UPDATE board_columns SET title = ? WHERE id = ?').run(input.title, columnId);
      if (input.position !== undefined) this.db.prepare('UPDATE board_columns SET position = ? WHERE id = ?').run(input.position, columnId);
      if (input.settings !== undefined) {
        const settings = this.normalizeSettings(col.type, input.settings);
        this.db.prepare('UPDATE board_columns SET settings = ? WHERE id = ?').run(JSON.stringify(settings), columnId);
        if (settings.role === 'due') this.clearOtherDueColumns(boardId, columnId);
        // Clear cell values that point to status options which no longer exist.
        if (col.type === 'status' || col.type === 'tags') {
          const valid = new Set(settings.options?.map((o) => o.id));
          this.rewriteColumnValues(boardId, columnId, (v) => {
            if (typeof v === 'string') return valid.has(v) ? v : undefined;
            if (Array.isArray(v)) {
              const kept = (v as string[]).filter((id) => valid.has(id));
              return kept.length ? kept : undefined;
            }
            return v;
          });
        }
      }
      this.activity.record(boardId, actor.id, 'column_updated', { columnId, title: input.title ?? col.title });
      this.touch(boardId);
    })();
    return toColumn(this.db.prepare('SELECT * FROM board_columns WHERE id = ?').get(columnId) as ColumnRow);
  }

  deleteColumn(actor: Actor, columnId: string): void {
    const boardId = this.access.boardIdForColumn(columnId);
    this.access.requireBoard(actor, boardId, 'owner');
    const col = this.db.prepare('SELECT title FROM board_columns WHERE id = ?').get(columnId) as { title: string };
    this.db.transaction(() => {
      this.rewriteColumnValues(boardId, columnId, () => undefined);
      this.db.prepare('DELETE FROM board_columns WHERE id = ?').run(columnId);
      this.activity.record(boardId, actor.id, 'column_deleted', { title: col.title });
      this.touch(boardId);
    })();
  }

  /** Apply a transform to one column's value in every item of a board (undefined removes the key). */
  private rewriteColumnValues(boardId: string, columnId: string, fn: (v: unknown) => unknown): void {
    const rows = this.db.prepare('SELECT * FROM items WHERE board_id = ?').all(boardId) as ItemRow[];
    const upd = this.db.prepare('UPDATE items SET cell_values = ? WHERE id = ?');
    for (const r of rows) {
      const item = toItem(r);
      if (!(columnId in item.values)) continue;
      const next = fn(item.values[columnId]);
      const values = { ...item.values };
      if (next === undefined) delete values[columnId];
      else values[columnId] = next as never;
      upd.run(JSON.stringify(values), r.id);
    }
  }
}
