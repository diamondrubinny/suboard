import { FILTER_OPS, MAX_FILTER_RULES } from './filters.js';
import { z } from 'zod';
import { BOARD_ROLES, CAUSE_CATEGORIES, COLOR_KEYS, COLUMN_TYPES, GLOBAL_ROLES, LIMITS, REACTIONS, COLUMN_WIDTH, type ColorKey, type ColumnType } from './constants.js';

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
export const forgotPasswordSchema = z.object({ email: z.string().trim().toLowerCase().max(254) });
export const resetPasswordSchema = z.object({
  /** 32 random bytes, base64url (from the e-mailed link). */
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'הקישור אינו תקין'),
  newPassword: passwordSchema,
});
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

// ---- passkeys (WebAuthn). The browser's credential JSON is verified cryptographically on the server;
// here it is only bounded in size and shape.
const b64url = (max: number) => z.string().regex(/^[A-Za-z0-9_-]+$/).max(max);
const challengeIdSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'בקשה לא תקינה');
export const passkeyRegisterOptionsSchema = z.object({ password: z.string().max(LIMITS.passwordMax).optional() });
export const passkeyRegisterSchema = z.object({
  challengeId: challengeIdSchema,
  name: z.string().trim().max(60).optional(),
  response: z.object({
    id: b64url(1400),
    rawId: b64url(1400),
    type: z.literal('public-key'),
    response: z.object({
      clientDataJSON: b64url(4000),
      attestationObject: b64url(40_000),
      transports: z.array(z.string().max(20)).max(8).optional(),
    }),
    authenticatorAttachment: z.string().max(30).nullish(),
    clientExtensionResults: z.record(z.string(), z.unknown()).optional(),
  }),
});
export const passkeyLoginSchema = z.object({
  challengeId: challengeIdSchema,
  response: z.object({
    id: b64url(1400),
    rawId: b64url(1400),
    type: z.literal('public-key'),
    response: z.object({
      clientDataJSON: b64url(4000),
      authenticatorData: b64url(4000),
      signature: b64url(2000),
      userHandle: b64url(200).nullish(),
    }),
    authenticatorAttachment: z.string().max(30).nullish(),
    clientExtensionResults: z.record(z.string(), z.unknown()).optional(),
  }),
});

export const preferencesSchema = z
  .object({
    emailNotifications: z.boolean().optional(),
    /** Monthly management e-mail (managers / admins only). */
    monthlyReport: z.boolean().optional(),
  })
  .refine((v) => v.emailNotifications !== undefined || v.monthlyReport !== undefined, 'אין שינויים');

export const markNotificationsReadSchema = z.union([z.object({ all: z.literal(true) }), z.object({ ids: z.array(idSchema).min(1).max(200) })]);

// ---------- Users ----------
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'תאריך לא תקין');

export const createUserSchema = z.object({
  email: emailSchema,
  name: line(80),
  role: z.enum(GLOBAL_ROLES),
  password: passwordSchema,
  /** A guest account (role must be "member"): when it expires, and which organisation the person is from. */
  guest: z.object({ expiresAt: isoDay, org: z.string().trim().max(80).optional() }).optional(),
})
  .refine((v) => !v.guest || v.role === 'member', { message: 'חשבון אורח הוא תמיד בתפקיד "חבר"', path: ['role'] });

export const updateUserSchema = z
  .object({
    name: line(80).optional(),
    role: z.enum(GLOBAL_ROLES).optional(),
    isActive: z.boolean().optional(),
    password: passwordSchema.optional(),
    /** Clear a temporary lockout caused by failed logins. */
    unlock: z.literal(true).optional(),
    /** Guest accounts only: a new expiry date / organisation. */
    guestExpiresAt: isoDay.optional(),
    guestOrg: z.string().trim().max(80).optional(),
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
  /** Retired label: stays on the items that have it, but is no longer offered for selection. */
  inactive: z.boolean().optional(),
});
export type StatusOption = z.infer<typeof statusOptionSchema>;

