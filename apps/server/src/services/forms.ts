import {
  COLOR_KEYS,
  FORM_FIELD_TYPES,
  QUESTION_TYPES,
  quickFormSchema,
  findPrimaryStatusColumn,
  formatAutoId,
  isItemDone,
  LIMITS,
  MEMBER_FORM_FIELD_TYPES,
  type Attachment,
  type BoardForm,
  type ColumnType,
  type FormField,
  type FormForFill,
  type MySubmission,
} from '@suboard/shared';
import { nowIso, parseJson, type DB } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import type { z } from 'zod';
import { badRequest, forbidden, notFound } from '../lib/errors.js';

type QuickFormOutput = z.output<typeof quickFormSchema>;
import type { AccessService, Actor } from './access.js';
import type { ActivityService } from './activity.js';
import type { AttachmentService } from './attachments.js';
import type { BoardService } from './boards.js';
import type { ItemService } from './items.js';
import { toItem, type ItemRow } from './mappers.js';

interface FormConfig {
  description: string;
  groupId: string;
  nameLabel: string;
  fields: FormField[];
  audience: 'members' | 'all_users';
  allowPhotos: boolean;
}
interface FormRow {
  id: string;
  board_id: string;
  board_name: string;
  name: string;
  config: string;
  enabled: number;
  created_by_name: string | null;
  submissions: number;
}
type FormInput = Omit<FormConfig, 'fields'> & { name: string; enabled: boolean; fields: FormField[] };

/**
 * Internal forms (sign-in required). A form creates an item on its board. "all_users" forms let any
 * signed-in user report (e.g. a near miss) without seeing the board; they never include person,
 * checklist or computed columns. Reporters see only their own submissions.
 */
export class FormService {
  constructor(
    private readonly db: DB,
    private readonly access: AccessService,
    private readonly boards: BoardService,
    private readonly items: ItemService,
    private readonly attachments: AttachmentService,
    private readonly activity: ActivityService,
  ) {}

  private select(where: string) {
    return `SELECT f.*, b.name AS board_name, u.name AS created_by_name,
              (SELECT COUNT(*) FROM items i WHERE i.form_id = f.id AND i.deleted_at IS NULL) AS submissions
            FROM forms f JOIN boards b ON b.id = f.board_id LEFT JOIN users u ON u.id = f.created_by
            WHERE ${where}`;
  }

  private toForm(r: FormRow): BoardForm {
    const c = parseJson<FormConfig>(r.config, { description: '', groupId: '', nameLabel: 'כותרת', fields: [], audience: 'members', allowPhotos: false });
    return {
      id: r.id,
      boardId: r.board_id,
      boardName: r.board_name,
      name: r.name,
      description: c.description,
      groupId: c.groupId,
      nameLabel: c.nameLabel,
      fields: c.fields,
      audience: c.audience,
      allowPhotos: c.allowPhotos,
      enabled: r.enabled === 1,
      createdByName: r.created_by_name,
      submissions: r.submissions,
    };
  }

  private row(id: string): BoardForm {
    const r = this.db.prepare(this.select('f.id = ? AND b.archived_at IS NULL')).get(id) as FormRow | undefined;
    if (!r) throw notFound('הטופס לא נמצא');
    return this.toForm(r);
  }

  private validate(boardId: string, input: Pick<FormInput, 'groupId' | 'fields' | 'audience'>): void {
    if (!this.db.prepare('SELECT 1 FROM board_groups WHERE id = ? AND board_id = ?').get(input.groupId, boardId)) {
      throw badRequest('הקבוצה אינה שייכת ללוח', { groupId: 'קבוצה לא תקינה' });
    }
    const allowed: readonly ColumnType[] = input.audience === 'all_users' ? FORM_FIELD_TYPES : MEMBER_FORM_FIELD_TYPES;
    const cols = this.boards.columns(boardId);
    for (const f of input.fields) {
      const c = cols.find((x) => x.id === f.columnId);
      if (!c) throw badRequest('עמודה לא קיימת בלוח', { fields: 'עמודה לא קיימת' });
      if (!allowed.includes(c.type)) {
        throw badRequest(
          input.audience === 'all_users' && c.type === 'person'
            ? `טופס לכל המשתמשים לא יכול לכלול את עמודת האנשים "${c.title}" (חושף את חברי הלוח)`
            : `לא ניתן לכלול את העמודה "${c.title}" בטופס`,
          { fields: 'סוג עמודה לא מותר' },
        );
      }
    }
  }

  // ---------------------------------------------------------------- management (board owner)
  listForBoard(actor: Actor, boardId: string): BoardForm[] {
    this.access.requireBoard(actor, boardId, 'owner');
    return (this.db.prepare(this.select('f.board_id = ?') + ' ORDER BY f.created_at').all(boardId) as FormRow[]).map((r) => this.toForm(r));
  }

