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
});

export type LoginInput = z.infer<typeof loginSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type CreateBoardInput = z.input<typeof createBoardSchema>;
export type CreateColumnInput = z.infer<typeof createColumnSchema>;
export type UpdateColumnInput = z.infer<typeof updateColumnSchema>;
export type CreateItemInput = z.infer<typeof createItemSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;