export const columnSettingsSchema = z
  .object({
    options: z.array(statusOptionSchema).max(LIMITS.statusOptions).optional(),
    role: z.enum(['due']).optional(),
    /** Who may change this column's cells: every editor (default), or the board's owners only. */
    editBy: z.enum(['editors', 'owners']).optional(),
    /** Any column: a short explanation shown next to the title. */
    description: z.string().trim().max(200).optional(),
    /** number / formula: a unit shown with the value ("₪", "ק\"ג", "%"), and how many decimals to show. */
    unit: z.string().trim().max(8).regex(/^[^<>\n]*$/, 'תווים לא מותרים').optional(),
    decimals: z.number().int().min(0).max(4).nullable().optional(),
    /** button: what the button is called and which status it sets on the item when pressed. */
    button: z
      .object({
        label: line(30),
        /** What pressing does. Without `action` (older buttons): set a status label. */
        action: z.enum(['set_status', 'set_today', 'assign_me', 'check', 'move_group']).optional(),
        /** The column the action writes (every action except `move_group`). */
        columnId: idSchema.optional(),
        /** `set_status`: the label to set. */
        optionId: z.string().min(1).max(40).optional(),
        /** `move_group`: the group the item moves to. */
        groupId: idSchema.optional(),
      })
      .optional(),
    /** formula: the expression, with columns referenced by id — `{<column id>}` (or `{#n}` inside a template). */
    formula: z.string().trim().min(1, 'יש להזין נוסחה').max(500).optional(),
    /** relation: the board whose items this column connects to. */
    relation: z.object({ boardId: idSchema }).optional(),
    /** mirror: shows `targetColumnId` of the items connected through `relationColumnId` (a relation column of this board; `#n` inside a template). */
    mirror: z.object({ relationColumnId: z.string().min(1).max(40), targetColumnId: z.string().max(40) }).optional(),
    /** auto_id: prefix shown before the running number, e.g. "INC". */
    prefix: z.string().regex(/^[A-Za-z0-9]{0,10}$/, 'אותיות לטיניות וספרות בלבד, עד 10').optional(),
    /** checklist: the inspection items and (optionally) where failed items open a corrective action. */
    checklist: z
      .object({
        items: z
          .array(z.object({ id: z.string().regex(/^[a-z0-9_-]{1,40}$/i, 'מזהה לא תקין'), label: line(200) }))
          .min(1, 'יש להוסיף לפחות סעיף אחד')
          .max(LIMITS.checklistItems)
          .refine((a) => new Set(a.map((x) => x.id)).size === a.length, 'מזהי סעיפים כפולים'),
        capaBoardId: idSchema.nullable().optional(),
        capaGroupId: idSchema.nullable().optional(),
      })
      .optional(),
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
    /**
     * With `settings.options`: what happens to cells that hold a label being removed — move them to
     * another label of the column, or `null` to clear them. Required for every removed label in use.
     */
    replaceOptions: z.record(z.string().max(40), z.string().max(40).nullable()).optional(),
    /** With `settings.relation` naming another board: confirms that the existing connections of the column are removed. */
    clearLinks: z.boolean().optional(),
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
    case 'team':
      return z.array(idSchema).max(10).nullable();
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
    case 'hour':
      return z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'שעה לא תקינה (לדוגמה 08:30)').nullable();
    case 'week':
      // The first day (Sunday) of the week.
      return isoDateSchema.nullable();
    case 'color':
      return colorKeySchema.nullable();
    case 'auto_id':
    case 'created_by':
    case 'updated_at':
    case 'formula':
    case 'linked':
    case 'relation':
    case 'mirror':
    case 'files':
    case 'time':
    case 'vote':
    case 'created_at':
    case 'button':
      // Computed from the item; any client value is rejected.
      return z.never();
    case 'risk':
      return z.object({ l: z.number().int().min(1).max(5), s: z.number().int().min(1).max(5) }).nullable();
    case 'checklist':
      // Clients send results only; linked corrective-action ids are maintained by the server.
      return z
        .record(z.string().regex(/^[a-z0-9_-]{1,40}$/i), z.object({ r: z.enum(['pass', 'fail', 'na']) }))
        .refine((v) => Object.keys(v).length <= LIMITS.checklistItems, 'יותר מדי סעיפים')
        .nullable();
  }
}

