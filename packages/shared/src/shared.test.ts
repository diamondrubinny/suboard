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

// ---------------------------------------------------------------- formula columns
import { evaluateFormula, formatFormulaValue, formulaToDisplay, formulaToStored, mapFormulaRefs, validateFormula, FORMULA_MAX_LENGTH } from './formula.js';
import type { Column as FCol } from './types.js';

describe('formula columns', () => {
  const col = (id: string, title: string, type: FCol['type'], settings: FCol['settings'] = {}): FCol => ({ id, boardId: 'b', title, type, settings, position: 0 });
  const cols: FCol[] = [
    col('cost', 'עלות', 'number'),
    col('qty', 'כמות', 'number'),
    col('due', 'תאריך יעד', 'date'),
    col('st', 'סטטוס', 'status', { options: [{ id: 'd', label: 'בוצע', color: 'green' }, { id: 'o', label: 'פתוח', color: 'gray' }] }),
    col('ok', 'אושר', 'checkbox'),
    col('risk', 'סיכון', 'risk'),
    col('txt', 'מיקום', 'text'),
    col('ppl', 'אחראי', 'person'),
    col('f2', 'אחר', 'formula', { formula: '1' }),
  ];
  const item = { seq: 7, values: { cost: 100, qty: 3, due: '2026-11-21', st: 'd', ok: true, risk: { l: 3, s: 4 }, txt: 'מעבדה 214' } };
  const run = (formula: string, values: Record<string, unknown> = item.values) =>
    evaluateFormula(col('f', 'נוסחה', 'formula', { formula }), { seq: 7, values: values as never }, cols, '2026-11-11');

  it('does arithmetic with precedence, parentheses and unary minus', () => {
    expect(run('{cost} * {qty}')).toBe(300);
    expect(run('1 + 2 * 3')).toBe(7);
    expect(run('(1 + 2) * 3')).toBe(9);
    expect(run('-{cost} + 10')).toBe(-90);
    expect(run('ROUND({cost} * 1.18 / 7, 2)')).toBe(16.86);
    expect(run('MAX({cost}, {qty}, 250) - MIN({cost}, {qty})')).toBe(247);
    expect(run('AVG({cost}, {qty})')).toBe(51.5);
    expect(run('{risk}')).toBe(12);
    expect(run('{cost} + {ok}')).toBe(101);
  });

  it('treats dates as day numbers and blanks as blanks', () => {
    expect(run('DAYS({due}, TODAY())')).toBe(10);
    expect(run('{due} - TODAY()')).toBe(10);
    expect(run('{cost} * {qty}', { cost: 5 })).toBeNull();
    expect(run('{cost} / {qty}', { cost: 5, qty: 0 })).toBeNull();
    expect(run('SUM({cost}, {qty})', { cost: 5 })).toBe(5);
    expect(run('IF(EMPTY({qty}), 0, {qty})', {})).toBe(0);
    expect(run('{cost} > 3', {})).toBe(false);
  });

  it('compares, branches and joins text', () => {
    expect(run('IF({st} = "בוצע", "סגור", "פתוח")')).toBe('סגור');
    expect(run('IF(AND({cost} >= 100, NOT({qty} > 5)), 1, 2)')).toBe(1);
    expect(run('IF(OR({cost} < 1, {st} != "בוצע"), "כן", "לא")')).toBe('לא');
    expect(run('{txt} & " / " & {cost}')).toBe('מעבדה 214 / 100');
    expect(run('CONCAT("#", {qty})')).toBe('#3');
    expect(formatFormulaValue(run('{cost} * 12.345'))).toBe('1,234.5');
    expect(formatFormulaValue(run('{cost} > 1'))).toBe('כן');
    expect(formatFormulaValue(null)).toBe('');
  });

  it('rejects anything that is not the formula language', () => {
    const bad = (f: string) => expect(validateFormula(f, cols), f).toBeTruthy();
    for (const f of ['', '1 +', '(1', 'FOO(1)', 'IF(1,2)', '{nope} + 1', '{f2} + 1', '{ppl}', 'alert(1)', 'constructor', '1; 2', '"open', '{cost', '__proto__', 'this.x', '1 ** 2', 'a.b()', '`x`'])
      bad(f);
    expect(validateFormula('x'.repeat(FORMULA_MAX_LENGTH + 1), cols)).toBeTruthy();
    expect(validateFormula('('.repeat(60) + '1' + ')'.repeat(60), cols)).toBeTruthy();
    expect(validateFormula(Array(300).fill('1').join('+'), cols)).toBeTruthy();
    expect(validateFormula('IF({st} = "בוצע", 0, DAYS({due}, TODAY()))', cols)).toBeNull();
    // a broken or dangling formula never throws at evaluation time
    expect(run('1 +')).toBeNull();
    expect(run('{gone} * 2')).toBeNull();
  });

  it('converts between titles, ids and template positions without touching text in quotes', () => {
    const stored = formulaToStored('IF({סטטוס} = "{עלות}", {עלות} * { כמות }, 0)', cols);
    expect(stored).toEqual({ formula: 'IF({st} = "{עלות}", {cost} * {qty}, 0)', unknown: [] });
    expect(formulaToStored('{אין כזו} + 1', cols).unknown).toEqual(['אין כזו']);
    expect(formulaToDisplay('{cost} * {deleted}', cols)).toBe('{עלות} * {?}');
    const ids = cols.map((c) => c.id);
    const portable = mapFormulaRefs('{cost} * {qty}', (id) => `#${ids.indexOf(id)}`).formula;
    expect(portable).toBe('{#0} * {#1}');
    expect(mapFormulaRefs(portable, (r) => ['new-a', 'new-b'][Number(r.slice(1))] ?? null).formula).toBe('{new-a} * {new-b}');
  });
});