  create(actor: Actor, boardId: string, input: FormInput): BoardForm {
    this.access.requireBoard(actor, boardId, 'owner');
    const n = (this.db.prepare('SELECT COUNT(*) AS n FROM forms WHERE board_id = ?').get(boardId) as { n: number }).n;
    if (n >= LIMITS.formsPerBoard) throw badRequest(`ניתן להגדיר עד ${LIMITS.formsPerBoard} טפסים ללוח`);
    this.validate(boardId, input);
    const id = newId();
    const ts = nowIso();
    const { name, enabled, ...config } = input;
    this.db
      .prepare('INSERT INTO forms (id, board_id, name, config, enabled, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, boardId, name, JSON.stringify(config), enabled ? 1 : 0, actor.id, ts, ts);
    this.activity.record(boardId, actor.id, 'form_created', { name });
    return this.row(id);
  }

  /**
   * Form builder: one action creates a responses board (a column per question, plus the blank
   * template's status / owner / due columns for handling), and the form itself, open to every
   * signed-in user. Rolled back as a whole if any part fails.
   */
  createQuick(actor: Actor, input: QuickFormOutput): { form: BoardForm; boardId: string } {
    if (actor.role === 'member') throw forbidden('רק מנהלים יכולים ליצור טפסים חדשים');
    let out: { form: BoardForm; boardId: string } | null = null;
    this.db.transaction(() => {
      const board = this.boards.create(actor, { name: input.name, description: input.description, templateKey: 'blank' });
      const fields: FormField[] = [];
      input.questions.forEach((q, qi) => {
        const type = QUESTION_TYPES[q.type];
        const settings =
          type === 'status' || type === 'tags'
            ? { options: (q.options ?? []).map((label, i) => ({ id: `o${qi}_${i}`, label, color: COLOR_KEYS[i % COLOR_KEYS.length]! })) }
            : undefined;
        const col = this.boards.createColumn(actor, board.id, { title: q.title, type, ...(settings ? { settings } : {}) });
        fields.push({ columnId: col.id, required: q.required, ...(q.help ? { help: q.help } : {}) });
      });
      const form = this.create(actor, board.id, {
        name: input.name,
        description: input.description,
        groupId: board.groups[0]!.id,
        nameLabel: input.nameLabel,
        fields,
        audience: 'all_users',
        allowPhotos: input.allowPhotos,
        enabled: true,
      });
      out = { form, boardId: board.id };
    })();
    return out!;
  }

  update(actor: Actor, id: string, patch: Partial<FormInput>): BoardForm {
    const cur = this.row(id);
    this.access.requireBoard(actor, cur.boardId, 'owner');
    const merged: FormInput = {
      name: patch.name ?? cur.name,
      enabled: patch.enabled ?? cur.enabled,
      description: patch.description ?? cur.description,
      groupId: patch.groupId ?? cur.groupId,
      nameLabel: patch.nameLabel ?? cur.nameLabel,
      fields: patch.fields ?? cur.fields,
      audience: patch.audience ?? cur.audience,
      allowPhotos: patch.allowPhotos ?? cur.allowPhotos,
    };
    this.validate(cur.boardId, merged);
    const { name, enabled, ...config } = merged;
    this.db.prepare('UPDATE forms SET name = ?, config = ?, enabled = ?, updated_at = ? WHERE id = ?').run(name, JSON.stringify(config), enabled ? 1 : 0, nowIso(), id);
    this.activity.record(cur.boardId, actor.id, 'form_updated', { name });
    return this.row(id);
  }

  remove(actor: Actor, id: string): void {
    const cur = this.row(id);
    this.access.requireBoard(actor, cur.boardId, 'owner');
    this.db.prepare('DELETE FROM forms WHERE id = ?').run(id); // items keep existing (form_id → NULL)
    this.activity.record(cur.boardId, actor.id, 'form_deleted', { name: cur.name });
  }

  // ---------------------------------------------------------------- filling
  /** Whether the actor may submit this form. Unknown / disabled forms read as not found. */
  private requireCanSubmit(actor: Actor, id: string): BoardForm {
    const f = this.row(id);
    if (!f.enabled) throw notFound('הטופס לא נמצא');
    if (f.audience === 'members') {
      const role = this.access.boardRole(actor, f.boardId);
      if (!role || role === 'viewer') throw notFound('הטופס לא נמצא');
    }
    return f;
  }

  /** Forms the actor can fill. */
  available(actor: Actor): BoardForm[] {
    const rows = this.db.prepare(this.select('f.enabled = 1 AND b.archived_at IS NULL') + ' ORDER BY b.name, f.name').all() as FormRow[];
    return rows
      .map((r) => this.toForm(r))
      .filter((f) => {
        if (f.audience === 'all_users') return true;
        const role = this.access.boardRole(actor, f.boardId);
        return role === 'owner' || role === 'editor';
      })
      // Reporters do not need the internals (field ids, counts) of forms they only fill.
      .map((f) => ({ ...f, fields: [], submissions: 0, createdByName: null }));
  }

  forFill(actor: Actor, id: string): FormForFill {
    const f = this.requireCanSubmit(actor, id);
    const cols = this.boards.columns(f.boardId);
    const fields = f.fields.map((x) => ({ ...x, column: cols.find((c) => c.id === x.columnId) })).filter((x): x is FormForFill['fields'][number] => Boolean(x.column));
    const needsMembers = f.audience === 'members' && fields.some((x) => x.column.type === 'person');
    const members = needsMembers
      ? (this.db.prepare('SELECT u.id, u.name FROM board_members m JOIN users u ON u.id = m.user_id WHERE m.board_id = ? AND u.is_active = 1 ORDER BY u.name').all(f.boardId) as { id: string; name: string }[])
      : [];
    return { id: f.id, name: f.name, description: f.description, boardName: f.boardName, nameLabel: f.nameLabel, allowPhotos: f.allowPhotos, fields, members };
  }

  submit(actor: Actor, id: string, input: { name: string; values: Record<string, unknown> }): { itemId: string; ref: string } {
    const f = this.requireCanSubmit(actor, id);
    const live = new Set(this.boards.columns(f.boardId).map((c) => c.id));
    const fieldIds = new Set(f.fields.filter((x) => live.has(x.columnId)).map((x) => x.columnId));
    for (const key of Object.keys(input.values)) {
      if (!fieldIds.has(key)) throw badRequest('שדה שאינו בטופס', { [key]: 'שדה לא מותר' });
    }
    for (const field of f.fields) {
      if (!field.required || !fieldIds.has(field.columnId)) continue;
      const v = input.values[field.columnId];
      if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) {
        throw badRequest(`השדה "${field.label ?? 'חובה'}" הוא חובה`, { [field.columnId]: 'שדה חובה' });
      }
    }
    if (!this.db.prepare('SELECT 1 FROM board_groups WHERE id = ? AND board_id = ?').get(f.groupId, f.boardId)) {
      throw badRequest('הטופס אינו זמין כרגע (הקבוצה נמחקה). פנו לבעלי הלוח.');
    }
    const item = this.items.createFromForm(actor, f.boardId, f.id, f.name, { groupId: f.groupId, name: input.name, values: input.values });
    return { itemId: item.id, ref: this.ref(f.boardId, item.seq) };
  }

