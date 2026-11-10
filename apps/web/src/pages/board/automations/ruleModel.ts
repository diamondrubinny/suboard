import {
  findDueColumn,
  findPrimaryStatusColumn,
  type BoardDetail,
  type Column,
  type CreateAutomationInput,
  type RuleAction,
  type RuleCondition,
  type RuleTrigger,
} from '@suboard/shared';

export const TRIGGER_LABELS: Record<RuleTrigger['type'], string> = {
  item_created: 'פריט נוצר',
  status_changed: 'סטטוס משתנה',
  checkbox_checked: 'תיבת סימון מסומנת',
  person_assigned: 'אדם משויך',
  date_reached: 'מגיע תאריך (מתוזמן)',
  status_stale: 'פריט תקוע בסטטוס (SLA)',
};

export const CONDITION_LABELS: Record<RuleCondition['type'], string> = {
  status_is: 'סטטוס הוא',
  status_is_not: 'סטטוס אינו',
  not_done: 'הפריט לא הושלם',
  group_is: 'הפריט בקבוצה',
  person_empty: 'אין אחראי בעמודה',
};

export const ACTION_LABELS: Record<RuleAction['type'], string> = {
  set_status: 'קביעת סטטוס',
  set_checkbox: 'סימון / ניקוי תיבה',
  assign: 'שיוך אנשים',
  clear: 'ניקוי עמודה',
  set_date: 'קביעת תאריך',
  move_group: 'העברה לקבוצה',
  notify: 'שליחת התראה',
  create_subitem: 'יצירת תת-פריט',
};

const first = (b: BoardDetail, type: Column['type']) => b.columns.find((c) => c.type === type);

/** Which column type each trigger / condition / action needs (null = none). */
const NEEDS: Record<string, Column['type'] | 'group' | null> = {
  item_created: null,
  status_changed: 'status',
  checkbox_checked: 'checkbox',
  person_assigned: 'person',
  date_reached: 'date',
  status_stale: 'status',
  status_is: 'status',
  status_is_not: 'status',
  not_done: 'status',
  group_is: 'group',
  person_empty: 'person',
  set_status: 'status',
  set_checkbox: 'checkbox',
  assign: 'person',
  clear: null,
  set_date: 'date',
  move_group: 'group',
  notify: null,
  create_subitem: null,
};

/** False when the board has no column of the type this trigger / condition / action needs. */
export function isAvailable(b: BoardDetail, type: string): boolean {
  const need = NEEDS[type];
  if (!need) return true;
  if (need === 'group') return b.groups.length > 0;
  return Boolean(first(b, need));
}

const firstOption = (c: Column | undefined) => c?.settings.options?.[0]?.id ?? '';

export function defaultTrigger(b: BoardDetail, type: RuleTrigger['type']): RuleTrigger {
  const status = findPrimaryStatusColumn(b.columns);
  switch (type) {
    case 'item_created':
      return { type };
    case 'status_changed':
      return { type, columnId: status?.id ?? '' };
    case 'checkbox_checked':
      return { type, columnId: first(b, 'checkbox')?.id ?? '' };
    case 'person_assigned':
      return { type, columnId: first(b, 'person')?.id ?? '' };
    case 'date_reached':
      return { type, columnId: (findDueColumn(b.columns) ?? first(b, 'date'))?.id ?? '', offsetDays: -1 };
    case 'status_stale':
      return { type, columnId: status?.id ?? '', optionId: firstOption(status), days: 3 };
  }
}

export function defaultCondition(b: BoardDetail, type: RuleCondition['type']): RuleCondition {
  const status = findPrimaryStatusColumn(b.columns);
  switch (type) {
    case 'status_is':
    case 'status_is_not':
      return { type, columnId: status?.id ?? '', optionIds: firstOption(status) ? [firstOption(status)] : [] };
    case 'not_done':
      return { type };
    case 'group_is':
      return { type, groupId: b.groups[0]?.id ?? '' };
    case 'person_empty':
      return { type, columnId: first(b, 'person')?.id ?? '' };
  }
}

export function defaultAction(b: BoardDetail, type: RuleAction['type']): RuleAction {
  const status = findPrimaryStatusColumn(b.columns);
  switch (type) {
    case 'set_status':
      return { type, columnId: status?.id ?? '', optionId: firstOption(status) };
    case 'set_checkbox':
      return { type, columnId: first(b, 'checkbox')?.id ?? '', value: true };
    case 'assign':
      return { type, columnId: first(b, 'person')?.id ?? '', userIds: [], mode: 'replace' };
    case 'clear':
      return { type, columnId: b.columns.find((c) => c.type !== 'auto_id')?.id ?? '' };
    case 'set_date':
      return { type, columnId: (findDueColumn(b.columns) ?? first(b, 'date'))?.id ?? '', offsetDays: 7 };
    case 'move_group':
      return { type, groupId: b.groups[b.groups.length - 1]?.id ?? '' };
    case 'notify':
      return { type, to: { userIds: [], owners: true, columnId: first(b, 'person')?.id }, message: '' };
    case 'create_subitem':
      return { type, name: '' };
  }
}

