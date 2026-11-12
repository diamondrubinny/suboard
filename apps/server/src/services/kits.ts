import type { BoardDetail, ColorKey, ColumnSettings, ColumnType, StatusOption } from '@suboard/shared';
import type { DB } from '../db/index.js';
import { badRequest, forbidden } from '../lib/errors.js';
import type { Actor } from './access.js';
import type { AuditService } from './audit.js';
import type { BoardService } from './boards.js';
import type { WorkspaceService } from './workspaces.js';

const opt = (id: string, label: string, color: ColorKey, done?: boolean): StatusOption => (done ? { id, label, color, done } : { id, label, color });
type Col = { title: string; type: ColumnType; settings?: ColumnSettings };

/**
 * Kits: several boards created together and wired to each other. The "maintenance and inspections"
 * kit is the unit's own way of working — equipment, the inspections done on it, and the faults found —
 * as three connected boards instead of three separate lists.
 */
export class KitService {
  constructor(
    private readonly db: DB,
    private readonly boards: BoardService,
    private readonly workspaces: WorkspaceService,
    private readonly audit: AuditService,
  ) {}

  private board(actor: Actor, name: string, term: string, workspaceId: string | undefined, groups: { name: string; color: ColorKey }[], columns: Col[]): BoardDetail {
    const b = this.boards.create(actor, { name, templateKey: 'blank', customTemplateId: 'kit', workspaceId }, () => ({
      baseKey: 'blank',
      groups,
      columns: columns.map((c) => ({ title: c.title, type: c.type, settings: c.settings ?? {} })),
    }));
    this.boards.update(actor, b.id, { itemTerm: term });
    return b;
  }

