/**
 * Domain constants shared by client and server.
 * Colors are referenced by key only (never raw CSS from user input) to rule out CSS injection.
 */

export const GLOBAL_ROLES = ['admin', 'manager', 'member'] as const;
export type GlobalRole = (typeof GLOBAL_ROLES)[number];

export const BOARD_ROLES = ['owner', 'editor', 'viewer'] as const;
export type BoardRole = (typeof BOARD_ROLES)[number];

export const COLUMN_TYPES = [
  'text',
  'long_text',
  'number',
  'status',
  'tags',
  'person',
  'date',
  'date_range',
  'checkbox',
  'progress',
  'rating',
  'link',
  'email',
  'phone',
  'auto_id',
  'risk',
  'checklist',
  'created_by',
  'updated_at',
] as const;

/** Column types that hold a list of label options in their settings. */
export const OPTION_COLUMN_TYPES = ['status', 'tags'] as const;
/** Column types computed by the server (not editable by users). */
export const READONLY_COLUMN_TYPES = ['auto_id', 'created_by', 'updated_at'] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];
/** Computed from the item itself (running number, creator, last update): no stored value, never edited. */
export function isReadonlyColumnType(type: ColumnType): boolean {
  return (READONLY_COLUMN_TYPES as readonly string[]).includes(type);
}

/**
 * Status/label palette — SUBoard Spectrum design system (`label-*` tokens): bright full fills with
 * `ink` (#1D1B2E) text, white on navy. Every pair is unit-tested for WCAG AA (≥4.5:1).
 */
export const PALETTE = {
  green: { bg: '#1FBF75', fg: '#1D1B2E', label: 'ירוק' },
  teal: { bg: '#12B5B0', fg: '#1D1B2E', label: 'טורקיז' },
  blue: { bg: '#4C8DFF', fg: '#1D1B2E', label: 'כחול' },
  navy: { bg: '#3B4BBF', fg: '#FFFFFF', label: 'כחול כהה' },
  purple: { bg: '#A97BFF', fg: '#1D1B2E', label: 'סגול' },
  pink: { bg: '#FF6FB0', fg: '#1D1B2E', label: 'ורוד' },
  red: { bg: '#FF5A4F', fg: '#1D1B2E', label: 'אדום' },
  orange: { bg: '#FF8A1F', fg: '#1D1B2E', label: 'כתום' },
  amber: { bg: '#FFC83D', fg: '#1D1B2E', label: 'צהוב' },
  gray: { bg: '#9AA0B4', fg: '#1D1B2E', label: 'אפור' },
} as const;
export type ColorKey = keyof typeof PALETTE;
export const COLOR_KEYS = Object.keys(PALETTE) as ColorKey[];

export const GLOBAL_ROLE_LABELS: Record<GlobalRole, string> = {
  admin: 'מנהל מערכת',
  manager: 'מנהל',
  member: 'משתמש',
};

export const BOARD_ROLE_LABELS: Record<BoardRole, string> = {
  owner: 'בעלים',
  editor: 'עורך',
  viewer: 'צופה',
};

export const COLUMN_TYPE_LABELS: Record<ColumnType, string> = {
  text: 'טקסט',
  long_text: 'טקסט ארוך',
  number: 'מספר',
  status: 'סטטוס / תווית',
  person: 'אנשים',
  date: 'תאריך',
  checkbox: 'תיבת סימון',
  tags: 'תגיות (בחירה מרובה)',
  date_range: 'טווח תאריכים',
  progress: 'התקדמות %',
  rating: 'דירוג (1–5)',
  link: 'קישור',
  email: 'דוא"ל',
  phone: 'טלפון',
  auto_id: 'מזהה רץ',
  risk: 'מטריצת סיכון (סבירות × חומרה)',
  checklist: 'צ\'קליסט בדיקה',
  created_by: 'נוצר ע"י',
  updated_at: 'עודכן לאחרונה',
};

export const LIMITS = {
  boardName: 120,
  boardDescription: 1000,
  groupName: 80,
  columnTitle: 60,
  itemName: 300,
  text: 500,
  longText: 5000,
  updateBody: 5000,
  statusOptions: 30,
  statusLabel: 40,
  personsPerCell: 10,
  passwordMin: 12,
  passwordMax: 128,
  columnsPerBoard: 40,
  tagsPerCell: 20,
  importRows: 1000,
  bulkItems: 500,
  trashDays: 30,
  savedViewsPerUser: 30,
  searchQuery: 100,
  automationsPerBoard: 50,
  ruleConditions: 5,
  ruleActions: 5,
  ruleMessage: 200,
  recurrencesPerBoard: 100,
  reportsPerBoard: 20,
  reportRecipients: 30,
  automationRunRetentionDays: 90,
  checklistItems: 50,
  formFields: 30,
  formsPerBoard: 20,
  why: 500,
  rootCause: 2000,
  linksPerItem: 50,
  formPhotos: 5,
  formPhotoMinutes: 60,
} as const;

/** Investigation root-cause categories (wave C). */
export const CAUSE_CATEGORIES = ['people', 'equipment', 'method', 'environment', 'management', 'materials'] as const;
export type CauseCategory = (typeof CAUSE_CATEGORIES)[number];
export const CAUSE_LABELS: Record<CauseCategory, string> = {
  people: 'אדם',
  equipment: 'ציוד',
  method: 'שיטה / נוהל',
  environment: 'סביבה',
  management: 'ניהול',
  materials: 'חומרים',
};

/** Column types a form open to all signed-in users may contain (no people lists, no computed / checklist). */
export const FORM_FIELD_TYPES = ['text', 'long_text', 'number', 'status', 'tags', 'date', 'date_range', 'checkbox', 'progress', 'rating', 'link', 'email', 'phone', 'risk'] as const;
/** Additional types allowed when the form is limited to board members. */
export const MEMBER_FORM_FIELD_TYPES = [...FORM_FIELD_TYPES, 'person'] as const;

/** Fixed reaction set for updates (no free input: nothing to sanitise, no hidden messages). */
export const REACTIONS = ['👍', '✅', '👀', '❤️', '🙏'] as const;
export type Reaction = (typeof REACTIONS)[number];
export const REACTION_LABELS: Record<Reaction, string> = { '👍': 'אהבתי', '✅': 'בוצע', '👀': 'בבדיקה', '❤️': 'תודה', '🙏': 'בבקשה' };
/** Maximum number of organisation board templates. */
export const MAX_CUSTOM_TEMPLATES = 100;

/** How deep sub-items may nest below a top-level item (item → sub-item → … ). */
export const MAX_SUBITEM_DEPTH = 5;

/** Table column width bounds (px) for the resize handle. */
export const COLUMN_WIDTH = { min: 80, max: 640, step: 16 } as const;

/** How many recently opened boards are kept / shown per user. */
export const RECENT_BOARDS_KEEP = 20;
export const RECENT_BOARDS_SHOW = 8;