const valuesSchema = z.record(idSchema, z.unknown()).refine((v) => Object.keys(v).length <= LIMITS.columnsPerBoard, 'יותר מדי ערכים');

// ---------- Boards ----------
export const createBoardSchema = z.object({
  name: line(LIMITS.boardName),
  description: multiline(LIMITS.boardDescription).optional(),
  templateKey: z.string().regex(/^[a-z_]{1,40}$/).default('blank'),
  /** Create from an organisation template (structure saved from another board) instead. */
  customTemplateId: idSchema.optional(),
  /** File the new board under a workspace. */
  workspaceId: idSchema.optional(),
});

const webhookEvents = z.array(z.enum(['item_created', 'item_updated', 'item_deleted'])).min(1, 'יש לבחור לפחות אירוע אחד').max(3);
export const createWebhookSchema = z.object({ url: z.string().trim().min(1, 'יש להזין כתובת').max(500), events: webhookEvents });
export const updateWebhookSchema = z.object({ active: z.boolean().optional(), events: webhookEvents.optional() }).refine((v) => Object.keys(v).length > 0, 'אין שינויים');

export const manualTimeSchema = z.object({
  minutes: z.number().int().min(1, 'לפחות דקה אחת').max(720, 'עד 12 שעות ברישום אחד'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'תאריך לא תקין'),
  note: z.string().trim().max(200).optional(),
});

export const createApiTokenSchema = z.object({
  name: line(60),
  scope: z.enum(['read', 'write']),
  /** Every token expires: 30, 90 or 365 days. */
  days: z.union([z.literal(30), z.literal(90), z.literal(365)]),
});

export const workspaceSchema = z.object({ name: line(60) });
export const updateTeamSchema = z.object({ name: line(60).optional(), memberIds: z.array(idSchema).max(200).optional() }).refine((v) => Object.keys(v).length > 0, 'אין שינויים');
export const addTeamToBoardSchema = z.object({ teamId: idSchema, role: z.enum(['viewer', 'editor']) });
export const moveBoardSchema = z.object({ workspaceId: idSchema.nullable(), folderId: idSchema.nullable().optional() });

export const setModulesSchema = z.object({ modules: z.record(z.string().max(40), z.boolean()) });

export const setRelationSchema = z.object({ itemIds: z.array(idSchema).max(20) });

export const addLinkSchema = z.object({ toItemId: idSchema });

export const duplicateBoardSchema = z.object({
  name: line(LIMITS.boardName),
  /** Also copy the items (without people, updates and files). */
  withItems: z.boolean().default(false),
});

export const saveTemplateSchema = z.object({
  name: line(LIMITS.boardName),
  description: multiline(LIMITS.boardDescription).optional(),
});

export const updateBoardSchema = z
  .object({
    name: line(LIMITS.boardName).optional(),
    description: multiline(LIMITS.boardDescription).optional(),
    /** What a row of the board is called ("פריט ציוד"); empty for the generic "פריט". */
    itemTerm: z.string().trim().max(30).regex(/^[^<>\n]*$/, 'תווים לא מותרים').optional(),
    /** Open the board to every signed-in user (never guests) as viewers or editors; null = members only. */
    openRole: z.enum(['viewer', 'editor']).nullable().optional(),
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
  /** Reply to this update (one level: replying to a reply attaches to its parent). */
  parentId: idSchema.optional(),
});

export const reactionSchema = z.enum(REACTIONS);

