import type { Column, Item, RiskValue } from './types.js';

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

/** "11/11/2026, 14:05" — date and time in the given time zone (default Israel). */
export function formatDateTimeHe(iso: string | null | undefined, timeZone = 'Asia/Jerusalem'): string {
  if (!iso || Number.isNaN(Date.parse(iso))) return '';
  return new Intl.DateTimeFormat('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone }).format(new Date(iso));
}

/** "INC-0042" for an auto_id column with prefix "INC"; "#42" without a prefix. */
export function formatAutoId(seq: number, prefix?: string): string {
  return prefix ? `${prefix}-${String(seq).padStart(4, '0')}` : `#${seq}`;
}

export function formatDateRangeHe(v: { from: string; to: string } | null | undefined): string {
  return v ? `${formatDateHe(v.from)} – ${formatDateHe(v.to)}` : '';
}

// ---------------------------------------------------------------- recurrence (wave B)
interface ScheduleLike {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval?: number;
  weekdays?: number[];
  monthDay?: number;
  startDate: string;
  endDate?: string | null;
}

const toUtc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** Day of week (0 = Sunday) of a YYYY-MM-DD date. */
export function weekdayOf(iso: string): number {
  return toUtc(iso).getUTCDay();
}

/**
 * First occurrence of a schedule on or after `from` (YYYY-MM-DD), or null if the schedule ends first.
 * Occurrences never precede `startDate`. Monthly days beyond the month's length clamp to its last day;
 * yearly schedules repeat the start date's month/day (29 Feb → 28 Feb in non-leap years).
 */
export function nextOccurrence(s: ScheduleLike, from: string): string | null {
  const interval = Math.max(1, s.interval ?? 1);
  const start = s.startDate;
  const floor = from > start ? from : start;
  const ended = (d: string) => Boolean(s.endDate && d > s.endDate);
  let result: string | null = null;

  if (s.frequency === 'daily') {
    const k = Math.ceil(daysBetween(start, floor) / interval);
    result = addDaysIso(start, Math.max(0, k) * interval);
  } else if (s.frequency === 'weekly') {
    const days = [...new Set(s.weekdays ?? [weekdayOf(start)])].sort();
    if (!days.length) return null;
    const weekStart = addDaysIso(start, -weekdayOf(start)); // Sunday of the start week
    // Scan forward at most interval * 7 * 2 days past the floor: always enough to find a match.
    for (let i = 0; i <= interval * 14 + 7; i++) {
      const d = addDaysIso(floor, i);
      const weekIndex = Math.floor(daysBetween(weekStart, d) / 7);
      if (weekIndex % interval === 0 && days.includes(weekdayOf(d))) {
        result = d;
        break;
      }
    }
  } else {
    const sd = toUtc(start);
    const fd = toUtc(floor);
    const months = s.frequency === 'monthly' ? interval : interval * 12;
    const wantDay = s.frequency === 'monthly' ? (s.monthDay ?? sd.getUTCDate()) : sd.getUTCDate();
    const monthOf = (k: number) => {
      const y = sd.getUTCFullYear();
      const m = sd.getUTCMonth() + k * months;
      const yy = y + Math.floor(m / 12);
      const mm = ((m % 12) + 12) % 12;
      return toIso(new Date(Date.UTC(yy, mm, Math.min(wantDay, daysInMonth(yy, mm)))));
    };
    const diffMonths = (fd.getUTCFullYear() - sd.getUTCFullYear()) * 12 + (fd.getUTCMonth() - sd.getUTCMonth());
    let k = Math.max(0, Math.floor(diffMonths / months) - 1);
    for (let guard = 0; guard < 5; guard++, k++) {
      const d = monthOf(k);
      if (d >= floor) {
        result = d;
        break;
      }
    }
  }
  return result && !ended(result) ? result : null;
}

/** The next `count` occurrences on or after `from` (for previews). */
export function upcomingOccurrences(s: ScheduleLike, from: string, count = 5): string[] {
  const out: string[] = [];
  let cursor = from;
  while (out.length < count) {
    const d = nextOccurrence(s, cursor);
    if (!d) break;
    out.push(d);
    cursor = addDaysIso(d, 1);
  }
  return out;
}

/** Whole days from `a` to `b` (both YYYY-MM-DD). */
export function diffDaysIso(a: string, b: string): number {
  return daysBetween(a, b);
}

// ---------------------------------------------------------------- risk matrix (wave C)
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export const RISK_LEVEL_LABELS: Record<RiskLevel, string> = { low: 'נמוך', medium: 'בינוני', high: 'גבוה', critical: 'קריטי' };
/** Palette keys used for each level (all AA-tested label colours). */
export const RISK_LEVEL_COLORS: Record<RiskLevel, 'green' | 'amber' | 'orange' | 'red'> = { low: 'green', medium: 'amber', high: 'orange', critical: 'red' };
export const LIKELIHOOD_LABELS = ['', 'נדיר', 'לא סביר', 'אפשרי', 'סביר', 'כמעט ודאי'];
export const SEVERITY_LABELS = ['', 'זניח', 'קל', 'בינוני', 'חמור', 'קטסטרופלי'];

export function riskScore(v: RiskValue): number {
  return v.l * v.s;
}

/** 5×5 matrix bands: 1–4 low, 5–9 medium, 10–16 high, 20–25 critical. */
export function riskLevel(score: number): RiskLevel {
  if (score >= 20) return 'critical';
  if (score >= 10) return 'high';
  if (score >= 5) return 'medium';
  return 'low';
}

export function isRiskValue(v: unknown): v is RiskValue {
  return typeof v === 'object' && v !== null && 'l' in v && 's' in v;
}

/** "12 · גבוה" */
export function formatRisk(v: unknown): string {
  if (!isRiskValue(v)) return '';
  const s = riskScore(v);
  return `${s} · ${RISK_LEVEL_LABELS[riskLevel(s)]}`;
}

/** Checklist progress: counts per result (unanswered = total − answered). */
export function checklistStats(col: Column, v: unknown): { total: number; pass: number; fail: number; na: number; open: number } {
  const items = col.settings.checklist?.items ?? [];
  const map = (typeof v === 'object' && v !== null && !Array.isArray(v) ? v : {}) as Record<string, { r?: string }>;
  const out = { total: items.length, pass: 0, fail: 0, na: 0, open: 0 };
  for (const it of items) {
    const r = map[it.id]?.r;
    if (r === 'pass') out.pass++;
    else if (r === 'fail') out.fail++;
    else if (r === 'na') out.na++;
    else out.open++;
  }
  return out;
}

export function isDateRange(v: unknown): v is { from: string; to: string } {
  return typeof v === 'object' && v !== null && 'from' in v && 'to' in v;
}

/** YYYY-MM-DD plus whole months; the day clamps to the target month's last day (31 Jan + 1 → 28/29 Feb). */
export function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}
