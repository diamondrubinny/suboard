import { evaluateFormula, todayIso, mapFormulaRefs, validateFormula, BUTTON_ACTIONS, type ButtonAction, type Item, findPrimaryStatusColumn, isItemDone, type LinkStat,
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
import { formatCell } from './export.js';
import { toColumn, toGroup, toItem, type ColumnRow, type GroupRow, type ItemRow } from './mappers.js';
import { getTemplate } from './templates.js';
import type { TemplateStructure } from './boardTemplates.js';

interface BoardRow {
  id: string;
  name: string;
  description: string;
  template_key: string;
  item_term: string;
  workspace_id: string | null;
  folder_id: string | null;
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

  /** Optional modules add their own per-item data to the board payload (e.g. time totals). */
  private readonly extensions: ((actor: Actor, boardId: string, columns: Column[]) => Partial<BoardDetail>)[] = [];
  extend(fn: (actor: Actor, boardId: string, columns: Column[]) => Partial<BoardDetail>): void {
    this.extensions.push(fn);
  }

  // ---------------------------------------------------------------- boards
  list(actor: Actor): BoardSummary[] {
    const rows = (
      actor.role === 'admin'
        ? this.db
            .prepare(
              `SELECT b.*, COALESCE(m.role, 'owner') AS my_role,
                 (SELECT COUNT(*) FROM items i WHERE i.board_id = b.id AND i.deleted_at IS NULL AND i.parent_id IS NULL) AS item_count,
                 EXISTS (SELECT 1 FROM board_favorites f WHERE f.board_id = b.id AND f.user_id = ?) AS fav
               FROM boards b LEFT JOIN board_members m ON m.board_id = b.id AND m.user_id = ?
               WHERE b.archived_at IS NULL ORDER BY b.updated_at DESC`,
            )
            .all(actor.id, actor.id)
        : this.db
            .prepare(
              `SELECT b.*, m.role AS my_role,
                 (SELECT COUNT(*) FROM items i WHERE i.board_id = b.id AND i.deleted_at IS NULL AND i.parent_id IS NULL) AS item_count,
                 EXISTS (SELECT 1 FROM board_favorites f WHERE f.board_id = b.id AND f.user_id = ?) AS fav
               FROM boards b JOIN board_members m ON m.board_id = b.id AND m.user_id = ?
               WHERE b.archived_at IS NULL ORDER BY b.updated_at DESC`,
            )
            .all(actor.id, actor.id)
    ) as (BoardRow & { my_role: BoardRole; item_count: number; fav: number })[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      workspaceId: r.workspace_id ?? null,
      folderId: r.workspace_id ? (r.folder_id ?? null) : null,
      templateKey: r.template_key,
      // Admins have owner-level rights on every board regardless of membership row.
      myRole: actor.role === 'admin' ? 'owner' : r.my_role,
      itemCount: r.item_count,
      updatedAt: r.updated_at,
      favorite: r.fav === 1,
    }));
  }

  /**
   * New board from a built-in template, or — with `customTemplateId` and a resolver — from an
   * organisation template (its structure; the board keeps the original built-in template key).
   */
  create(
    actor: Actor,
    input: { name: string; description?: string; templateKey: string; customTemplateId?: string; workspaceId?: string },
    resolveCustom?: (id: string) => TemplateStructure,
  ): BoardDetail {
    if (actor.role === 'member') throw forbidden('רק מנהלים יכולים ליצור לוחות');
    const custom = input.customTemplateId && resolveCustom ? resolveCustom(input.customTemplateId) : null;
    const builtIn = getTemplate(custom ? custom.baseKey : input.templateKey);
    if (!builtIn) throw badRequest('תבנית לא קיימת', { templateKey: 'תבנית לא קיימת' });
    const template = custom ? { key: builtIn.key, groups: custom.groups, columns: custom.columns } : builtIn;

    // An unknown workspace is ignored rather than failing the creation.
    const workspaceId = input.workspaceId && this.db.prepare('SELECT 1 FROM workspaces WHERE id = ?').get(input.workspaceId) ? input.workspaceId : null;
    const id = newId();
    const ts = nowIso();
    this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO boards (id, name, description, template_key, created_by, created_at, updated_at, workspace_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, input.name, input.description ?? '', template.key, actor.id, ts, ts, workspaceId);
      this.db.prepare("INSERT INTO board_members (board_id, user_id, role) VALUES (?, ?, 'owner')").run(id, actor.id);
      template.groups.forEach((g, i) => {
        this.db.prepare('INSERT INTO board_groups (id, board_id, name, color, position) VALUES (?, ?, ?, ?, ?)').run(newId(), id, g.name, g.color, i);
      });
      // Formulas in a template point at columns by position ({#n}); here they get the new column ids.
      const columnIds = template.columns.map(() => newId());
      template.columns.forEach((c, i) => {
        const settings: ColumnSettings = { ...(c.settings ?? {}) };
        if (c.type === 'formula' && settings.formula) {
          settings.formula = mapFormulaRefs(settings.formula, (ref) => (/^#\d+$/.test(ref) ? (columnIds[Number(ref.slice(1))] ?? null) : null)).formula;
        }
        if (c.type === 'mirror' && settings.mirror && /^#\d+$/.test(settings.mirror.relationColumnId)) {
          settings.mirror = { ...settings.mirror, relationColumnId: columnIds[Number(settings.mirror.relationColumnId.slice(1))] ?? settings.mirror.relationColumnId };
        }
        this.db
          .prepare('INSERT INTO board_columns (id, board_id, title, type, settings, position) VALUES (?, ?, ?, ?, ?, ?)')
          .run(columnIds[i], id, c.title, c.type, JSON.stringify(settings), i);
      });
      this.activity.record(id, actor.id, 'board_created', { name: input.name, template: template.key, ...(custom ? { customTemplate: true } : {}) });
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
      itemTerm: b.item_term ?? '',
      workspaceId: b.workspace_id ?? null,
      folderId: b.workspace_id ? (b.folder_id ?? null) : null,
      groups: this.groups(boardId),
      columns: this.columns(boardId),
      items: (this.db.prepare('SELECT * FROM items WHERE board_id = ? AND deleted_at IS NULL ORDER BY position, created_at').all(boardId) as ItemRow[]).map(toItem),
      members: this.members(boardId),
      createdAt: b.created_at,
      updatedAt: b.updated_at,
      ...(this.columns(boardId).some((c) => c.type === 'linked') ? { linkStats: this.linkStats(actor, boardId) } : {}),
      ...this.relationData(actor, boardId),
      ...(this.columns(boardId).some((c) => c.type === 'files') ? { fileCounts: this.fileCounts(boardId) } : {}),
      ...Object.assign({}, ...this.extensions.map((f) => f(actor, boardId, this.columns(boardId)))),
      favorite: this.db.prepare('SELECT 1 FROM board_favorites WHERE user_id = ? AND board_id = ?').get(actor.id, boardId) !== undefined,
    };
  }

  /** Attached files per item (files found infected are not counted). */
  fileCounts(boardId: string): Record<string, number> {
    const rows = this.db
      .prepare("SELECT a.item_id, COUNT(*) AS n FROM attachments a JOIN items i ON i.id = a.item_id AND i.deleted_at IS NULL WHERE a.board_id = ? AND a.status <> 'infected' GROUP BY a.item_id")
      .all(boardId) as { item_id: string; n: number }[];
    return Object.fromEntries(rows.map((r) => [r.item_id, r.n]));
  }

  /**
   * Relation and mirror columns of a board. Connected items on boards the actor cannot see are left
   * out entirely (no name, no mirrored value).
   */
  relationData(actor: Actor, boardId: string): Pick<BoardDetail, 'relations' | 'mirrors' | 'mirrorSums'> {
    const columns = this.columns(boardId);
    const relCols = columns.filter((c) => c.type === 'relation' && c.settings.relation);
    if (!relCols.length) return {};
    const visible = new Map(relCols.map((c) => [c.id, this.access.boardRole(actor, c.settings.relation!.boardId) !== null]));
    const rows = this.db
      .prepare(
        `SELECT l.from_item, l.column_id, o.*
         FROM item_links l
         JOIN items me ON me.id = l.from_item AND me.board_id = ? AND me.deleted_at IS NULL
         JOIN items o ON o.id = l.to_item AND o.deleted_at IS NULL
         JOIN boards b ON b.id = o.board_id AND b.archived_at IS NULL
         WHERE l.kind = 'related' AND l.column_id IS NOT NULL
         ORDER BY l.created_at`,
      )
      .all(boardId) as (ItemRow & { from_item: string; column_id: string })[];
    const relations: NonNullable<BoardDetail['relations']> = {};
    const targets = new Map<string, Map<string, Item[]>>(); // column → item → connected items
    for (const r of rows) {
      const col = relCols.find((c) => c.id === r.column_id);
      if (!col || !visible.get(col.id) || r.board_id !== col.settings.relation!.boardId) continue;
      const other = toItem(r);
      ((relations[r.from_item] ??= {})[col.id] ??= []).push({ id: other.id, name: other.name, boardId: r.board_id });
      const byItem = targets.get(col.id) ?? targets.set(col.id, new Map()).get(col.id)!;
      (byItem.get(r.from_item) ?? byItem.set(r.from_item, []).get(r.from_item)!).push(other);
    }
    const mirrorCols = columns.filter((c) => c.type === 'mirror' && c.settings.mirror);
    if (!mirrorCols.length) return { relations };
    const users = new Map((this.db.prepare('SELECT id, name FROM users').all() as { id: string; name: string }[]).map((u) => [u.id, u.name]));
    const mirrors: NonNullable<BoardDetail['mirrors']> = {};
    const mirrorSums: NonNullable<BoardDetail['mirrorSums']> = {};
    const today = todayIso();
    for (const mc of mirrorCols) {
      const rel = relCols.find((c) => c.id === mc.settings.mirror!.relationColumnId);
      if (!rel || !visible.get(rel.id)) continue;
      const targetCols = this.columns(rel.settings.relation!.boardId);
      const tc = targetCols.find((c) => c.id === mc.settings.mirror!.targetColumnId);
      if (!tc) continue;
      for (const [itemId, list] of targets.get(rel.id) ?? []) {
        const texts = list.map((o) => formatCell(tc, o.values[tc.id], o, users, targetCols)).filter(Boolean);
        if (texts.length) (mirrors[itemId] ??= {})[mc.id] = texts;
        // Numbers are also summed, so the board can total a mirrored amount.
        if (!['number', 'progress', 'rating', 'formula'].includes(tc.type)) continue;
        const nums = list.map((o) => (tc.type === 'formula' ? evaluateFormula(tc, o, targetCols, today) : o.values[tc.id])).filter((v): v is number => typeof v === 'number');
        if (nums.length) (mirrorSums[itemId] ??= {})[mc.id] = nums.reduce((a, b) => a + b, 0);
      }
    }
    return { relations, mirrors, mirrorSums };
  }

  /**
   * Per item of the board: how many linked items there are and how many are done. Only items on
   * boards the actor may see are counted, so the numbers reveal nothing about other boards.
   */
  linkStats(actor: Actor, boardId: string): Record<string, LinkStat> {
    const rows = this.db
      .prepare(
        `SELECT me.id AS item_id, o.*
         FROM items me
         JOIN item_links l ON l.from_item = me.id OR l.to_item = me.id
         JOIN items o ON o.id = CASE WHEN l.from_item = me.id THEN l.to_item ELSE l.from_item END
         JOIN boards b ON b.id = o.board_id
         WHERE me.board_id = ? AND me.deleted_at IS NULL AND o.deleted_at IS NULL AND b.archived_at IS NULL`,
      )
      .all(boardId) as (ItemRow & { item_id: string })[];
    const visible = new Map<string, boolean>();
    const statusOf = new Map<string, Column | undefined>();
    const out: Record<string, LinkStat> = {};
    for (const r of rows) {
      if (!visible.has(r.board_id)) visible.set(r.board_id, this.access.boardRole(actor, r.board_id) !== null);
      if (!visible.get(r.board_id)) continue;
      if (!statusOf.has(r.board_id)) statusOf.set(r.board_id, findPrimaryStatusColumn(this.columns(r.board_id)));
      const s = (out[r.item_id] ??= { total: 0, done: 0 });
      s.total++;
      if (isItemDone(toItem(r), statusOf.get(r.board_id))) s.done++;
    }
    return out;
  }

  update(actor: Actor, boardId: string, input: { name?: string; description?: string; itemTerm?: string }): BoardDetail {
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
    if (input.itemTerm !== undefined) {
      sets.push('item_term = ?');
      params.push(input.itemTerm);
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

  private normalizeSettings(type: ColumnType, settings: ColumnSettings | undefined, actor?: Actor, boardId?: string): ColumnSettings {
    const s: ColumnSettings = {};
    if (type === 'checklist') {
      const cl = settings?.checklist ?? { items: [{ id: 'item1', label: 'סעיף 1' }] };
      if (cl.capaBoardId) {
        // The owner wiring a checklist to a corrective-action board must be able to edit that board,
        // because failed items will be created there on their behalf.
        if (!actor) throw badRequest('לוח יעד לא תקין');
        if (cl.capaBoardId === boardId) throw badRequest('לוח הפעולות המתקנות חייב להיות לוח אחר');
        const role = this.access.boardRole(actor, cl.capaBoardId);
        if (!role || role === 'viewer') throw badRequest('יש לבחור לוח פעולות מתקנות שבו יש לך הרשאת עריכה', { capaBoardId: 'אין הרשאה' });
        const groups = this.db.prepare('SELECT id FROM board_groups WHERE board_id = ? ORDER BY position').all(cl.capaBoardId) as { id: string }[];
        if (cl.capaGroupId && !groups.some((g) => g.id === cl.capaGroupId)) throw badRequest('הקבוצה אינה שייכת ללוח היעד', { capaGroupId: 'קבוצה לא תקינה' });
        s.checklist = { items: cl.items, capaBoardId: cl.capaBoardId, capaGroupId: cl.capaGroupId ?? groups[0]?.id ?? null };
      } else {
        s.checklist = { items: cl.items, capaBoardId: null, capaGroupId: null };
      }
    } else if (settings?.checklist) {
      throw badRequest('סעיפי בדיקה מותרים רק בעמודת צ\'קליסט');
    }
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
    if (type === 'relation') {
      const target = settings?.relation?.boardId;
      if (!target) throw badRequest('יש לבחור לוח לחיבור', { relation: 'יש לבחור לוח' });
      // Like wiring a checklist to another board: the owner must be able to see the board they connect.
      if (actor && !this.access.boardRole(actor, target)) throw badRequest('יש לבחור לוח שיש לך גישה אליו', { relation: 'אין גישה ללוח' });
      s.relation = { boardId: target };
    } else if (settings?.relation) {
      throw badRequest('לוח מחובר מותר רק בעמודת חיבור');
    }
    if (type === 'mirror') {
      const m = settings?.mirror;
      if (!m) throw badRequest('יש לבחור עמודת חיבור ועמודה להצגה', { mirror: 'חסרות הגדרות' });
      if (boardId && !/^#\d+$/.test(m.relationColumnId)) {
        const rel = this.columns(boardId).find((c) => c.id === m.relationColumnId);
        if (!rel || rel.type !== 'relation' || !rel.settings.relation) throw badRequest('יש לבחור עמודת חיבור של הלוח הזה', { mirror: 'עמודת חיבור לא תקינה' });
        const target = this.columns(rel.settings.relation.boardId).find((c) => c.id === m.targetColumnId);
        if (m.targetColumnId !== '' && (!target || ['relation', 'mirror', 'linked', 'checklist'].includes(target.type))) {
          throw badRequest('אי אפשר להציג את העמודה הזו כמראה', { mirror: 'עמודה לא תקינה' });
        }
      }
      s.mirror = { relationColumnId: m.relationColumnId, targetColumnId: m.targetColumnId };
    } else if (settings?.mirror) {
      throw badRequest('הגדרות מראה מותרות רק בעמודת מראה');
    }
    if (type === 'formula') {
      const formula = settings?.formula?.trim();
      if (!formula) throw badRequest('יש להזין נוסחה', { formula: 'יש להזין נוסחה' });
      const problem = boardId ? validateFormula(formula, this.columns(boardId)) : null;
      if (problem) throw badRequest(problem, { formula: problem });
      s.formula = formula;
    } else if (settings?.formula !== undefined) {
      throw badRequest('נוסחה מותרת רק בעמודת נוסחה');
    }
    if (settings?.role === 'due') {
      if (type !== 'date') throw badRequest('רק עמודת תאריך יכולה לשמש כתאריך יעד');
      s.role = 'due';
    }
    if (settings?.editBy === 'owners') s.editBy = 'owners';
    if (settings?.description) s.description = settings.description;
    if (settings?.unit !== undefined || settings?.decimals !== undefined) {
      if (type !== 'number' && type !== 'formula') throw badRequest('יחידה ומספר ספרות אחרי הנקודה מותרים רק בעמודת מספר או נוסחה');
      if (settings.unit) s.unit = settings.unit;
      if (typeof settings.decimals === 'number') s.decimals = settings.decimals;
    }
    if (settings?.button) {
      if (type !== 'button') throw badRequest('הגדרות כפתור מותרות רק בעמודת כפתור');
      // Every action points at something of this same board: a column of the right type, or a group.
      const b = settings.button;
      const action: ButtonAction = b.action ?? 'set_status';
      const need = BUTTON_ACTIONS[action].columnType;
      if (boardId) {
        if (need) {
          const target = this.columns(boardId).find((c) => c.id === b.columnId);
          if (!target || target.type !== need) throw badRequest('יש לבחור עמודה מתאימה לפעולה', { button: 'עמודה לא תקינה' });
          if (action === 'set_status' && !target.settings.options?.some((o) => o.id === b.optionId)) throw badRequest('יש לבחור עמודת סטטוס ותווית קיימות', { button: 'יעד לא תקין' });
        } else if (!this.groups(boardId).some((g) => g.id === b.groupId)) {
          throw badRequest('יש לבחור קבוצה של הלוח', { button: 'קבוצה לא תקינה' });
        }
      }
      s.button = { label: b.label, action, ...(need ? { columnId: b.columnId } : { groupId: b.groupId }), ...(action === 'set_status' ? { optionId: b.optionId } : {}) };
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
    const settings = this.normalizeSettings(input.type, input.settings, actor, boardId);
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
        // A settings update changes what it names and keeps the rest: saving the labels must not drop
        // the lock, the description or the unit. (To clear: an empty description / unit, decimals null, editBy 'editors'.)
        const settings = this.normalizeSettings(col.type, { ...col.settings, ...input.settings }, actor, boardId);
        this.db.prepare('UPDATE board_columns SET settings = ? WHERE id = ?').run(JSON.stringify(settings), columnId);
        if (settings.role === 'due') this.clearOtherDueColumns(boardId, columnId);
        // Connecting the column to a different board: the old connections point to the old board and
        // cannot stay. Nothing is removed without an explicit confirmation, and mirrors must go first.
        if (col.type === 'relation' && col.settings.relation && settings.relation && settings.relation.boardId !== col.settings.relation.boardId) {
          const mirrors = this.columns(boardId).filter((c) => c.type === 'mirror' && c.settings.mirror?.relationColumnId === columnId);
          if (mirrors.length) throw badRequest(`עמודות מראה מציגות ערכים דרך החיבור הזה (${mirrors.map((m) => `"${m.title}"`).join(', ')}). יש למחוק אותן לפני שינוי הלוח המחובר.`, { relation: 'יש עמודות מראה תלויות' });
          const n = (this.db.prepare("SELECT COUNT(*) AS n FROM item_links WHERE kind = 'related' AND column_id = ?").get(columnId) as { n: number }).n;
          if (n > 0 && input.clearLinks !== true) throw badRequest(`בעמודה יש ${n} חיבורים ללוח הנוכחי. שינוי הלוח ינתק אותם — יש לאשר זאת.`, { clearLinks: 'נדרש אישור' });
          this.db.prepare("DELETE FROM item_links WHERE kind = 'related' AND column_id = ?").run(columnId);
        }
        // Clear cell values that point to status options which no longer exist.
        if (col.type === 'status' || col.type === 'tags') {
          const valid = new Set(settings.options?.map((o) => o.id));
          // Labels that disappear while items still use them: the caller must say where those items go
          // (another label, or cleared on purpose). Nothing is ever dropped silently.
          const usage = new Map<string, number>();
          for (const r of this.db.prepare('SELECT cell_values FROM items WHERE board_id = ? AND deleted_at IS NULL').all(boardId) as { cell_values: string }[]) {
            const v = (JSON.parse(r.cell_values) as Record<string, unknown>)[columnId];
            for (const id of Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []) if (!valid.has(id)) usage.set(id, (usage.get(id) ?? 0) + 1);
          }
          const plan = input.replaceOptions ?? {};
          for (const [id, n] of usage) {
            const label = col.settings.options?.find((o) => o.id === id)?.label ?? id;
            if (!(id in plan)) throw badRequest(`התווית "${label}" בשימוש ב-${n} פריטים. יש לבחור לאיזו תווית להעביר אותם, או לאשר ניקוי.`, { replaceOptions: `התווית "${label}" בשימוש` });
            const to = plan[id];
            if (to !== null && to !== undefined && !valid.has(to)) throw badRequest('תווית היעד אינה קיימת בעמודה', { replaceOptions: 'תווית יעד לא תקינה' });
          }
          const move = (id: string): string | undefined => (valid.has(id) ? id : (plan[id] ?? undefined));
          this.rewriteColumnValues(boardId, columnId, (v) => {
            if (typeof v === 'string') return move(v);
            if (Array.isArray(v)) {
              const kept = [...new Set((v as string[]).map(move).filter((id): id is string => Boolean(id)))];
              return kept.length ? kept : undefined;
            }
            return v;
          });
        }
        // Drop results for checklist entries that were removed (corrective-action links stay in item_links).
        if (col.type === 'checklist') {
          const valid = new Set(settings.checklist?.items.map((i) => i.id));
          this.rewriteColumnValues(boardId, columnId, (v) => {
            if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
            const kept = Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => valid.has(k)));
            return Object.keys(kept).length ? kept : undefined;
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
