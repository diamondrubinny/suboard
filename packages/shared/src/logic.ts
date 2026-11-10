import type { Column, Item } from './types.js';

/** Pure board-domain helpers used by both the dashboard (server) and the UI (client). */

export function findDueColumn(columns: Column[]): Column | undefined {
  return columns.find((c) => c.type === 'date' && c.settings.role === 'due');
}

export function findPrimaryStatusColumn(columns: Column[]): Column | undefined {
  return columns.find((c) => c.type === 'status');
}

/** An item is "closed" when its primary status value is an option flagged `done`. */
export function isItemDone(item: Item, statusColumn: Column | undefined): boolean {
  if (!statusColumn) return false;
  const value = item.values[statusColumn.id];
  if (typeof value !== 'string') return false;
  return Boolean(statusColumn.settings.options?.find((o) => o.id === value)?.done);
}

/** Today as YYYY-MM-DD in the given IANA time zone (defaults to Israel). */
export function todayIso(timeZone = 'Asia/Jerusalem', now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isOverdue(item: Item, columns: Column[], today: string): boolean {
  const due = findDueColumn(columns);
  if (!due) return false;
  const value = item.values[due.id];
  if (typeof value !== 'string') return false;
  return value < today && !isItemDone(item, findPrimaryStatusColumn(columns));
}

/** Format YYYY-MM-DD as DD/MM/YYYY (Israeli convention) without time-zone drift. */
export function formatDateHe(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** "INC-0042" for an auto_id column with prefix "INC"; "#42" without a prefix. */
export function formatAutoId(seq: number, prefix?: string): string {
  return prefix ? `${prefix}-${String(seq).padStart(4, '0')}` : `#${seq}`;
}

export function formatDateRangeHe(v: { from: string; to: string } | null | undefined): string {
  return v ? `${formatDateHe(v.from)} – ${formatDateHe(v.to)}` : '';
}