// ---------------------------------------------------------------- advanced filter
import { filterOpsFor, matchesBoardFilter, type BoardFilter } from './filters.js';
import { renderRuleMessage } from './logic.js';
import type { Column as XCol, Item as XItem } from './types.js';

describe('advanced board filter', () => {
  const c = (id: string, type: XCol['type'], settings: XCol['settings'] = {}): XCol => ({ id, boardId: 'b', title: id, type, settings, position: 0 });
  const cols = [c('st', 'status', { options: [{ id: 'open', label: 'פתוח', color: 'gray' }, { id: 'done', label: 'בוצע', color: 'green', done: true }] }), c('who', 'person'), c('due', 'date'), c('cost', 'number'), c('txt', 'text'), c('ok', 'checkbox'), c('span', 'date_range'), c('f', 'formula', { formula: '{cost} * 2' }), c('files', 'checklist')];
  const mk = (values: Record<string, unknown>, name = 'מנדף 3'): XItem => ({ id: 'i', boardId: 'b', groupId: 'g', parentId: null, name, values: values as XItem['values'], position: 0, seq: 1, createdBy: null, createdAt: '', updatedAt: '' });
  const pass = (f: BoardFilter, values: Record<string, unknown>, name?: string) => matchesBoardFilter(f, mk(values, name), cols, '2026-11-12');
  const one = (columnId: string, op: BoardFilter['rules'][number]['op'], value?: BoardFilter['rules'][number]['value']): BoardFilter => ({ match: 'all', rules: [{ columnId, op, value }] });

  it('matches choices, people, text, numbers and checkboxes', () => {
    expect(pass(one('st', 'any_of', ['open']), { st: 'open' })).toBe(true);
    expect(pass(one('st', 'any_of', ['open']), { st: 'done' })).toBe(false);
    expect(pass(one('st', 'none_of', ['done']), {})).toBe(true);
    expect(pass(one('who', 'any_of', ['u1', 'u2']), { who: ['u2', 'u9'] })).toBe(true);
    expect(pass(one('who', 'empty'), { who: [] })).toBe(true);
    expect(pass(one('who', 'not_empty'), {})).toBe(false);
    expect(pass(one('txt', 'contains', 'מעבדה'), { txt: 'ליד מעבדה 214' })).toBe(true);
    expect(pass(one('txt', 'not_contains', 'מעבדה'), { txt: 'מסדרון' })).toBe(true);
    expect(pass(one('name', 'contains', 'מנדף'), {})).toBe(true);
    expect(pass(one('name', 'contains', 'כיור'), {})).toBe(false);
    expect(pass(one('cost', 'gt', 100), { cost: 150 })).toBe(true);
    expect(pass(one('cost', 'lt', 100), { cost: 150 })).toBe(false);
    expect(pass(one('cost', 'eq', 150), { cost: 150 })).toBe(true);
    expect(pass(one('cost', 'gt', 100), {})).toBe(false);
    expect(pass(one('f', 'gt', 250), { cost: 150 })).toBe(true); // formula result
    expect(pass(one('ok', 'checked'), { ok: true })).toBe(true);
    expect(pass(one('ok', 'unchecked'), {})).toBe(true);
  });

  it('understands dates relative to today and ranges', () => {
    expect(pass(one('due', 'overdue'), { due: '2026-11-11' })).toBe(true);
    expect(pass(one('due', 'overdue'), { due: '2026-11-12' })).toBe(false);
    expect(pass(one('due', 'next_days', 7), { due: '2026-11-19' })).toBe(true);
    expect(pass(one('due', 'next_days', 7), { due: '2026-11-20' })).toBe(false);
    expect(pass(one('due', 'next_days', 7), { due: '2026-11-01' })).toBe(false);
    expect(pass(one('due', 'last_days', 3), { due: '2026-11-10' })).toBe(true);
    expect(pass(one('due', 'before', '2026-12-01'), { due: '2026-11-30' })).toBe(true);
    expect(pass(one('due', 'after', '2026-12-01'), { due: '2026-11-30' })).toBe(false);
    expect(pass(one('due', 'on', '2026-11-30'), { due: '2026-11-30' })).toBe(true);
    expect(pass(one('due', 'overdue'), {})).toBe(false);
    expect(pass(one('span', 'on', '2026-11-15'), { span: { from: '2026-11-10', to: '2026-11-20' } })).toBe(true);
    expect(pass(one('span', 'overdue'), { span: { from: '2026-11-01', to: '2026-11-20' } })).toBe(false);
  });

  it('combines rules with all / any and never hides items because of a broken rule', () => {
    const two = (match: 'all' | 'any'): BoardFilter => ({ match, rules: [{ columnId: 'st', op: 'any_of', value: ['open'] }, { columnId: 'cost', op: 'gt', value: 100 }] });
    expect(pass(two('all'), { st: 'open', cost: 50 })).toBe(false);
    expect(pass(two('any'), { st: 'open', cost: 50 })).toBe(true);
    expect(pass(two('any'), { st: 'done', cost: 50 })).toBe(false);
    expect(matchesBoardFilter(undefined, mk({}), cols, '2026-11-12')).toBe(true);
    expect(pass({ match: 'all', rules: [] }, {})).toBe(true);
    expect(pass(one('deleted-column', 'contains', 'x'), {})).toBe(true); // column no longer exists
    expect(pass(one('st', 'gt', 5), { st: 'open' })).toBe(true); // operator does not fit the type
    expect(pass(one('st', 'any_of', []), { st: 'done' })).toBe(true); // nothing chosen yet
    expect(filterOpsFor('checklist')).toEqual([]);
    expect(filterOpsFor('date')).toContain('overdue');
  });
});

