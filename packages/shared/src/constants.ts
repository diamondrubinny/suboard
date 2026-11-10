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

/** Palette: background + foreground pairs chosen to meet WCAG AA (≥4.5:1) for normal text. */
export const PALETTE = {
  green: { bg: '#1E7B4F', fg: '#FFFFFF', label: 'ירוק' },
  teal: { bg: '#0F6E75', fg: '#FFFFFF', label: 'טורקיז' },
  blue: { bg: '#1F5FB8', fg: '#FFFFFF', label: 'כחול' },
  navy: { bg: '#24346B', fg: '#FFFFFF', label: 'כחול כהה' },
  purple: { bg: '#6B3FA8', fg: '#FFFFFF', label: 'סגול' },
  pink: { bg: '#A8326E', fg: '#FFFFFF', label: 'ורוד' },
  red: { bg: '#B42318', fg: '#FFFFFF', label: 'אדום' },
  orange: { bg: '#B54708', fg: '#FFFFFF', label: 'כתום' },
  amber: { bg: '#F2C230', fg: '#1F1A05', label: 'צהוב' },
  gray: { bg: '#5B6472', fg: '#FFFFFF', label: 'אפור' },
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
