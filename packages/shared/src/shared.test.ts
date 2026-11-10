import { describe, expect, it } from 'vitest';
import {
  addDaysIso,
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
