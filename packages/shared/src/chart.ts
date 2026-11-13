import { PALETTE, type ColorKey, type ColumnType } from './constants.js';
import { evaluateFormula } from './formula.js';
import type { Column, Group, Item } from './types.js';

/** Column types a board chart can split the items by (besides the board's own groups). */
export const CHART_BY_TYPES: readonly ColumnType[] = ['status', 'tags', 'person', 'team', 'checkbox', 'color', 'rating'];
/** Column types whose values can be summed instead of counting items. */
export const CHART_VALUE_TYPES: readonly ColumnType[] = ['number', 'formula', 'progress', 'rating'];

export interface ChartBucket {
  key: string;
  label: string;
  color?: ColorKey;
  /** The measure: number of items, or the sum of the value column. */
  value: number;
  /** Items in the bucket (an item with several labels / people is in several buckets). */
  count: number;
}

export interface ChartInput {
  items: Item[];
  columns: Column[];
  groups: Group[];
  /** "group" for the board's groups, or the id of a column of one of CHART_BY_TYPES. */
  by: string;
  /** A column of CHART_VALUE_TYPES to sum; omitted = count items. */
  valueColumnId?: string;
  /** Names of users and teams by id (for people / team columns). Unknown ids are shown as "לא ידוע". */
  names: Map<string, string>;
  today: string;
}

const NONE = '__none__';

/**
 * Splits items into the bars of a chart. Order: the natural order of the split (groups, status
 * labels, tags, rating), otherwise largest first; the "none" bar is always last; empty bars are dropped.
 */
export function chartBuckets({ items, columns, groups, by, valueColumnId, names, today }: ChartInput): ChartBucket[] {
  const valueCol = valueColumnId ? columns.find((c) => c.id === valueColumnId && CHART_VALUE_TYPES.includes(c.type)) : undefined;
  const measure = (i: Item): number => {
    if (!valueCol) return 1;
    const v = valueCol.type === 'formula' ? evaluateFormula(valueCol, i, columns, today) : i.values[valueCol.id];
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  };
  const buckets = new Map<string, ChartBucket>();
  const add = (key: string, label: string, i: Item, color?: ColorKey) => {
    const b = buckets.get(key) ?? { key, label, ...(color ? { color } : {}), value: 0, count: 0 };
    b.value += measure(i);
    b.count += 1;
    buckets.set(key, b);
  };
  let order: string[] | null = null;
  const col = by === 'group' ? undefined : columns.find((c) => c.id === by && CHART_BY_TYPES.includes(c.type));

  if (by === 'group' || !col) {
    order = groups.map((g) => g.id);
    for (const i of items) {
      const g = groups.find((x) => x.id === i.groupId);
      add(g?.id ?? NONE, g?.name ?? 'ללא קבוצה', i, g?.color);
    }
  } else {
    const options = col.settings.options ?? [];
    if (col.type === 'status' || col.type === 'tags') order = options.map((o) => o.id);
    if (col.type === 'rating') order = ['5', '4', '3', '2', '1'];
    if (col.type === 'checkbox') order = ['yes', 'no'];
    for (const i of items) {
      const v = i.values[col.id];
      switch (col.type) {
        case 'status': {
          const o = options.find((x) => x.id === v);
          if (o) add(o.id, o.label, i, o.color);
          else add(NONE, 'ללא', i);
          break;
        }
        case 'tags': {
          const hit = (Array.isArray(v) ? (v as string[]) : []).map((id) => options.find((x) => x.id === id)).filter((o) => o !== undefined);
          if (hit.length) for (const o of hit) add(o.id, o.label, i, o.color);
          else add(NONE, 'ללא', i);
          break;
        }
        case 'person':
        case 'team': {
          const ids = Array.isArray(v) ? (v as string[]) : [];
          if (ids.length) for (const id of ids) add(id, names.get(id) ?? 'לא ידוע', i);
          else add(NONE, col.type === 'team' ? 'ללא צוות' : 'לא משויך', i);
          break;
        }
        case 'checkbox':
          add(v === true ? 'yes' : 'no', v === true ? 'מסומן' : 'לא מסומן', i);
          break;
        case 'color':
          if (typeof v === 'string' && v in PALETTE) add(v, PALETTE[v as ColorKey].label, i, v as ColorKey);
          else add(NONE, 'ללא', i);
          break;
        default: {
          // rating
          if (typeof v === 'number' && v >= 1) add(String(Math.round(v)), `${Math.round(v)} כוכבים`, i);
          else add(NONE, 'ללא דירוג', i);
        }
      }
    }
  }

  const list = [...buckets.values()];
  const rank = (b: ChartBucket): number => (b.key === NONE ? Number.MAX_SAFE_INTEGER : order ? (order.indexOf(b.key) < 0 ? Number.MAX_SAFE_INTEGER - 1 : order.indexOf(b.key)) : 0);
  return list.sort((a, b) => rank(a) - rank(b) || (order ? 0 : b.value - a.value) || a.label.localeCompare(b.label, 'he'));
}
