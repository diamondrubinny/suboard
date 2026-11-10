import { describe, expect, it } from 'vitest';
import {
  addDaysIso,
  checklistStats,
  formatRisk,
  riskLevel,
  createAutomationSchema,
  nextOccurrence,
  recurrenceScheduleSchema,
  ruleActionSchema,
  upcomingOccurrences,
  cellValueSchema,
  changePasswordSchema,
  columnSettingsSchema,
  formatAutoId,
  formatDateHe,
  formatDateRangeHe,
  isOverdue,
  isoDateSchema,
  loginSchema,
  PALETTE,
  todayIso,
  type Column,
  type Item,
} from './index.js';

function contrast(hexA: string, hexB: string): number {
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [l1, l2] = [lum(hexA), lum(hexB)].sort((a, b) => b - a) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

describe('palette', () => {
  it('every color pair meets WCAG AA contrast (4.5:1)', () => {
    for (const [key, { bg, fg }] of Object.entries(PALETTE)) {
      expect(contrast(bg, fg), key).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('schemas', () => {
  it('normalizes login email', () => {
    expect(loginSchema.parse({ email: '  Foo@Example.COM ', password: 'x' }).email).toBe('foo@example.com');
  });

  it('rejects invalid calendar dates', () => {
    expect(isoDateSchema.safeParse('2026-02-30').success).toBe(false);
    expect(isoDateSchema.safeParse('2026-02-28').success).toBe(true);
  });

  it('requires a new password different from current', () => {
    const r = changePasswordSchema.safeParse({ currentPassword: 'abcdefghijkl', newPassword: 'abcdefghijkl' });
    expect(r.success).toBe(false);
  });

  it('rejects duplicate status option ids and unknown colors', () => {
    expect(
      columnSettingsSchema.safeParse({
        options: [
          { id: 'a', label: 'A', color: 'red' },
          { id: 'a', label: 'B', color: 'red' },
        ],
      }).success,
    ).toBe(false);
    expect(columnSettingsSchema.safeParse({ options: [{ id: 'a', label: 'A', color: 'url(x)' }] }).success).toBe(false);
  });

  it('validates cell values by column type', () => {
    expect(cellValueSchema('number').safeParse('5').success).toBe(false);
    expect(cellValueSchema('number').safeParse(5).success).toBe(true);
    expect(cellValueSchema('text').safeParse('a\u0000b').success).toBe(false);
    expect(cellValueSchema('person').safeParse(['not-a-uuid']).success).toBe(false);
    expect(cellValueSchema('checkbox').safeParse(null).success).toBe(true);
  });
});

describe('wave A column types', () => {
  it('validates new cell types strictly', () => {
    const ok = (t: Parameters<typeof cellValueSchema>[0], v: unknown) => cellValueSchema(t).safeParse(v).success;
    expect(ok('link', 'https://example.org/a')).toBe(true);
    expect(ok('link', 'javascript:alert(1)')).toBe(false);
    expect(ok('link', 'data:text/html,x')).toBe(false);
    expect(ok('email', 'A@B.org')).toBe(true);
    expect(ok('email', 'nope')).toBe(false);
    expect(ok('phone', '+972 4-829-0000')).toBe(true);
    expect(ok('phone', 'call me')).toBe(false);
    expect(ok('progress', 50)).toBe(true);
    expect(ok('progress', 101)).toBe(false);
    expect(ok('progress', 5.5)).toBe(false);
    expect(ok('rating', 0)).toBe(false);
    expect(ok('date_range', { from: '2026-01-01', to: '2026-01-05' })).toBe(true);
    expect(ok('date_range', { from: '2026-01-05', to: '2026-01-01' })).toBe(false);
    expect(ok('tags', ['a', 'b'])).toBe(true);
    expect(ok('auto_id', 'INC-1')).toBe(false); // computed by the server only
  });

  it('formats running ids and ranges', () => {
    expect(formatAutoId(42, 'INC')).toBe('INC-0042');
    expect(formatAutoId(7)).toBe('#7');
    expect(formatDateRangeHe({ from: '2026-01-01', to: '2026-01-05' })).toBe('01/01/2026 – 05/01/2026');
  });
});

describe('logic', () => {
  const columns: Column[] = [
    {
      id: 's',
      boardId: 'b',
      title: 'סטטוס',
      type: 'status',
      position: 0,
      settings: {
        options: [
          { id: 'open', label: 'פתוח', color: 'blue' },
          { id: 'done', label: 'סגור', color: 'green', done: true },
        ],
      },
    },
    { id: 'd', boardId: 'b', title: 'יעד', type: 'date', position: 1, settings: { role: 'due' } },
  ];
  const item = (status: string, due: string): Item => ({
    id: 'i',
    boardId: 'b',
    groupId: 'g',
    parentId: null,
    seq: 1,
    name: 'x',
    values: { s: status, d: due },
    position: 0,
    createdBy: null,
    createdAt: '',
    updatedAt: '',
  });

  it('detects overdue items, ignoring done ones', () => {
    expect(isOverdue(item('open', '2026-01-01'), columns, '2026-01-02')).toBe(true);
    expect(isOverdue(item('done', '2026-01-01'), columns, '2026-01-02')).toBe(false);
    expect(isOverdue(item('open', '2026-01-02'), columns, '2026-01-02')).toBe(false);
  });

  it('formats and shifts dates', () => {
    expect(formatDateHe('2026-11-10')).toBe('10/11/2026');
    expect(addDaysIso('2026-12-30', 3)).toBe('2027-01-02');
    expect(todayIso('Asia/Jerusalem', new Date('2026-11-09T22:30:00Z'))).toBe('2026-11-10');
  });
});

describe('recurrence (wave B)', () => {
  it('daily with interval, never before start', () => {
    const s = { frequency: 'daily' as const, interval: 3, startDate: '2026-01-01' };
    expect(nextOccurrence(s, '2025-12-01')).toBe('2026-01-01');
    expect(nextOccurrence(s, '2026-01-02')).toBe('2026-01-04');
    expect(nextOccurrence(s, '2026-01-04')).toBe('2026-01-04');
  });
  it('weekly on several weekdays, every second week', () => {
    // 2026-11-01 is a Sunday.
    const s = { frequency: 'weekly' as const, interval: 2, weekdays: [0, 3], startDate: '2026-11-01' };
    expect(upcomingOccurrences(s, '2026-11-01', 4)).toEqual(['2026-11-01', '2026-11-04', '2026-11-15', '2026-11-18']);
  });
  it('monthly clamps to the last day of short months', () => {
    const s = { frequency: 'monthly' as const, monthDay: 31, startDate: '2026-01-31' };
    expect(upcomingOccurrences(s, '2026-01-01', 3)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });
  it('quarterly and yearly (29 Feb → 28 Feb)', () => {
    expect(upcomingOccurrences({ frequency: 'monthly', interval: 3, monthDay: 15, startDate: '2026-01-15' }, '2026-02-01', 2)).toEqual(['2026-04-15', '2026-07-15']);
    expect(upcomingOccurrences({ frequency: 'yearly', startDate: '2028-02-29' }, '2028-03-01', 2)).toEqual(['2029-02-28', '2030-02-28']);
  });
  it('stops at the end date', () => {
    const s = { frequency: 'daily' as const, startDate: '2026-01-01', endDate: '2026-01-02' };
    expect(upcomingOccurrences(s, '2026-01-01', 5)).toEqual(['2026-01-01', '2026-01-02']);
    expect(nextOccurrence(s, '2026-01-03')).toBeNull();
  });
  it('rule schemas reject unknown shapes', () => {
    expect(createAutomationSchema.safeParse({ name: 'x', trigger: { type: 'item_created' }, actions: [] }).success).toBe(false);
    expect(createAutomationSchema.safeParse({ name: 'x', trigger: { type: 'exec' }, actions: [{ type: 'move_group', groupId: crypto.randomUUID() }] }).success).toBe(false);
    expect(ruleActionSchema.safeParse({ type: 'notify', to: { userIds: [] }, message: 'hi' }).success).toBe(false);
    expect(recurrenceScheduleSchema.safeParse({ frequency: 'weekly', startDate: '2026-01-01' }).success).toBe(false);
  });
});

describe('risk matrix and checklist (wave C)', () => {
  it('maps the 5×5 matrix to four bands', () => {
    expect([1, 4, 5, 9, 10, 16, 20, 25].map(riskLevel)).toEqual(['low', 'low', 'medium', 'medium', 'high', 'high', 'critical', 'critical']);
    expect(formatRisk({ l: 3, s: 4 })).toBe('12 · גבוה');
    expect(formatRisk(null)).toBe('');
    expect(cellValueSchema('risk').safeParse({ l: 0, s: 3 }).success).toBe(false);
  });
  it('counts checklist results, ignoring unknown entries', () => {
    const col = { id: 'c', boardId: 'b', title: 'x', type: 'checklist' as const, position: 0, settings: { checklist: { items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }] } } };
    expect(checklistStats(col, { a: { r: 'pass' }, b: { r: 'fail' }, zz: { r: 'pass' } })).toEqual({ total: 3, pass: 1, fail: 1, na: 0, open: 1 });
    expect(cellValueSchema('checklist').safeParse({ a: { r: 'maybe' } }).success).toBe(false);
  });
});
