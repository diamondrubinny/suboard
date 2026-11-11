import { mapFormulaRefs, columnSettingsSchema, COLOR_KEYS, COLUMN_TYPES, MAX_CUSTOM_TEMPLATES, type ColorKey, type ColumnSettings, type ColumnType, type CustomTemplate } from '@suboard/shared';
import { z } from 'zod';
import { nowIso, type DB } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import type { AccessService, Actor } from './access.js';
import type { AuditService } from './audit.js';
import type { BoardService } from './boards.js';
import { getTemplate } from './templates.js';

export interface TemplateStructure {
  baseKey: string;
  groups: { name: string; color: ColorKey }[];
  columns: { title: string; type: ColumnType; settings: ColumnSettings }[];
}

/** Stored JSON is re-validated on read (defence in depth: a template becomes another user's board). */
const groupsSchema = z.array(z.object({ name: z.string().min(1).max(80), color: z.enum(COLOR_KEYS as [ColorKey, ...ColorKey[]]) })).min(1).max(50);
const columnsSchema = z.array(z.object({ title: z.string().min(1).max(60), type: z.enum(COLUMN_TYPES), settings: columnSettingsSchema })).max(60);

interface Row {
  id: string;
  name: string;
  description: string;
  base_key: string;
  groups_json: string;
  columns_json: string;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
}

/**
 * Organisation board templates: the structure of an existing board (groups and columns with their
 * settings) — never items, members, files, updates or automations. Links to other boards (checklist →
 * corrective-action board) are dropped, since the next board's owner may not see that board.
 */
export class BoardTemplateService {
  constructor(
    private readonly db: DB,
    private readonly access: AccessService,
    private readonly boards: BoardService,
    private readonly audit: AuditService,
  ) {}

  private static canCreateBoards(actor: Actor): boolean {
    return actor.role === 'admin' || actor.role === 'manager';
  }

  list(actor: Actor): CustomTemplate[] {
    if (!BoardTemplateService.canCreateBoards(actor)) return [];
    const rows = this.db
      .prepare('SELECT t.*, u.name AS created_by_name FROM board_templates t LEFT JOIN users u ON u.id = t.created_by ORDER BY t.created_at DESC')
      .all() as Row[];
    return rows.map((r) => {
      const s = this.parse(r);
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        baseKey: r.base_key,
        groupCount: s?.groups.length ?? 0,
        columnCount: s?.columns.length ?? 0,
        createdBy: r.created_by,
        createdByName: r.created_by_name,
        createdAt: r.created_at,
      };
    });
  }

  private parse(r: Row): TemplateStructure | null {
    try {
      return { baseKey: getTemplate(r.base_key) ? r.base_key : 'blank', groups: groupsSchema.parse(JSON.parse(r.groups_json)), columns: columnsSchema.parse(JSON.parse(r.columns_json)) };
    } catch {
      return null;
    }
  }

  /** Structure for creating a board (callers check the right to create boards). */
  structure(id: string): TemplateStructure {
    const r = this.db.prepare('SELECT *, NULL AS created_by_name FROM board_templates WHERE id = ?').get(id) as Row | undefined;
    const s = r && this.parse(r);
    if (!s) throw badRequest('התבנית לא נמצאה', { customTemplateId: 'תבנית לא קיימת' });
    return s;
  }

  /** The portable structure of a live board (callers check access). */
  structureOfBoard(boardId: string): TemplateStructure {
    const board = this.db.prepare('SELECT template_key FROM boards WHERE id = ?').get(boardId) as { template_key: string };
    const groups = this.boards.groups(boardId).map((g) => ({ name: g.name, color: g.color }));
    const columns = this.boards.columns(boardId).map((c) => {
      const settings: ColumnSettings = { ...c.settings };
      if (settings.checklist) settings.checklist = { items: settings.checklist.items }; // drop links to other boards
      return { title: c.title, type: c.type, settings };
    });
    return BoardTemplateService.portable(columns, this.boards.columns(boardId).map((c) => c.id), groups, board.template_key);
  }

  /** Column ids mean nothing outside their board: formulas are stored by column position ({#n}). */
  private static portable(columns: TemplateStructure['columns'], ids: string[], groups: TemplateStructure['groups'], baseKey: string): TemplateStructure {
    return {
      baseKey,
      groups,
      columns: columns.map((c) =>
        c.type === 'formula' && c.settings.formula
          ? { ...c, settings: { ...c.settings, formula: mapFormulaRefs(c.settings.formula, (id) => (ids.includes(id) ? `#${ids.indexOf(id)}` : null)).formula } }
          : c,
      ),
    };
  }

  saveFromBoard(actor: Actor, boardId: string, input: { name: string; description?: string }): CustomTemplate {
    if (!BoardTemplateService.canCreateBoards(actor)) throw forbidden('רק מנהלים יכולים לשמור תבניות');
    this.access.requireBoard(actor, boardId, 'owner');
    const count = (this.db.prepare('SELECT COUNT(*) AS n FROM board_templates').get() as { n: number }).n;
    if (count >= MAX_CUSTOM_TEMPLATES) throw badRequest(`ניתן לשמור עד ${MAX_CUSTOM_TEMPLATES} תבניות; מחקו תבנית ישנה`);
    const { groups, columns, baseKey } = this.structureOfBoard(boardId);
    const id = newId();
    const ts = nowIso();
    this.db
      .prepare('INSERT INTO board_templates (id, name, description, base_key, groups_json, columns_json, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, input.name, input.description ?? '', baseKey, JSON.stringify(groups), JSON.stringify(columns), actor.id, ts);
    this.audit.log('template_created', { userId: actor.id, meta: { templateId: id, fromBoardId: boardId } });
    return this.list(actor).find((t) => t.id === id)!;
  }

  remove(actor: Actor, id: string): void {
    if (!BoardTemplateService.canCreateBoards(actor)) throw notFound('התבנית לא נמצאה');
    const r = this.db.prepare('SELECT created_by FROM board_templates WHERE id = ?').get(id) as { created_by: string | null } | undefined;
    if (!r) throw notFound('התבנית לא נמצאה');
    if (r.created_by !== actor.id && actor.role !== 'admin') throw forbidden('רק מי שיצר/ה את התבנית או מנהל מערכת יכולים למחוק אותה');
    this.db.prepare('DELETE FROM board_templates WHERE id = ?').run(id);
    this.audit.log('template_deleted', { userId: actor.id, meta: { templateId: id } });
  }
}