export interface Recipe {
  key: string;
  label: string;
  build: (b: BoardDetail) => CreateAutomationInput | null;
}

const doneOption = (c: Column | undefined) => c?.settings.options?.find((o) => o.done)?.id;
const notDoneOption = (c: Column | undefined) => c?.settings.options?.find((o) => !o.done)?.id;

/** Ready-made rules for common safety-unit workflows (only offered when the board has the columns). */
export const RECIPES: Recipe[] = [
  {
    key: 'sla-open',
    label: 'SLA: פריט בסטטוס הפתיחה יותר מ-3 ימים ← התראה לבעלי הלוח',
    build: (b) => {
      const st = findPrimaryStatusColumn(b.columns);
      const open = notDoneOption(st);
      if (!st || !open) return null;
      return {
        name: 'SLA — לא טופל תוך 3 ימים',
        trigger: { type: 'status_stale', columnId: st.id, optionId: open, days: 3 },
        conditions: [],
        actions: [{ type: 'notify', to: { userIds: [], owners: true }, message: 'פריט לא טופל יותר מ-3 ימים' }],
      };
    },
  },
  {
    key: 'due-tomorrow',
    label: 'יום לפני היעד, אם לא הושלם ← התראה לאחראי',
    build: (b) => {
      const due = findDueColumn(b.columns) ?? first(b, 'date');
      const person = first(b, 'person');
      if (!due || !person || !findPrimaryStatusColumn(b.columns)) return null;
      return {
        name: 'תזכורת — יעד מחר',
        trigger: { type: 'date_reached', columnId: due.id, offsetDays: -1 },
        conditions: [{ type: 'not_done' }],
        actions: [{ type: 'notify', to: { userIds: [], columnId: person.id, owners: false }, message: 'תאריך היעד מחר' }],
      };
    },
  },
  {
    key: 'escalate-overdue',
    label: 'שבוע אחרי היעד ולא הושלם ← הסלמה לבעלי הלוח',
    build: (b) => {
      const due = findDueColumn(b.columns) ?? first(b, 'date');
      if (!due || !findPrimaryStatusColumn(b.columns)) return null;
      return {
        name: 'הסלמה — 7 ימים באיחור',
        trigger: { type: 'date_reached', columnId: due.id, offsetDays: 7 },
        conditions: [{ type: 'not_done' }],
        actions: [{ type: 'notify', to: { userIds: [], owners: true }, message: 'פריט באיחור של שבוע — נדרשת הסלמה' }],
      };
    },
  },
  {
    key: 'done-move',
    label: 'כשסטטוס הופך ל"הושלם" ← העברה לקבוצה האחרונה',
    build: (b) => {
      const st = findPrimaryStatusColumn(b.columns);
      const done = doneOption(st);
      const last = b.groups[b.groups.length - 1];
      if (!st || !done || !last || b.groups.length < 2) return null;
      return {
        name: 'סגירה — העברה לקבוצת הסגורים',
        trigger: { type: 'status_changed', columnId: st.id, to: done },
        conditions: [],
        actions: [{ type: 'move_group', groupId: last.id }],
      };
    },
  },
  {
    key: 'periodic',
    label: 'בדיקה תקופתית: כשסטטוס הופך ל"תקין/הושלם" ← הבדיקה הבאה בעוד שנה',
    build: (b) => {
      const st = findPrimaryStatusColumn(b.columns);
      const done = doneOption(st);
      const date = b.columns.filter((c) => c.type === 'date').find((c) => c.settings.role !== 'due' && /בדיקה|הבא/.test(c.title)) ?? first(b, 'date');
      if (!st || !done || !date) return null;
      return {
        name: 'בדיקה תקופתית — קידום מועד הבדיקה הבאה',
        trigger: { type: 'status_changed', columnId: st.id, to: done },
        conditions: [],
        actions: [{ type: 'set_date', columnId: date.id, offsetDays: 365 }],
      };
    },
  },
  {
    key: 'new-due',
    label: 'פריט חדש ללא יעד ← יעד בעוד 14 יום',
    build: (b) => {
      const due = findDueColumn(b.columns) ?? first(b, 'date');
      if (!due) return null;
      return {
        name: 'יעד ברירת מחדל — 14 יום',
        trigger: { type: 'item_created' },
        conditions: [],
        actions: [{ type: 'set_date', columnId: due.id, offsetDays: 14 }],
      };
    },
  },
  {
    key: 'verify-sub',
    label: 'כשסטטוס הופך ל"הושלם" ← תת-פריט "בדיקת אפקטיביות"',
    build: (b) => {
      const st = findPrimaryStatusColumn(b.columns);
      const done = doneOption(st);
      if (!st || !done) return null;
      return {
        name: 'בדיקת אפקטיביות אחרי סגירה',
        trigger: { type: 'status_changed', columnId: st.id, to: done },
        conditions: [],
        actions: [{ type: 'create_subitem', name: 'בדיקת אפקטיביות' }],
      };
    },
  },
];

