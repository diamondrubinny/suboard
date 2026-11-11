import { isReadonlyColumnType, type Item, type ItemPersonal, type ItemReminder, type ItemTemplate } from '@suboard/shared';
import { nowIso, type DB } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import type { AccessService, Actor } from './access.js';
import type { ActivityService } from './activity.js';
import type { BoardService } from './boards.js';
import type { ItemService } from './items.js';
import type { NotificationService } from './notifications.js';

const MAX_OPEN_REMINDERS = 5;
const MAX_TEMPLATES = 50;
const MAX_TEMPLATE_ITEMS = 200;

interface TemplateNode {
  name: string;
  values: Record<string, unknown>;
  children: TemplateNode[];
}

/**
 * Things a user keeps for themselves on an item — reminders and a private note (never shown to
 * anyone else, not in exports, search or history) — and the board's item templates.
 */
export class PersonalService {
  constructor(
    private readonly db: DB,
    private readonly access: AccessService,
    private readonly boards: BoardService,
    private readonly items: ItemService,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationService,
  ) {}

  private requireItem(actor: Actor, itemId: string, min: 'viewer' | 'editor' = 'viewer'): string {
    const boardId = this.access.boardIdForItem(itemId);
    this.access.requireBoard(actor, boardId, min);
    return boardId;
  }

  // ---------------------------------------------------------------- reminders + note
  personal(actor: Actor, itemId: string): ItemPersonal {
    this.requireItem(actor, itemId);
    const reminders = this.db
      .prepare('SELECT id, item_id, remind_at, note FROM item_reminders WHERE item_id = ? AND user_id = ? AND sent_at IS NULL ORDER BY remind_at')
      .all(itemId, actor.id) as { id: string; item_id: string; remind_at: string; note: string }[];
    const note = (this.db.prepare('SELECT body FROM item_notes WHERE item_id = ? AND user_id = ?').get(itemId, actor.id) as { body: string } | undefined)?.body ?? '';
    return { reminders: reminders.map((r) => ({ id: r.id, itemId: r.item_id, remindAt: r.remind_at, note: r.note })), note };
  }