// ---------- Wave A ----------
const sortSchema = z.object({ by: z.union([z.literal('name'), z.literal('seq'), idSchema]), dir: z.enum(['asc', 'desc']) });

export const viewConfigSchema = z.object({
  view: z.enum(['table', 'kanban', 'calendar', 'risk', 'gantt']).default('table'),
  search: z.string().max(LIMITS.searchQuery).optional(),
  statusFilter: z.string().max(40).optional(),
  mine: z.boolean().optional(),
  /** Advanced filter: rules on columns, combined with all (AND) / any (OR). */
  filter: z
    .object({
      match: z.enum(['all', 'any']),
      rules: z
        .array(
          z.object({
            columnId: z.string().regex(/^(name|[0-9a-f-]{36})$/),
            op: z.enum(FILTER_OPS),
            value: z.union([z.string().max(200), z.number().finite(), z.array(z.string().max(40)).max(50)]).optional(),
          }),
        )
        .max(MAX_FILTER_RULES),
    })
    .optional(),
  sort: sortSchema.optional(),
  /** Table: show the rows grouped by this status / people column instead of the board's own groups. */
  groupBy: idSchema.optional(),
  hidden: z.array(idSchema).max(LIMITS.columnsPerBoard).optional(),
  kanbanColumnId: idSchema.optional(),
  calendarColumnId: idSchema.optional(),
  riskColumnId: idSchema.optional(),
  ganttScale: z.enum(['week', 'month']).optional(),
  /** Table column widths in px, by column id (or "name" for the item column). */
  widths: z
    .record(z.string().regex(/^(name|[0-9a-f-]{36})$/), z.number().int().min(COLUMN_WIDTH.min).max(COLUMN_WIDTH.max))
    .refine((w) => Object.keys(w).length <= LIMITS.columnsPerBoard + 1, 'יותר מדי עמודות')
    .optional(),
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

// ---------- Wave B: automations ----------
const days = (min: number, max: number) => z.number().int().min(min).max(max);

export const ruleTriggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('item_created') }),
  /** `to` omitted = any change of this status column. */
  z.object({ type: z.literal('status_changed'), columnId: idSchema, to: z.string().max(40).optional() }),
  z.object({ type: z.literal('checkbox_checked'), columnId: idSchema }),
  z.object({ type: z.literal('person_assigned'), columnId: idSchema }),
  /** Scheduled: fires on the day `date + offsetDays` (negative = before the date). */
  z.object({ type: z.literal('date_reached'), columnId: idSchema, offsetDays: days(-365, 365) }),
  /** Scheduled (SLA): the item has carried status `optionId` for at least `days` days. */
  z.object({ type: z.literal('status_stale'), columnId: idSchema, optionId: z.string().min(1).max(40), days: days(1, 365) }),
]);
export type RuleTrigger = z.infer<typeof ruleTriggerSchema>;

export const ruleConditionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('status_is'), columnId: idSchema, optionIds: z.array(z.string().min(1).max(40)).min(1).max(LIMITS.statusOptions) }),
  z.object({ type: z.literal('status_is_not'), columnId: idSchema, optionIds: z.array(z.string().min(1).max(40)).min(1).max(LIMITS.statusOptions) }),
  z.object({ type: z.literal('not_done') }),
  z.object({ type: z.literal('group_is'), groupId: idSchema }),
  z.object({ type: z.literal('person_empty'), columnId: idSchema }),
]);
export type RuleCondition = z.infer<typeof ruleConditionSchema>;

export const notifyTargetSchema = z
  .object({
    userIds: z.array(idSchema).max(LIMITS.personsPerCell).default([]),
    /** Notify whoever is assigned in this person column. */
    columnId: idSchema.optional(),
    owners: z.boolean().default(false),
    /** Everyone in these teams who can see the board. */
    teamIds: z.array(idSchema).max(10).default([]),
  })
  .refine((t) => t.userIds.length > 0 || t.columnId || t.owners || t.teamIds.length > 0, 'יש לבחור למי לשלוח');