  private ref(boardId: string, seq: number): string {
    const auto = this.boards.columns(boardId).find((c) => c.type === 'auto_id');
    return formatAutoId(seq, auto?.settings.prefix);
  }

  /** Photo for one's own fresh submission (form allows photos, within the time window, capped). */
  async uploadPhoto(actor: Actor, formId: string, itemId: string, file: { filename: string; data: Buffer }, ip: string): Promise<Attachment> {
    const f = this.requireCanSubmit(actor, formId);
    if (!f.allowPhotos) throw badRequest('הטופס אינו מאפשר צירוף תמונות');
    const r = this.db
      .prepare('SELECT created_by, created_at FROM items WHERE id = ? AND form_id = ? AND deleted_at IS NULL')
      .get(itemId, formId) as { created_by: string | null; created_at: string } | undefined;
    if (!r || r.created_by !== actor.id) throw notFound('הדיווח לא נמצא');
    if (Date.now() - Date.parse(r.created_at) > LIMITS.formPhotoMinutes * 60_000) throw badRequest('עבר הזמן לצירוף תמונות לדיווח זה');
    return this.attachments.upload(actor, itemId, file, ip, { asSubmitter: true, maxFiles: LIMITS.formPhotos });
  }

  /** The actor's own submissions — name, reference, status — never other people's. */
  mine(actor: Actor): MySubmission[] {
    const rows = this.db
      .prepare(
        `SELECT i.*, f.name AS form_name, b.name AS board_name FROM items i
         JOIN forms f ON f.id = i.form_id JOIN boards b ON b.id = i.board_id
         WHERE i.created_by = ? AND i.deleted_at IS NULL AND b.archived_at IS NULL
         ORDER BY i.created_at DESC LIMIT 100`,
      )
      .all(actor.id) as (ItemRow & { form_name: string; board_name: string })[];
    return rows.map((r) => {
      const item = toItem(r);
      const status = findPrimaryStatusColumn(this.boards.columns(r.board_id));
      const opt = status?.settings.options?.find((o) => o.id === item.values[status.id]);
      return {
        itemId: item.id,
        formName: r.form_name,
        boardName: r.board_name,
        name: item.name,
        ref: this.ref(r.board_id, item.seq),
        createdAt: item.createdAt,
        statusLabel: opt?.label ?? null,
        statusColor: opt?.color ?? null,
        done: isItemDone(item, status),
      };
    });
  }
}
