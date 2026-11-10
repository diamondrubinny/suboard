/**
 * Domain constants shared by client and server.
 * Colors are referenced by key only (never raw CSS from user input) to rule out CSS injection.
 */

export const GLOBAL_ROLES = ['admin', 'manager', 'member'] as const;
export type GlobalRole = (typeof GLOBAL_ROLES)[number];

export const BOARD_ROLES = ['owner', 'editor', 'viewer'] as const;
export type BoardRole = (typeof BOARD_ROLES)[number];

export const COLUMN_TYPES = ['text', 'long_text', 'number', 'status', 'person', 'date', 'checkbox'] as const;
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
} as const;