export const ruleActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('set_status'), columnId: idSchema, optionId: z.string().min(1).max(40) }),
  z.object({ type: z.literal('set_checkbox'), columnId: idSchema, value: z.boolean() }),
  z.object({ type: z.literal('assign'), columnId: idSchema, userIds: z.array(idSchema).min(1).max(LIMITS.personsPerCell), mode: z.enum(['replace', 'add']).default('replace') }),
  z.object({ type: z.literal('clear'), columnId: idSchema }),
  /** Date = today + offsetDays (local time zone). */
  z.object({ type: z.literal('set_date'), columnId: idSchema, offsetDays: days(-365, 3650) }),
  z.object({ type: z.literal('move_group'), groupId: idSchema }),
  z.object({ type: z.literal('notify'), to: notifyTargetSchema, message: line(LIMITS.ruleMessage) }),
  z.object({ type: z.literal('create_subitem'), name: line(LIMITS.itemName) }),
]);
export type RuleAction = z.infer<typeof ruleActionSchema>;

export const createAutomationSchema = z.object({
  name: line(80),
  enabled: z.boolean().default(true),
  trigger: ruleTriggerSchema,
  conditions: z.array(ruleConditionSchema).max(LIMITS.ruleConditions).default([]),
  actions: z.array(ruleActionSchema).min(1, 'יש להוסיף לפחות פעולה אחת').max(LIMITS.ruleActions),
});
export type CreateAutomationInput = z.input<typeof createAutomationSchema>;
export const updateAutomationSchema = z
  .object({
    name: line(80).optional(),
    enabled: z.boolean().optional(),
    trigger: ruleTriggerSchema.optional(),
    conditions: z.array(ruleConditionSchema).max(LIMITS.ruleConditions).optional(),
    actions: z.array(ruleActionSchema).min(1, 'יש להוסיף לפחות פעולה אחת').max(LIMITS.ruleActions).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'אין שינויים');

// ---------- Wave B: recurring items ----------
export const recurrenceScheduleSchema = z
  .object({
    frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
    interval: z.number().int().min(1).max(36).default(1),
    /** weekly: 0 = Sunday … 6 = Saturday. */
    weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    /** monthly: day of month 1–31 (clamped to the month's last day). */
    monthDay: z.number().int().min(1).max(31).optional(),
    startDate: isoDateSchema,
    endDate: isoDateSchema.nullable().optional(),
  })
  .refine((s) => s.frequency !== 'weekly' || (s.weekdays?.length ?? 0) > 0, { message: 'יש לבחור לפחות יום אחד', path: ['weekdays'] })
  .refine((s) => !s.endDate || s.endDate >= s.startDate, { message: 'תאריך הסיום לפני תאריך ההתחלה', path: ['endDate'] });
export type RecurrenceSchedule = z.infer<typeof recurrenceScheduleSchema>;

export const createRecurrenceSchema = z.object({
  name: line(LIMITS.itemName),
  groupId: idSchema,
  values: valuesSchema.optional(),
  schedule: recurrenceScheduleSchema,
  /** Optional: set this date column to occurrence date + dueOffsetDays. */
  dueColumnId: idSchema.nullable().optional(),
  dueOffsetDays: z.number().int().min(0).max(365).default(0),
  enabled: z.boolean().default(true),
});
export type CreateRecurrenceInput = z.input<typeof createRecurrenceSchema>;
export const updateRecurrenceSchema = z
  .object({
    name: line(LIMITS.itemName).optional(),
    groupId: idSchema.optional(),
    values: valuesSchema.optional(),
    schedule: recurrenceScheduleSchema.optional(),
    dueColumnId: idSchema.nullable().optional(),
    dueOffsetDays: z.number().int().min(0).max(365).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'אין שינויים');

// ---------- Wave B: scheduled reports ----------
export const createReportSchema = z
  .object({
    name: line(80),
    frequency: z.enum(['daily', 'weekly', 'monthly']),
    /** weekly: 0 = Sunday … 6 = Saturday. */
    weekday: z.number().int().min(0).max(6).default(0),
    /** monthly: 1–28 (exists in every month). */
    monthDay: z.number().int().min(1).max(28).default(1),
    recipients: z.array(idSchema).min(1, 'יש לבחור לפחות נמען אחד').max(LIMITS.reportRecipients),
    enabled: z.boolean().default(true),
  });
export type CreateReportInput = z.input<typeof createReportSchema>;
export const updateReportSchema = z
  .object({
    name: line(80).optional(),
    frequency: z.enum(['daily', 'weekly', 'monthly']).optional(),
    weekday: z.number().int().min(0).max(6).optional(),
    monthDay: z.number().int().min(1).max(28).optional(),
    recipients: z.array(idSchema).min(1, 'יש לבחור לפחות נמען אחד').max(LIMITS.reportRecipients).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'אין שינויים');

export const icsQuerySchema = z.object({ columnId: idSchema.optional() });

// ---------- Wave C ----------
export const investigationSchema = z.object({
  whys: z.array(multiline(LIMITS.why)).max(5).default([]),
  rootCause: multiline(LIMITS.rootCause).default(''),
  categories: z.array(z.enum(CAUSE_CATEGORIES)).max(CAUSE_CATEGORIES.length).default([]),
  effectivenessDue: isoDateSchema.nullable().default(null),
  effectivenessResult: z.enum(['effective', 'not_effective']).nullable().default(null),
  effectivenessNote: multiline(LIMITS.why).default(''),
});
export type InvestigationInput = z.input<typeof investigationSchema>;

export const linkedActionSchema = z.object({ boardId: idSchema, groupId: idSchema, name: line(LIMITS.itemName) });

export const complianceSettingsSchema = z
  .object({
    dateColumnId: idSchema,
    groupByColumnId: idSchema.nullable().optional(),
    windowDays: z.number().int().min(1).max(180).default(30),
  })
  .nullable();
export type ComplianceSettings = z.infer<typeof complianceSettingsSchema>;

export const formFieldSchema = z.object({
  columnId: idSchema,
  label: line(LIMITS.columnTitle).optional(),
  help: z.string().max(300).optional(),
  required: z.boolean().default(false),
  /** Section heading shown before this field. */
  section: z.string().trim().max(80).optional(),
  /** Show only when an earlier choice / yes-no field has one of these answers ("true" / "false" for yes-no). */
  showIf: z.object({ columnId: idSchema, optionIds: z.array(z.string().max(60)).min(1).max(LIMITS.statusOptions) }).optional(),
});
const formExtras = {
  /** Shown after a successful submission instead of the default text. */
  successMessage: z.string().trim().max(500),
  /** Board members notified of every new response. */
  notifyUserIds: z.array(idSchema).max(20),
  /** Board members every response is assigned to (first person column). */
  assignUserIds: z.array(idSchema).max(10),
};
export const createFormSchema = z.object({
  name: line(80),
  description: multiline(1000).default(''),
  groupId: idSchema,
  nameLabel: line(80).default('כותרת'),
  fields: z.array(formFieldSchema).max(LIMITS.formFields).refine((f) => new Set(f.map((x) => x.columnId)).size === f.length, 'שדה כפול'),
  audience: z.enum(['members', 'all_users']).default('members'),
  allowPhotos: z.boolean().default(false),
  enabled: z.boolean().default(true),
  successMessage: formExtras.successMessage.default(''),
  notifyUserIds: formExtras.notifyUserIds.default([]),
  assignUserIds: formExtras.assignUserIds.default([]),
});
export type CreateFormInput = z.input<typeof createFormSchema>;
export const updateFormSchema = z
  .object({
    name: line(80).optional(),
    description: multiline(1000).optional(),
    groupId: idSchema.optional(),
    nameLabel: line(80).optional(),
    fields: z.array(formFieldSchema).max(LIMITS.formFields).optional(),
    audience: z.enum(['members', 'all_users']).optional(),
    allowPhotos: z.boolean().optional(),
    enabled: z.boolean().optional(),
    successMessage: formExtras.successMessage.optional(),
    notifyUserIds: formExtras.notifyUserIds.optional(),
    assignUserIds: formExtras.assignUserIds.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'אין שינויים');
/** Question kinds offered by the form builder → the board column type that stores the answer. */
export const QUESTION_TYPES = {
  text: 'text',
  long_text: 'long_text',
  number: 'number',
  date: 'date',
  choice: 'status',
  multi_choice: 'tags',
  yes_no: 'checkbox',
  rating: 'rating',
  email: 'email',
  phone: 'phone',
  link: 'link',
} as const satisfies Record<string, ColumnType>;
export type QuestionType = keyof typeof QUESTION_TYPES;
export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  text: 'טקסט קצר',
  long_text: 'טקסט ארוך',
  number: 'מספר',
  date: 'תאריך',
  choice: 'בחירה אחת',
  multi_choice: 'בחירה מרובה',
  yes_no: 'כן / לא',
  rating: 'דירוג (1–5)',
  email: 'דוא"ל',
  phone: 'טלפון',
  link: 'קישור',
};
export const quickFormSchema = z.object({
  name: line(80),
  description: multiline(1000).default(''),
  nameLabel: line(80).default('נושא'),
  allowPhotos: z.boolean().default(false),
  questions: z
    .array(
      z
        .object({
          title: line(LIMITS.columnTitle),
          type: z.enum(Object.keys(QUESTION_TYPES) as [QuestionType, ...QuestionType[]]),
          required: z.boolean().default(false),
          help: z.string().trim().max(300).optional(),
          options: z.array(line(40)).max(LIMITS.statusOptions).optional(),
        })
        .refine((q) => (q.type !== 'choice' && q.type !== 'multi_choice') || (q.options !== undefined && q.options.length >= 2), 'לשאלת בחירה נדרשות לפחות שתי אפשרויות')
        .refine((q) => !q.options || new Set(q.options).size === q.options.length, 'אפשרויות כפולות'),
    )
    .min(1, 'יש להוסיף לפחות שאלה אחת')
    .max(LIMITS.formFields)
    .refine((qs) => new Set(qs.map((q) => q.title)).size === qs.length, 'לשתי שאלות אותה כותרת'),
});
export type QuickFormInput = z.input<typeof quickFormSchema>;

export const reminderSchema = z.object({
  remindAt: z.string().max(40).refine((s) => !Number.isNaN(Date.parse(s)), 'מועד לא תקין'),
  note: z.string().trim().max(200).default(''),
});
export const personalNoteSchema = z.object({ body: z.string().max(2000) });
export const saveItemTemplateSchema = z.object({ name: line(80) });
export const useItemTemplateSchema = z.object({ groupId: idSchema });

export const submitFormSchema = z.object({ name: line(LIMITS.itemName), values: z.record(idSchema, z.unknown()).default({}) });

// ---------- Wave D ----------
const boardIds = z.array(idSchema).max(50).default([]);
const widgetBase = { id: z.string().regex(/^[a-z0-9]{4,16}$/), title: z.string().trim().max(60).optional(), size: z.enum(['s', 'm', 'l']).default('m') };
export const widgetSchema = z.discriminatedUnion('type', [
  z.object({ ...widgetBase, type: z.literal('count'), boardIds, metric: z.enum(['open', 'overdue', 'due_week', 'created_month', 'closed_month']) }),
  z.object({ ...widgetBase, type: z.literal('status'), boardId: idSchema }),
  z.object({ ...widgetBase, type: z.literal('trend'), boardIds, period: z.enum(['week', 'month']).default('month'), count: z.number().int().min(3).max(24).default(6) }),
  z.object({ ...widgetBase, type: z.literal('overdue'), boardIds, limit: z.number().int().min(3).max(30).default(10) }),
  z.object({ ...widgetBase, type: z.literal('workload'), boardIds }),
  z.object({ ...widgetBase, type: z.literal('compliance'), boardIds }),
  z.object({ ...widgetBase, type: z.literal('risk'), boardIds }),
]);
export type Widget = z.infer<typeof widgetSchema>;
export type WidgetInput = z.input<typeof widgetSchema>;

export const createDashboardSchema = z.object({
  name: line(80),
  shared: z.boolean().default(false),
  widgets: z.array(widgetSchema).max(24).default([]),
});
export const updateDashboardSchema = z
  .object({ name: line(80).optional(), shared: z.boolean().optional(), widgets: z.array(widgetSchema).max(24).optional() })
  .refine((v) => Object.keys(v).length > 0, 'אין שינויים');

export const trendQuerySchema = z.object({
  boards: z
    .string()
    .max(2000)
    .optional()
    .transform((s) => (s ? s.split(',').filter(Boolean) : []))
    .pipe(z.array(idSchema).max(50)),
  period: z.enum(['week', 'month']).default('month'),
  count: z.coerce.number().int().min(3).max(24).default(6),
});

export const monthQuerySchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'חודש לא תקין').optional() });