  /** Equipment ← inspections ← faults, in a workspace of their own. Returns the three boards. */
  maintenance(actor: Actor, input: { workspaceName?: string }, ip: string): { workspaceId: string | null; equipment: BoardDetail; inspections: BoardDetail; faults: BoardDetail } {
    if (actor.role === 'member') throw forbidden('רק מנהלים יכולים ליצור לוחות');
    const taken = new Set((this.db.prepare('SELECT name FROM boards WHERE archived_at IS NULL').all() as { name: string }[]).map((r) => r.name));
    // Board names are not unique, but a second kit must be told apart from the first.
    const suffix = ['ציוד', 'ביקורות', 'תקלות'].some((n) => taken.has(n)) ? ` (${new Date().getFullYear()})` : '';
    if (suffix && ['ציוד', 'ביקורות', 'תקלות'].some((n) => taken.has(n + suffix))) throw badRequest('ערכה כזו כבר קיימת. שנו את שמות הלוחות הקיימים או שכפלו אותם.');

    let workspaceId: string | undefined;
    const wsName = input.workspaceName?.trim();
    if (wsName) {
      const existing = this.workspaces.list(actor).find((w) => w.name.toLowerCase() === wsName.toLowerCase());
      workspaceId = existing ? existing.id : this.workspaces.create(actor, wsName).id;
    }

    const equipment = this.board(actor, `ציוד${suffix}`, 'פריט ציוד', workspaceId, [
      { name: 'תקין', color: 'green' },
      { name: 'בתחזוקה', color: 'orange' },
      { name: 'תקול או פסול', color: 'red' },
    ], [
      { title: 'סטטוס', type: 'status', settings: { options: [opt('ok', 'תקין', 'green', true), opt('maintenance', 'בתחזוקה', 'orange'), opt('faulty', 'תקול', 'red'), opt('retired', 'פסול', 'gray', true)] } },
      { title: 'קטגוריה', type: 'text' },
      { title: 'בניין', type: 'text' },
      { title: 'קומה', type: 'text' },
      { title: "מס' חדר", type: 'text' },
      { title: 'מיקום', type: 'text' },
      { title: 'אחראי', type: 'person' },
      { title: 'טלפון', type: 'phone' },
      { title: 'ביקורת אחרונה', type: 'date' },
      { title: 'ביקורת הבאה', type: 'date', settings: { role: 'due' } },
      { title: 'הערות', type: 'long_text' },
      { title: 'קבצים', type: 'files' },
      { title: 'ביקורות ותקלות', type: 'linked' },
    ]);

    const faults = this.board(actor, `תקלות${suffix}`, 'תקלה', workspaceId, [
      { name: 'חדש', color: 'gray' },
      { name: 'בטיפול', color: 'orange' },
      { name: 'ממתין לחלף', color: 'red' },
      { name: 'נסגר', color: 'green' },
    ], [
      { title: 'סטטוס', type: 'status', settings: { options: [opt('new', 'חדש', 'gray'), opt('working', 'בטיפול', 'orange'), opt('waiting', 'ממתין לחלף', 'red'), opt('closed', 'נסגר', 'green', true)] } },
      { title: 'עדיפות', type: 'status', settings: { options: [opt('low', 'נמוכה', 'gray'), opt('medium', 'בינונית', 'blue'), opt('high', 'גבוהה', 'orange'), opt('critical', 'קריטית', 'red')] } },
      { title: 'תיאור התקלה', type: 'long_text' },
      { title: 'תאריך פתיחה', type: 'date' },
      { title: 'אחראי טיפול', type: 'person' },
      { title: 'תאריך יעד', type: 'date', settings: { role: 'due' } },
      { title: 'תמונות', type: 'files' },
    ]);
    const faultEquipment = this.boards.createColumn(actor, faults.id, { title: 'ציוד', type: 'relation', settings: { relation: { boardId: equipment.id } } });
    const location = equipment.columns.find((c) => c.title === 'מיקום')!;
    this.boards.createColumn(actor, faults.id, { title: 'מיקום הציוד', type: 'mirror', settings: { mirror: { relationColumnId: faultEquipment.id, targetColumnId: location.id } } });

    const inspections = this.board(actor, `ביקורות${suffix}`, 'ביקורת', workspaceId, [
      { name: 'מתבצעות', color: 'blue' },
      { name: 'דורשות טיפול', color: 'red' },
      { name: 'הושלמו', color: 'green' },
    ], [
      { title: 'תוצאה', type: 'status', settings: { options: [opt('ok', 'תקין', 'green', true), opt('minor', 'ליקויים קלים', 'orange'), opt('issues', 'ליקויים', 'blue'), opt('severe', 'ליקויים חמורים', 'red')] } },
      { title: 'סוג ביקורת', type: 'status', settings: { options: [opt('quarterly', 'רבעונית', 'orange'), opt('monthly', 'חודשית', 'blue'), opt('adhoc', 'אד-הוק', 'gray')] } },
      { title: 'תאריך ביצוע', type: 'date', settings: { role: 'due' } },
      { title: 'מבצע', type: 'person' },
      { title: 'הערות', type: 'long_text' },
      { title: 'תמונות', type: 'files' },
    ]);
    const inspEquipment = this.boards.createColumn(actor, inspections.id, { title: 'ציוד', type: 'relation', settings: { relation: { boardId: equipment.id } } });
    this.boards.createColumn(actor, inspections.id, { title: 'מיקום הציוד', type: 'mirror', settings: { mirror: { relationColumnId: inspEquipment.id, targetColumnId: location.id } } });
    // A failed checklist line opens a fault on the faults board.
    this.boards.createColumn(actor, inspections.id, {
      title: 'צ\'קליסט ביקורת',
      type: 'checklist',
      settings: {
        checklist: {
          items: [
            { id: 'visual', label: 'בדיקה חזותית — אין נזק, דליפה או קורוזיה' },
            { id: 'labels', label: 'שילוט וסימון תקינים וקריאים' },
            { id: 'function', label: 'בדיקת תפקוד' },
            { id: 'access', label: 'גישה פנויה, אין חסימה' },
            { id: 'docs', label: 'תיעוד ואישורים בתוקף' },
          ],
          capaBoardId: faults.id,
          capaGroupId: faults.groups[0]!.id,
        },
      },
    });

    this.audit.log('board_created', { userId: actor.id, ip, meta: { kit: 'maintenance', boards: [equipment.id, inspections.id, faults.id] } });
    return { workspaceId: workspaceId ?? null, equipment: this.boards.get(actor, equipment.id), inspections: this.boards.get(actor, inspections.id), faults: this.boards.get(actor, faults.id) };
  }
}
