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
] as const;

/** Column types that hold a list of label options in their settings. */
export const OPTION_COLUMN_TYPES = ['status', 'tags'] as const;
/** Column types computed by the server (not editable by users). */
export const READONLY_COLUMN_TYPES = ['auto_id'] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];

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

// ---------------------------------------------------------------- wave E: work permits
export const PERMIT_TYPES = ['hot_work', 'confined_space', 'height', 'electrical', 'excavation', 'chemical', 'other'] as const;
export type PermitType = (typeof PERMIT_TYPES)[number];
export const PERMIT_TYPE_LABELS: Record<PermitType, string> = {
  hot_work: 'עבודה בחום',
  confined_space: 'כניסה למקום מוקף',
  height: 'עבודה בגובה',
  electrical: 'עבודת חשמל',
  excavation: 'חפירה',
  chemical: 'עבודה עם חומרים מסוכנים',
  other: 'אחר',
};
/**
 * Precautions the requester must confirm, per type. Content is a starting point written for the
 * unit — **requires review by a qualified safety officer** before production use.
 */
export const PERMIT_PRECAUTIONS: Record<PermitType, { id: string; label: string }[]> = {
  hot_work: [
    { id: 'clear_10m', label: 'פינוי חומרים דליקים ברדיוס 10 מ\' או כיסוי בבד חסין אש' },
    { id: 'extinguisher', label: 'מטף תקין בהישג יד' },
    { id: 'fire_watch', label: 'צופה אש במהלך העבודה ו-30 דקות אחריה' },
    { id: 'detectors', label: 'נטרול גלאי עשן מתואם עם מוקד הביטחון' },
  ],
  confined_space: [
    { id: 'gas_test', label: 'בדיקת אוויר (חמצן, נפיצות, רעילים) לפני כניסה' },
    { id: 'ventilation', label: 'אוורור מאולץ' },
    { id: 'standby', label: 'שומר בפתח עם אמצעי קשר' },
    { id: 'rescue', label: 'ציוד חילוץ זמין' },
  ],
  height: [
    { id: 'harness', label: 'רתמת בטיחות ונקודת עיגון' },
    { id: 'scaffold', label: 'פיגום / במה מאושרים' },
    { id: 'zone', label: 'גידור אזור מתחת לעבודה' },
  ],
  electrical: [
    { id: 'loto', label: 'ניתוק, נעילה ותיוג (LOTO)' },
    { id: 'test_dead', label: 'בדיקת היעדר מתח' },
    { id: 'qualified', label: 'חשמלאי מוסמך בסוג העבודה' },
  ],
  excavation: [
    { id: 'utilities', label: 'איתור תשתיות תת-קרקעיות' },
    { id: 'shoring', label: 'דיפון / שיפוע דפנות' },
    { id: 'barrier', label: 'גידור וסימון' },
  ],
  chemical: [
    { id: 'sds', label: 'קריאת גיליון בטיחות (SDS)' },
    { id: 'ppe', label: 'ציוד מגן אישי לפי ה-SDS' },
    { id: 'spill_kit', label: 'ערכת טיפול בשפך זמינה' },
  ],
  other: [{ id: 'briefing', label: 'תדריך בטיחות לצוות' }],
};
/** Pairs of permit types that must not run at the same place and time without an explicit override. */
export const PERMIT_BLOCKING_PAIRS: [PermitType, PermitType][] = [
  ['hot_work', 'chemical'],
  ['hot_work', 'confined_space'],
];

/** Fixed reaction set for updates (no free input: nothing to sanitise, no hidden messages). */
export const REACTIONS = ['👍', '✅', '👀', '❤️', '🙏'] as const;
export type Reaction = (typeof REACTIONS)[number];
export const REACTION_LABELS: Record<Reaction, string> = { '👍': 'אהבתי', '✅': 'בוצע', '👀': 'בבדיקה', '❤️': 'תודה', '🙏': 'בבקשה' };
/** How many recently opened boards are kept / shown per user. */
export const RECENT_BOARDS_KEEP = 20;
export const RECENT_BOARDS_SHOW = 8;