describe('filters and formulas on the newer column types', () => {
  const c = (id: string, type: XCol['type'], settings: XCol['settings'] = {}): XCol => ({ id, boardId: 'b', title: id, type, settings, position: 0 });
  const cols = [c('h', 'hour'), c('w', 'week'), c('col', 'color'), c('v', 'vote'), c('born', 'created_at'), c('rel', 'relation'), c('mir', 'mirror'), c('f', 'files'), c('calc', 'formula', { formula: '{v} * 10 + {h}' }), c('age', 'formula', { formula: 'TODAY() - {born}' })];
  const item = (values: Record<string, unknown>): XItem => ({ id: 'i1', boardId: 'b', groupId: 'g', parentId: null, name: 'x', values: values as XItem['values'], position: 0, seq: 1, createdBy: null, createdAt: '2026-11-02T08:00:00.000Z', updatedAt: '' });
  const extras = { relations: { i1: { rel: [{ name: 'מנדף 3' }] } }, mirrors: { i1: { mir: ['tech@x.org'] } }, fileCounts: { i1: 2 } };
  const pass = (columnId: string, op: BoardFilter['rules'][number]['op'], value: BoardFilter['rules'][number]['value'], values: Record<string, unknown> = {}) =>
    matchesBoardFilter({ match: 'all', rules: [{ columnId, op, value }] }, item(values), cols, '2026-11-12', extras);

  it('filters by hour, week, colour, votes, creation date, connected items, mirrored values and file count', () => {
    expect(pass('h', 'gt', '08:00', { h: '08:30' })).toBe(true);
    expect(pass('h', 'lt', '08:00', { h: '08:30' })).toBe(false);
    expect(pass('h', 'eq', '8:30', { h: '08:30' })).toBe(true);
    expect(pass('h', 'empty', undefined, {})).toBe(true);
    expect(pass('h', 'gt', 'abc', { h: '08:30' })).toBe(true); // unfinished rule
    expect(pass('w', 'on', '2026-11-12', { w: '2026-11-08' })).toBe(true); // any day of that week
    expect(pass('w', 'on', '2026-11-15', { w: '2026-11-08' })).toBe(false);
    expect(pass('w', 'overdue', undefined, { w: '2026-11-01' })).toBe(true);
    expect(pass('col', 'any_of', ['teal'], { col: 'teal' })).toBe(true);
    expect(pass('col', 'none_of', ['teal'], { col: 'teal' })).toBe(false);
    expect(pass('v', 'gt', 1, { v: ['a', 'b'] })).toBe(true);
    expect(pass('v', 'eq', 0, {})).toBe(true);
    expect(pass('born', 'last_days', 14, {})).toBe(true);
    expect(pass('born', 'before', '2026-11-01', {})).toBe(false);
    expect(pass('rel', 'contains', 'מנדף', {})).toBe(true);
    expect(pass('rel', 'empty', undefined, {})).toBe(false);
    expect(pass('mir', 'contains', 'tech@', {})).toBe(true);
    expect(pass('mir', 'not_contains', 'tech@', {})).toBe(false);
    expect(pass('f', 'gt', 1, {})).toBe(true);
    expect(pass('f', 'eq', 2, {})).toBe(true);
    // tracked time is compared in hours; an item with nothing logged is "empty"
    const tcols = [c('t', 'time')];
    const tpass = (op: BoardFilter['rules'][number]['op'], value: number | undefined, seconds: number | undefined) =>
      matchesBoardFilter({ match: 'all', rules: [{ columnId: 't', op, value }] }, item({}), tcols, '2026-11-12', seconds === undefined ? {} : { timeTotals: { i1: { seconds } } });
    expect(tpass('gt', 1, 5400)).toBe(true);
    expect(tpass('lt', 1, 5400)).toBe(false);
    expect(tpass('eq', 1.5, 5400)).toBe(true);
    expect(tpass('empty', undefined, undefined)).toBe(true);
    expect(tpass('not_empty', undefined, 60)).toBe(true);
    expect(tpass('gt', 0, undefined)).toBe(false);
  });

  it('formulas read votes, hours (as minutes) and the creation date', () => {
    const run = (id: string, values: Record<string, unknown>) => evaluateFormula(cols.find((x) => x.id === id)!, item(values), cols, '2026-11-12');
    expect(run('calc', { v: ['a', 'b'], h: '01:30' })).toBe(110); // 2 votes * 10 + 90 minutes
    expect(run('age', {})).toBe(10); // days since it was created
    expect(validateFormula('{v} + {h} + {born}', cols)).toBeNull();
    expect(validateFormula('{rel}', cols)).toBeTruthy(); // connected items are not a value
  });
});

describe('rule message placeholders', () => {
  const fields: Record<string, string> = { 'שם הפריט': 'מעקה', 'תאריך יעד': '01/12/2026', ריק: '' };
  const r = (m: string, max?: number) => renderRuleMessage(m, (n) => fields[n], max);
  it('fills known fields, keeps unknown ones visible, and stays plain text', () => {
    expect(r('נסגר: {שם הפריט} עד { תאריך יעד }')).toBe('נסגר: מעקה עד 01/12/2026');
    expect(r('{לא קיים} {שם הפריט}')).toBe('{לא קיים} מעקה');
    expect(r('ערך: {ריק}')).toBe('ערך: —');
    expect(r('בלי שדות')).toBe('בלי שדות');
    expect(r('{} {{שם הפריט}} {שם\nהפריט}')).toBe('{} {מעקה} {שם\nהפריט}');
    expect(r('{שם הפריט}'.repeat(40), 20)).toHaveLength(20);
    expect(r('{שם הפריט}'.repeat(40), 20).endsWith('…')).toBe(true);
  });
});
