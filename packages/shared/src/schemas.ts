import { z } from 'zod';
import { BOARD_ROLES, COLOR_KEYS, COLUMN_TYPES, GLOBAL_ROLES, LIMITS, type ColorKey, type ColumnType } from './constants.js';

/** Trimmed, non-empty single-line string without control characters. */
const line = (max: number) =>
  z
    .string()
    .trim()
    .min(1, 'שדה חובה')
    .max(max, `עד ${max} תווים`)
    .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), 'תווים לא חוקיים');

const multiline = (max: number) =>
  z
    .string()
    .max(max, `עד ${max} תווים`)
    .refine((s) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s), 'תווים לא חוקיים');

export const idSchema = z.uuid('מזהה לא תקין');
export const colorKeySchema = z.enum(COLOR_KEYS as [ColorKey, ...ColorKey[]]);
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'תאריך לא תקין')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'תאריך לא תקין');

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email('כתובת דוא"ל לא תקינה'));

export const passwordSchema = z
  .string()
  .min(LIMITS.passwordMin, `סיסמה חייבת להכיל לפחות ${LIMITS.passwordMin} תווים`)
  .max(LIMITS.passwordMax, `עד ${LIMITS.passwordMax} תווים`);

// ---------- Auth ----------
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'שדה חובה').max(LIMITS.passwordMax),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'שדה חובה').max(LIMITS.passwordMax),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'הסיסמה החדשה חייבת להיות שונה מהנוכחית',
    path: ['newPassword'],
  });

// ---------- MFA ----------
/** A 6-digit TOTP code or a recovery code (xxxxx-xxxxx). Whitespace is ignored. */
export const mfaCodeSchema = z
  .string()
  .transform((s) => s.replace(/\s/g, '').toLowerCase())
  .pipe(z.string().regex(/^(\d{6}|[a-z0-9]{5}-[a-z0-9]{5})$/, 'קוד לא תקין'));

export const mfaVerifySchema = z.object({
  challengeToken: z.string().min(20).max(100),
  code: mfaCodeSchema,
});

export const mfaEnableSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'יש להזין קוד בן 6 ספרות') });

export const mfaDisableSchema = z.object({
  password: z.string().min(1, 'שדה חובה').max(LIMITS.passwordMax),
  code: mfaCodeSchema,
});

export const preferencesSchema = z.object({ emailNotifications: z.boolean() });

export const markNotificationsReadSchema = z.union([z.object({ all: z.literal(true) }), z.object({ ids: z.array(idSchema).min(1).max(200) })]);

// ---------- Users ----------
export const createUserSchema = z.object({
  email: emailSchema,
  name: line(80),
  role: z.enum(GLOBAL_ROLES),
  password: passwordSchema,
});

export const updateUserSchema = z
  .object({
    name: line(80).optional(),
    role: z.enum(GLOBAL_ROLES).optional(),
    isActive: z.boolean().optional(),
    password: passwordSchema.optional(),
    /** Clear a temporary lockout caused by failed logins. */
    unlock: z.literal(true).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'אין שינויים');

// ---------- Columns ----------
export const statusOptionSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9_-]+$/i, 'מזהה לא תקין'),
  label: line(LIMITS.statusLabel),
  color: colorKeySchema,
  done: z.boolean().optional(),
});
export type StatusOption = z.infer<typeof statusOptionSchema>;

export const columnSettingsSchema = z
  .object({
    options: z.array(statusOptionSchema).max(LIMITS.statusOptions).optional(),
    role: z.enum(['due']).optional(),
    /** auto_id: prefix shown before the running number, e.g. "INC". */
    prefix: z.string().regex(/^[A-Za-z0-9]{0,10}$/, 'אותיות לטיניות וספרות בלבד, עד 10').optional(),
  })
  .refine(
    (s) => !s.options || new Set(s.options.map((o) => o.id)).size === s.options.length,
    'מזהי תוויות כפולים',
  );
export type ColumnSettings = z.infer<typeof columnSettingsSchema>;

export const createColumnSchema = z.object({
  title: line(LIMITS.columnTitle),
  type: z.enum(COLUMN_TYPES),
  settings: columnSettingsSchema.optional(),
});