// ---------------------------------------------------------------- Hebrew sentence
const colTitle = (b: BoardDetail, id: string | undefined) => b.columns.find((c) => c.id === id)?.title ?? 'עמודה שנמחקה';
const optLabel = (b: BoardDetail, colId: string, opt: string | undefined) =>
  b.columns.find((c) => c.id === colId)?.settings.options?.find((o) => o.id === opt)?.label ?? 'תווית שנמחקה';
const groupName = (b: BoardDetail, id: string) => b.groups.find((g) => g.id === id)?.name ?? 'קבוצה שנמחקה';
const people = (b: BoardDetail, ids: string[]) => ids.map((id) => b.members.find((m) => m.userId === id)?.name ?? 'משתמש').join(', ');
const daysText = (n: number) => (n === 1 ? 'יום אחד' : `${n} ימים`);

export function triggerText(b: BoardDetail, t: RuleTrigger): string {
  switch (t.type) {
    case 'item_created':
      return 'נוצר פריט';
    case 'status_changed':
      return t.to ? `"${colTitle(b, t.columnId)}" משתנה ל"${optLabel(b, t.columnId, t.to)}"` : `"${colTitle(b, t.columnId)}" משתנה`;
    case 'checkbox_checked':
      return `"${colTitle(b, t.columnId)}" מסומנת`;
    case 'person_assigned':
      return `משויך אדם ב"${colTitle(b, t.columnId)}"`;
    case 'date_reached':
      return t.offsetDays === 0
        ? `מגיע התאריך ב"${colTitle(b, t.columnId)}"`
        : t.offsetDays < 0
          ? `${daysText(-t.offsetDays)} לפני "${colTitle(b, t.columnId)}"`
          : `${daysText(t.offsetDays)} אחרי "${colTitle(b, t.columnId)}"`;
    case 'status_stale':
      return `פריט נמצא ב"${optLabel(b, t.columnId, t.optionId)}" ${daysText(t.days)} ומעלה`;
  }
}

export function conditionText(b: BoardDetail, c: RuleCondition): string {
  switch (c.type) {
    case 'status_is':
      return `"${colTitle(b, c.columnId)}" הוא ${c.optionIds.map((o) => `"${optLabel(b, c.columnId, o)}"`).join(' או ')}`;
    case 'status_is_not':
      return `"${colTitle(b, c.columnId)}" אינו ${c.optionIds.map((o) => `"${optLabel(b, c.columnId, o)}"`).join(' או ')}`;
    case 'not_done':
      return 'הפריט לא הושלם';
    case 'group_is':
      return `הפריט בקבוצה "${groupName(b, c.groupId)}"`;
    case 'person_empty':
      return `"${colTitle(b, c.columnId)}" ריק`;
  }
}

export function actionText(b: BoardDetail, a: RuleAction): string {
  switch (a.type) {
    case 'set_status':
      return `קביעת "${colTitle(b, a.columnId)}" ל"${optLabel(b, a.columnId, a.optionId)}"`;
    case 'set_checkbox':
      return a.value ? `סימון "${colTitle(b, a.columnId)}"` : `ניקוי "${colTitle(b, a.columnId)}"`;
    case 'assign':
      return `${a.mode === 'add' ? 'הוספת' : 'שיוך'} ${people(b, a.userIds)} ב"${colTitle(b, a.columnId)}"`;
    case 'clear':
      return `ניקוי "${colTitle(b, a.columnId)}"`;
    case 'set_date':
      return a.offsetDays === 0 ? `"${colTitle(b, a.columnId)}" = היום` : `"${colTitle(b, a.columnId)}" = היום + ${daysText(a.offsetDays)}`;
    case 'move_group':
      return `העברה לקבוצה "${groupName(b, a.groupId)}"`;
    case 'notify': {
      const who = [
        a.to.owners ? 'בעלי הלוח' : '',
        a.to.columnId ? `האחראים ב"${colTitle(b, a.to.columnId)}"` : '',
        a.to.userIds.length ? people(b, a.to.userIds) : '',
      ].filter(Boolean);
      return `התראה ל${who.join(', ')}: "${a.message}"`;
    }
    case 'create_subitem':
      return `יצירת תת-פריט "${a.name}"`;
  }
}