  addReminder(actor: Actor, itemId: string, input: { remindAt: string; note: string }): ItemReminder {
    this.requireItem(actor, itemId);
    const at = Date.parse(input.remindAt);
    if (at <= Date.now() + 30_000) throw badRequest('מועד התזכורת צריך להיות בעתיד', { remindAt: 'מועד שעבר' });
    if (at > Date.now() + 366 * 86_400_000) throw badRequest('אפשר לקבוע תזכורת עד שנה קדימה', { remindAt: 'רחוק מדי' });
    const open = (this.db.prepare('SELECT COUNT(*) AS n FROM item_reminders WHERE item_id = ? AND user_id = ? AND sent_at IS NULL').get(itemId, actor.id) as { n: number }).n;
    if (open >= MAX_OPEN_REMINDERS) throw badRequest(`עד ${MAX_OPEN_REMINDERS} תזכורות פתוחות לפריט`);
    const id = newId();
    const remindAt = new Date(at).toISOString();
    this.db.prepare('INSERT INTO item_reminders (id, item_id, user_id, remind_at, note, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, itemId, actor.id, remindAt, input.note, nowIso());
    return { id, itemId, remindAt, note: input.note };
  }

  /** Only the owner can remove a reminder (someone else's id is "not found"). */
  removeReminder(actor: Actor, id: string): void {
    const n = this.db.prepare('DELETE FROM item_reminders WHERE id = ? AND user_id = ?').run(id, actor.id).changes;
    if (!n) throw notFound('התזכורת לא נמצאה');
  }

  setNote(actor: Actor, itemId: string, body: string): { note: string } {
    this.requireItem(actor, itemId);
    const text = body.trim();
    if (!text) this.db.prepare('DELETE FROM item_notes WHERE item_id = ? AND user_id = ?').run(itemId, actor.id);
    else
      this.db
        .prepare('INSERT INTO item_notes (item_id, user_id, body, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (item_id, user_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at')
        .run(itemId, actor.id, text, nowIso());
    return { note: text };
  }

  /** Job: deliver reminders that came due. Access is re-checked; a reminder is sent at most once. */
  runDueReminders(now: Date = new Date()): number {
    const due = this.db
      .prepare(
        `SELECT r.id, r.user_id, r.note, i.id AS item_id, i.name, i.board_id, i.deleted_at
         FROM item_reminders r JOIN items i ON i.id = r.item_id WHERE r.sent_at IS NULL AND r.remind_at <= ? ORDER BY r.remind_at LIMIT 500`,
      )
      .all(now.toISOString()) as { id: string; user_id: string; note: string; item_id: string; name: string; board_id: string; deleted_at: string | null }[];
    let sent = 0;
    for (const r of due) {
      // Claim first, so two overlapping runs never send twice.
      if (!this.db.prepare('UPDATE item_reminders SET sent_at = ? WHERE id = ? AND sent_at IS NULL').run(now.toISOString(), r.id).changes) continue;
      if (r.deleted_at || !this.notifications.usersWithAccess(r.board_id, [r.user_id]).length) continue;
      this.notifications.onReminder(r.user_id, r.board_id, r.item_id, r.name, r.note);
      sent++;
    }
    return sent;
  }

  purgeSentReminders(days = 30): number {
    return this.db.prepare('DELETE FROM item_reminders WHERE sent_at IS NOT NULL AND sent_at < ?').run(new Date(Date.now() - days * 86_400_000).toISOString()).changes;
  }

  // ---------------------------------------------------------------- item templates
  listTemplates(actor: Actor, boardId: string): ItemTemplate[] {
    this.access.requireBoard(actor, boardId, 'viewer');
    const rows = this.db
      .prepare('SELECT t.id, t.board_id, t.name, t.tree_json, t.created_by, u.name AS created_by_name FROM item_templates t LEFT JOIN users u ON u.id = t.created_by WHERE t.board_id = ? ORDER BY t.name')
      .all(boardId) as { id: string; board_id: string; name: string; tree_json: string; created_by: string | null; created_by_name: string | null }[];
    const count = (n: TemplateNode): number => 1 + n.children.reduce((s, c) => s + count(c), 0);
    return rows.map((r) => ({ id: r.id, boardId: r.board_id, name: r.name, size: count(JSON.parse(r.tree_json) as TemplateNode), createdBy: r.created_by, createdByName: r.created_by_name }));
  }

  /** Saves an item and all its sub-items as a template: names and values, without people, dates or computed columns. */
  saveTemplate(actor: Actor, itemId: string, name: string): ItemTemplate {
    const boardId = this.requireItem(actor, itemId, 'editor');
    const n = (this.db.prepare('SELECT COUNT(*) AS n FROM item_templates WHERE board_id = ?').get(boardId) as { n: number }).n;
    if (n >= MAX_TEMPLATES) throw badRequest(`עד ${MAX_TEMPLATES} תבניות פריט ללוח; מחקו תבנית ישנה`);
    const keep = new Set(
      this.boards
        .columns(boardId)
        .filter((c) => !isReadonlyColumnType(c.type) && !['person', 'date', 'date_range', 'checklist'].includes(c.type))
        .map((c) => c.id),
    );
    const all = (this.db.prepare('SELECT * FROM items WHERE board_id = ? AND deleted_at IS NULL ORDER BY position').all(boardId) as { id: string; parent_id: string | null; name: string; cell_values: string }[]).map((r) => ({
      id: r.id,
      parentId: r.parent_id,
      name: r.name,
      values: JSON.parse(r.cell_values) as Record<string, unknown>,
    }));
    let total = 0;
    const node = (id: string): TemplateNode => {
      const it = all.find((x) => x.id === id)!;
      if (++total > MAX_TEMPLATE_ITEMS) throw badRequest(`תבנית יכולה לכלול עד ${MAX_TEMPLATE_ITEMS} פריטים`);
      return { name: it.name, values: Object.fromEntries(Object.entries(it.values).filter(([k]) => keep.has(k))), children: all.filter((x) => x.parentId === id).map((c) => node(c.id)) };
    };
    const id = newId();
    this.db.prepare('INSERT INTO item_templates (id, board_id, name, tree_json, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, boardId, name, JSON.stringify(node(itemId)), actor.id, nowIso());
    this.activity.record(boardId, actor.id, 'item_template_saved', { name });
    return this.listTemplates(actor, boardId).find((t) => t.id === id)!;
  }

  /** Creates the template's item tree in a group. Values of columns that changed since are skipped, never fatal. */
  useTemplate(actor: Actor, templateId: string, groupId: string): Item {
    const t = this.db.prepare('SELECT board_id, tree_json FROM item_templates WHERE id = ?').get(templateId) as { board_id: string; tree_json: string } | undefined;
    if (!t) throw notFound('התבנית לא נמצאה');
    this.access.requireBoard(actor, t.board_id, 'editor');
    const live = new Set(this.boards.columns(t.board_id).filter((c) => !isReadonlyColumnType(c.type)).map((c) => c.id));
    let root: Item | null = null;
    this.db.transaction(() => {
      const build = (n: TemplateNode, parentId?: string): Item => {
        const values = Object.fromEntries(Object.entries(n.values).filter(([k]) => live.has(k)));
        let item: Item;
        try {
          item = this.items.create(actor, t.board_id, { groupId, name: n.name, values, ...(parentId ? { parentId } : {}) });
        } catch (err) {
          if (!Object.keys(values).length) throw err;
          item = this.items.create(actor, t.board_id, { groupId, name: n.name, ...(parentId ? { parentId } : {}) }); // a label was removed since: keep the structure
        }
        n.children.forEach((c) => build(c, item.id));
        return item;
      };
      root = build(JSON.parse(t.tree_json) as TemplateNode);
    })();
    return root!;
  }

  removeTemplate(actor: Actor, templateId: string): void {
    const t = this.db.prepare('SELECT board_id, created_by, name FROM item_templates WHERE id = ?').get(templateId) as { board_id: string; created_by: string | null; name: string } | undefined;
    if (!t) throw notFound('התבנית לא נמצאה');
    const role = this.access.requireBoard(actor, t.board_id, 'editor');
    if (t.created_by !== actor.id && role !== 'owner') throw forbidden('רק מי ששמר/ה את התבנית או בעל הלוח יכולים למחוק אותה');
    this.db.prepare('DELETE FROM item_templates WHERE id = ?').run(templateId);
    this.activity.record(t.board_id, actor.id, 'item_template_deleted', { name: t.name });
  }
}