export const updateColumnSchema = z
  .object({
    title: line(LIMITS.columnTitle).optional(),
    settings: columnSettingsSchema.optional(),
    position: z.number().finite().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'אין שינויים');

/**
 * Shape validation for a single cell value by column type.
 * `null` clears a value. Referential checks (status option exists, user exists)
 * are performed by the server, which has the column settings and user directory.
 */
export function cellValueSchema(type: ColumnType): z.ZodType<unknown> {
  switch (type) {
    case 'text':
      return line(LIMITS.text).nullable();
    case 'long_text':
      return multiline(LIMITS.longText).nullable();
    case 'number':
      return z.number().finite().gte(-1e12).lte(1e12).nullable();
    case 'status':
      return z.string().min(1).max(40).nullable();
    case 'person':
      return z.array(idSchema).max(LIMITS.personsPerCell).nullable();
    case 'date':
      return isoDateSchema.nullable();
    case 'checkbox':
      return z.boolean().nullable();
    case 'tags':
      return z.array(z.string().min(1).max(40)).max(LIMITS.tagsPerCell).nullable();
    case 'date_range':
      return z
        .object({ from: isoDateSchema, to: isoDateSchema })
        .refine((r) => r.from <= r.to, 'תאריך הסיום לפני תאריך ההתחלה')
        .nullable();
    case 'progress':
      return z.number().int('מספר שלם').min(0).max(100).nullable();
    case 'rating':
      return z.number().int().min(1).max(5).nullable();
    case 'link':
      return z
        .string()
        .trim()
        .max(2000)
        .refine((u) => {
          try {
            const p = new URL(u);
            return p.protocol === 'https:' || p.protocol === 'http:';
          } catch {
            return false;
          }
        }, 'קישור חייב להתחיל ב-http:// או https://')
        .nullable();
    case 'email':
      return z.string().trim().toLowerCase().max(254).pipe(z.email('כתובת דוא"ל לא תקינה')).nullable();
    case 'phone':
      return z
        .string()
        .trim()
        .regex(/^\+?[0-9][0-9 ()-]{2,19}$/, 'מספר טלפון לא תקין')
        .nullable();
    case 'auto_id':
      // Computed by the server; any client value is rejected.
      return z.never();
  }
}

const valuesSchema = z.record(idSchema, z.unknown()).refine((v) => Object.keys(v).length <= LIMITS.columnsPerBoard, 'יותר מדי ערכים');

// ---------- Boards ----------
export const createBoardSchema = z.object({
  name: line(LIMITS.boardName),
  description: multiline(LIMITS.boardDescription).optional(),
  templateKey: z.string().regex(/^[a-z_]{1,40}$/).default('blank'),
});

export const updateBoardSchema = z
  .object({
    name: line(LIMITS.boardName).optional(),
    description: multiline(LIMITS.boardDescription).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'אין שינויים');

export const setMemberSchema = z.object({
  userId: idSchema,
  role: z.enum(BOARD_ROLES),
});

// ---------- Groups ----------
export const createGroupSchema = z.object({
  name: line(LIMITS.groupName),
  color: colorKeySchema.optional(),
});
export const updateGroupSchema = z
  .object({
    name: line(LIMITS.groupName).optional(),
    color: colorKeySchema.optional(),
    position: z.number().finite().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'אין שינויים');

// ---------- Items ----------
export const createItemSchema = z.object({
  groupId: idSchema,
  /** Create as a sub-item of this (top-level) item. */
  parentId: idSchema.optional(),
  name: line(LIMITS.itemName),
  values: valuesSchema.optional(),
});

export const updateItemSchema = z
  .object({
    name: line(LIMITS.itemName).optional(),
    groupId: idSchema.optional(),
    position: z.number().finite().optional(),
    values: valuesSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'אין שינויים');

export const createUpdateSchema = z.object({
  body: multiline(LIMITS.updateBody).refine((s) => s.trim().length > 0, 'שדה חובה'),
  /** Users @mentioned in the body (must be members of the board). */
  mentions: z.array(idSchema).max(20).optional(),
});

// ---------- Wave A ----------
const sortSchema = z.object({ by: z.union([z.literal('name'), z.literal('seq'), idSchema]), dir: z.enum(['asc', 'desc']) });

export const viewConfigSchema = z.object({
  view: z.enum(['table', 'kanban', 'calendar']).default('table'),
  search: z.string().max(LIMITS.searchQuery).optional(),
  statusFilter: z.string().max(40).optional(),
  mine: z.boolean().optional(),
  sort: sortSchema.optional(),
  hidden: z.array(idSchema).max(LIMITS.columnsPerBoard).optional(),
  kanbanColumnId: idSchema.optional(),
  calendarColumnId: idSchema.optional(),
});
export type ViewConfig = z.infer<typeof viewConfigSchema>;

export const createViewSchema = z.object({ name: line(60), config: viewConfigSchema, shared: z.boolean().default(false) });
export const updateViewSchema = z
  .object({ name: line(60).optional(), config: viewConfigSchema.optional(), shared: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, 'אין שינויים');

export const bulkSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('delete'), itemIds: z.array(idSchema).min(1).max(LIMITS.bulkItems) }),
  z.object({ action: z.literal('move_group'), itemIds: z.array(idSchema).min(1).max(LIMITS.bulkItems), groupId: idSchema }),
  z.object({ action: z.literal('set_value'), itemIds: z.array(idSchema).min(1).max(LIMITS.bulkItems), columnId: idSchema, value: z.unknown() }),
]);

export const moveItemSchema = z.object({ boardId: idSchema, groupId: idSchema });

export const importSchema = z.object({
  groupId: idSchema,
  rows: z
    .array(z.object({ name: line(LIMITS.itemName), values: z.record(idSchema, z.unknown()).optional() }))
    .min(1)
    .max(LIMITS.importRows),
});

export const searchQuerySchema = z.object({ q: z.string().trim().min(2, 'לפחות 2 תווים').max(LIMITS.searchQuery) });

export type LoginInput = z.infer<typeof loginSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type CreateBoardInput = z.input<typeof createBoardSchema>;
export type CreateColumnInput = z.infer<typeof createColumnSchema>;
export type UpdateColumnInput = z.infer<typeof updateColumnSchema>;
export type CreateItemInput = z.infer<typeof createItemSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;
export type BulkInput = z.infer<typeof bulkSchema>;