export const dependenciesSchema = z.object({ blockedBy: z.array(idSchema).max(20) });

// ---------- Wave E ----------
const isoDateTime = z
  .string()
  .max(40)
  .refine((s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) && !Number.isNaN(Date.parse(s)), 'תאריך ושעה לא תקינים')
  .transform((s) => new Date(s).toISOString());
const httpUrl = z
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
  }, 'קישור חייב להתחיל ב-http:// או https://');

export const createTrainingSchema = z.object({
  name: line(120),
  description: multiline(1000).default(''),
  /** 0 = no expiry (one-time training). */
  validityMonths: z.number().int().min(0).max(120).default(12),
  allUsers: z.boolean().default(false),
});
export const updateTrainingSchema = z
  .object({ name: line(120).optional(), description: multiline(1000).optional(), validityMonths: z.number().int().min(0).max(120).optional(), allUsers: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, 'אין שינויים');
export const trainingRequirementsSchema = z.object({ userIds: z.array(idSchema).max(2000) });
export const trainingRecordSchema = z.object({ userIds: z.array(idSchema).min(1).max(500), completedOn: isoDateSchema, note: z.string().trim().max(200).default('') });


export const createProcedureSchema = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9._-]{1,20}$/, 'קוד: אותיות לטיניות, ספרות ו-. _ - (עד 20)'),
  title: line(160),
  category: line(60).default('כללי'),
  audience: z.enum(['all', 'users']).default('all'),
  userIds: z.array(idSchema).max(2000).default([]),
});
export const updateProcedureSchema = z
  .object({ title: line(160).optional(), category: line(60).optional(), audience: z.enum(['all', 'users']).optional(), userIds: z.array(idSchema).max(2000).optional() })
  .refine((v) => Object.keys(v).length > 0, 'אין שינויים');
export const procedureVersionSchema = z.object({
  version: line(20),
  effectiveOn: isoDateSchema,
  summary: multiline(1000).default(''),
  body: multiline(50_000).default(''),
  link: httpUrl.nullable().default(null),
});
export type ProcedureVersionInput = z.input<typeof procedureVersionSchema>;

export const pinsSchema = z.object({
  pins: z.array(z.object({ itemId: idSchema, x: z.number().min(0).max(100), y: z.number().min(0).max(100) })).max(300),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type CreateBoardInput = z.input<typeof createBoardSchema>;
export type CreateColumnInput = z.infer<typeof createColumnSchema>;
export type UpdateColumnInput = z.infer<typeof updateColumnSchema>;
export type CreateItemInput = z.infer<typeof createItemSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;
export type BulkInput = z.infer<typeof bulkSchema>;
