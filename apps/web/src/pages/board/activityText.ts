import { formatDateHe, formatDateRangeHe, type ActivityEntry, type BoardDetail, type DirectoryUser } from '@suboard/shared';
import { personNames } from '../../components/cells/PersonPicker';

function formatValue(entry: ActivityEntry, v: unknown, board: BoardDetail, users: DirectoryUser[]): string {
  if (v === null || v === undefined || v === '') return 'ריק';
  const type = entry.detail.columnType as string | undefined;
  const column = board.columns.find((c) => c.id === entry.detail.columnId);
  switch (type) {
    case 'status':
      return column?.settings.options?.find((o) => o.id === v)?.label ?? 'תווית שנמחקה';
    case 'person':
      return Array.isArray(v) ? personNames(v as string[], users) : 'ריק';
    case 'date':
      return formatDateHe(String(v));
    case 'date_range':
      return typeof v === 'object' && v && 'from' in v ? formatDateRangeHe(v as { from: string; to: string }) : 'ריק';
    case 'tags':
      return Array.isArray(v) ? (v as string[]).map((id) => column?.settings.options?.find((o) => o.id === id)?.label ?? '').filter(Boolean).join(', ') : 'ריק';
    case 'progress':
      return `${String(v)}%`;
    case 'rating':
      return `${String(v)}/5`;
    case 'checkbox':
      return v ? 'מסומן' : 'לא מסומן';
    default:
      return String(v);
  }
}

/** Human-readable Hebrew sentence for an activity entry (gender-neutral forms). */
export function activityText(entry: ActivityEntry, board: BoardDetail, users: DirectoryUser[]): string {
  const d = entry.detail;
  const group = (id: unknown) => board.groups.find((g) => g.id === id)?.name ?? 'קבוצה שנמחקה';
  switch (entry.action) {
    case 'board_created':
      return 'יצר/ה את הלוח';
    case 'board_updated':
      return 'עדכן/ה את פרטי הלוח';
    case 'item_created':
      return `יצר/ה את הפריט "${String(d.name ?? '')}"`;
    case 'item_renamed':
      return `שינה/תה את השם מ-"${String(d.from)}" ל-"${String(d.to)}"`;
    case 'item_moved':
      return `העביר/ה מ-"${group(d.fromGroupId)}" ל-"${group(d.toGroupId)}"`;
    case 'item_value_changed':
      if (d.columnType === 'long_text') return `עדכן/ה את "${String(d.columnTitle ?? '')}"`;
      return `עדכן/ה את "${String(d.columnTitle ?? '')}": ${formatValue(entry, d.from, board, users)} ← ${formatValue(entry, d.to, board, users)}`;
    case 'item_deleted':
      return `מחק/ה את הפריט "${String(d.name ?? '')}"`;
    case 'update_added':
      return 'הוסיף/ה עדכון';
    case 'update_deleted':
      return 'מחק/ה עדכון';
    case 'group_created':
      return `הוסיף/ה קבוצה "${String(d.name ?? '')}"`;
    case 'group_updated':
      return 'עדכן/ה קבוצה';
    case 'group_deleted':
      return `מחק/ה את הקבוצה "${String(d.name ?? '')}"`;
    case 'column_created':
      return `הוסיף/ה עמודה "${String(d.title ?? '')}"`;
    case 'column_updated':
      return `עדכן/ה את העמודה "${String(d.title ?? '')}"`;
    case 'column_deleted':
      return `מחק/ה את העמודה "${String(d.title ?? '')}"`;
    case 'member_set':
      return 'עדכן/ה הרשאות חבר בלוח';
    case 'member_removed':
      return 'הסיר/ה חבר מהלוח';
    case 'item_restored':
      return `שחזר/ה את הפריט "${String(d.name ?? '')}" מסל המחזור`;
    case 'item_duplicated':
      return `שכפל/ה מהפריט "${String(d.name ?? '')}"`;
    case 'item_moved_out':
      return `העביר/ה את "${String(d.name ?? '')}" ללוח אחר`;
    case 'item_moved_in':
      return `העביר/ה את "${String(d.name ?? '')}" ללוח זה מלוח אחר`;
    case 'automation_created':
      return `יצר/ה אוטומציה "${String(d.name ?? '')}"`;
    case 'automation_updated':
      return d.enabled === false ? `השבית/ה את האוטומציה "${String(d.name ?? '')}"` : `עדכן/ה את האוטומציה "${String(d.name ?? '')}"`;
    case 'automation_deleted':
      return `מחק/ה את האוטומציה "${String(d.name ?? '')}"`;
    case 'recurrence_created':
      return `הגדיר/ה פריט חוזר "${String(d.name ?? '')}"`;
    case 'recurrence_updated':
      return `עדכן/ה את הפריט החוזר "${String(d.name ?? '')}"`;
    case 'recurrence_deleted':
      return `מחק/ה את הפריט החוזר "${String(d.name ?? '')}"`;
    case 'report_created':
      return `הגדיר/ה דוח מתוזמן "${String(d.name ?? '')}"`;
    case 'report_updated':
      return `עדכן/ה את הדוח המתוזמן "${String(d.name ?? '')}"`;
    case 'report_deleted':
      return `מחק/ה את הדוח המתוזמן "${String(d.name ?? '')}"`;
    case 'items_imported':
      return `ייבא/ה ${String(d.count ?? '')} פריטים`;
    case 'attachment_added':
      return `צירף/ה את הקובץ "${String(d.name ?? '')}"`;
    case 'attachment_removed':
      return `מחק/ה את הקובץ "${String(d.name ?? '')}"`;
    default:
      return entry.action;
  }
}

/** Who made the change: the user, or the automation / recurring item for system changes. */
export function actorLabel(entry: ActivityEntry): string {
  if (entry.userName) return entry.userName;
  if (typeof entry.detail.automation === 'string') return entry.detail.automation.startsWith('פריט חוזר') ? entry.detail.automation : `אוטומציה «${entry.detail.automation}»`;
  return 'מערכת';
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('he-IL', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Jerusalem' }).format(new Date(iso));
}
