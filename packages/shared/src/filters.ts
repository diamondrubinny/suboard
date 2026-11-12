import { addDaysIso } from './logic.js';
import { evaluateFormula } from './formula.js';
import type { ColumnType } from './constants.js';
import type { CellValue, Column, Item } from './types.js';

/**
 * Advanced board filter: a list of rules on columns, combined with "all" (AND) or "any" (OR).
 * Saved inside a view's config, evaluated in the browser on the board's items.
 */
export const FILTER_OPS = ['any_of', 'none_of', 'contains', 'not_contains', 'eq', 'gt', 'lt', 'before', 'after', 'on', 'overdue', 'next_days', 'last_days', 'checked', 'unchecked', 'empty', 'not_empty'] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export interface FilterRule {
  /** A column id, or "name" for the item's name. */
  columnId: string;
  op: FilterOp;
  /** Option / user ids for any_of / none_of; text, number or ISO date otherwise; days for next_days / last_days. */
  value?: string | number | string[];
}
export interface BoardFilter {
  match: 'all' | 'any';
  rules: FilterRule[];
}
export const MAX_FILTER_RULES = 10;

export const FILTER_OP_LABELS: Record<FilterOp, string> = {
  any_of: 'הוא אחד מ-',
  none_of: 'אינו אחד מ-',
  contains: 'מכיל',
  not_contains: 'אינו מכיל',
  eq: 'שווה ל-',
  gt: 'גדול מ-',
  lt: 'קטן מ-',
  before: 'לפני',
  after: 'אחרי',
  on: 'בתאריך',
  overdue: 'עבר (לפני היום)',
  next_days: 'בימים הקרובים',
  last_days: 'בימים האחרונים',
  checked: 'מסומן',
  unchecked: 'לא מסומן',
  empty: 'ריק',
  not_empty: 'אינו ריק',
};

const TEXT_OPS: FilterOp[] = ['contains', 'not_contains', 'empty', 'not_empty'];
const NUMBER_OPS: FilterOp[] = ['eq', 'gt', 'lt', 'empty', 'not_empty'];
const DATE_OPS: FilterOp[] = ['overdue', 'next_days', 'last_days', 'before', 'after', 'on', 'empty', 'not_empty'];
const CHOICE_OPS: FilterOp[] = ['any_of', 'none_of', 'empty', 'not_empty'];

/** The operators that make sense for a column type; an empty list means the column cannot be filtered. */
export function filterOpsFor(type: ColumnType | 'name'): FilterOp[] {
  switch (type) {
    case 'name':
      return ['contains', 'not_contains'];
    case 'text':
    case 'long_text':
    case 'link':
    case 'email':
    case 'phone':
      return TEXT_OPS;
    case 'number':
    case 'progress':
    case 'rating':
    case 'formula':
      return NUMBER_OPS;
    case 'date':
    case 'date_range':
      return DATE_OPS;
    case 'status':
    case 'tags':
    case 'person':
      return CHOICE_OPS;
    case 'checkbox':
      return ['checked', 'unchecked'];
    default:
      return [];
  }
}

/** Operators that take no value. */
export const filterOpNeedsValue = (op: FilterOp): boolean => !['overdue', 'checked', 'unchecked', 'empty', 'not_empty'].includes(op);

const isBlank = (v: CellValue | undefined): boolean => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

function matchRule(rule: FilterRule, item: Item, columns: Column[], today: string): boolean {
  if (rule.columnId === 'name') {
    const has = item.name.toLowerCase().includes(String(rule.value ?? '').trim().toLowerCase());
    return rule.op === 'not_contains' ? !has : has;
  }
  const c = columns.find((x) => x.id === rule.columnId);
  // A rule on a column that no longer exists (or cannot be filtered) never hides anything.
  if (!c || !filterOpsFor(c.type).includes(rule.op)) return true;
  const raw = item.values[c.id];

  if (c.type === 'checkbox') return rule.op === 'checked' ? raw === true : raw !== true;

  if (c.type === 'formula' || c.type === 'number' || c.type === 'progress' || c.type === 'rating') {
    const v = c.type === 'formula' ? evaluateFormula(c, item, columns, today) : raw;
    const n = typeof v === 'number' ? v : null;
    if (rule.op === 'empty') return n === null;
    if (rule.op === 'not_empty') return n !== null;
    const x = Number(rule.value);
    if (n === null || !Number.isFinite(x)) return false;
    return rule.op === 'eq' ? n === x : rule.op === 'gt' ? n > x : n < x;
  }

  if (rule.op === 'empty') return isBlank(raw);
  if (rule.op === 'not_empty') return !isBlank(raw);

  if (c.type === 'date' || c.type === 'date_range') {
    const from = typeof raw === 'string' ? raw : raw && typeof raw === 'object' && !Array.isArray(raw) ? String((raw as { from?: unknown }).from ?? '') : '';
    const to = typeof raw === 'string' ? raw : raw && typeof raw === 'object' && !Array.isArray(raw) ? String((raw as { to?: unknown }).to ?? '') : '';
    if (!from) return false;
    const d = String(rule.value ?? '');
    const days = Math.max(0, Math.min(3650, Math.trunc(Number(rule.value)) || 0));
    switch (rule.op) {
      case 'overdue':
        return to < today;
      case 'next_days':
        return to >= today && from <= addDaysIso(today, days);
      case 'last_days':
        return from <= today && to >= addDaysIso(today, -days);
      case 'before':
        return Boolean(d) && from < d;
      case 'after':
        return Boolean(d) && to > d;
      case 'on':
        return Boolean(d) && from <= d && to >= d;
      default:
        return true;
    }
  }

  if (c.type === 'status' || c.type === 'tags' || c.type === 'person') {
    const wanted = Array.isArray(rule.value) ? rule.value : [];
    const have = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : [];
    const hit = have.some((id) => wanted.includes(id));
    // With nothing chosen yet the rule is still being built: it filters nothing.
    if (!wanted.length) return true;
    return rule.op === 'any_of' ? hit : !hit;
  }

  const text = String(raw ?? '').toLowerCase();
  const needle = String(rule.value ?? '').trim().toLowerCase();
  if (!needle) return true;
  return rule.op === 'contains' ? text.includes(needle) : !text.includes(needle);
}

/** Does the item pass the filter? An empty filter passes everything. */
export function matchesBoardFilter(filter: BoardFilter | undefined, item: Item, columns: Column[], today: string): boolean {
  if (!filter?.rules.length) return true;
  const results = filter.rules.map((r) => matchRule(r, item, columns, today));
  return filter.match === 'any' ? results.some(Boolean) : results.every(Boolean);
}
