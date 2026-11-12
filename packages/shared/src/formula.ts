import { PALETTE } from './constants.js';
import type { Column, CellValue, Item } from './types.js';

/**
 * Formula columns: a small, safe expression language (no eval, no access to anything but the
 * item's own cells). Stored formulas refer to columns by id — `{<column id>}`; the editor shows
 * and accepts column titles — `{כותרת}`. Templates use positions — `{#3}`.
 *
 *   {עלות} * {כמות}          IF({סטטוס} = "בוצע", 0, DAYS({תאריך יעד}, TODAY()))
 *
 * Dates are day numbers, so subtracting two dates gives days. An empty cell is "blank": arithmetic
 * with a blank gives a blank (shown as "—"), comparisons with a blank are false.
 */
export type FormulaValue = number | string | boolean | null;

export const FORMULA_MAX_LENGTH = 500;
const MAX_NODES = 200;
const MAX_DEPTH = 30;

type Node =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'ref'; id: string }
  | { k: 'neg'; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'call'; fn: string; args: Node[] };

export class FormulaError extends Error {}

/** name → [min args, max args] */
export const FORMULA_FUNCTIONS: Record<string, [number, number]> = {
  IF: [3, 3],
  AND: [1, 20],
  OR: [1, 20],
  NOT: [1, 1],
  ROUND: [1, 2],
  ABS: [1, 1],
  MIN: [1, 20],
  MAX: [1, 20],
  SUM: [1, 20],
  AVG: [1, 20],
  DAYS: [2, 2],
  TODAY: [0, 0],
  EMPTY: [1, 1],
  CONCAT: [1, 20],
};

type Tok = { t: 'num'; v: number } | { t: 'str'; v: string } | { t: 'ref'; v: string } | { t: 'id'; v: string } | { t: 'op'; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i++;
    } else if (/[0-9.]/.test(ch)) {
      const m = /^(\d+(\.\d+)?|\.\d+)/.exec(src.slice(i));
      if (!m) throw new FormulaError('מספר לא תקין');
      out.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
    } else if (ch === '"') {
      const end = src.indexOf('"', i + 1);
      if (end < 0) throw new FormulaError('חסרות מירכאות סוגרות');
      out.push({ t: 'str', v: src.slice(i + 1, end) });
      i = end + 1;
    } else if (ch === '{') {
      const end = src.indexOf('}', i + 1);
      if (end < 0) throw new FormulaError('חסר סוגר } אחרי שם עמודה');
      const name = src.slice(i + 1, end).trim();
      if (!name || name.includes('{')) throw new FormulaError('שם עמודה ריק או לא תקין');
      out.push({ t: 'ref', v: name });
      i = end + 1;
    } else if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_]+/.exec(src.slice(i))!;
      out.push({ t: 'id', v: m[0].toUpperCase() });
      i += m[0].length;
    } else {
      const two = src.slice(i, i + 2);
      if (['>=', '<=', '!=', '<>'].includes(two)) {
        out.push({ t: 'op', v: two === '<>' ? '!=' : two });
        i += 2;
      } else if ('+-*/(),<>=&'.includes(ch)) {
        out.push({ t: 'op', v: ch });
        i++;
      } else {
        throw new FormulaError(`תו לא מוכר: ${ch}`);
      }
    }
  }
  return out;
}

function parse(src: string): Node {
  if (src.length > FORMULA_MAX_LENGTH) throw new FormulaError(`נוסחה ארוכה מדי (עד ${FORMULA_MAX_LENGTH} תווים)`);
  const toks = tokenize(src);
  if (!toks.length) throw new FormulaError('הנוסחה ריקה');
  let pos = 0;
  let nodes = 0;
  const peek = () => toks[pos];
  const isOp = (v: string) => peek()?.t === 'op' && peek()!.v === v;
  const node = <T extends Node>(n: T): T => {
    if (++nodes > MAX_NODES) throw new FormulaError('נוסחה מורכבת מדי');
    return n;
  };
  const guard = (depth: number) => {
    if (depth > MAX_DEPTH) throw new FormulaError('יותר מדי סוגריים מקוננים');
  };

  const primary = (d: number): Node => {
    guard(d);
    const t = toks[pos++];
    if (!t) throw new FormulaError('הנוסחה נקטעה באמצע');
    if (t.t === 'num') return node({ k: 'num', v: t.v });
    if (t.t === 'str') return node({ k: 'str', v: t.v });
    if (t.t === 'ref') return node({ k: 'ref', id: t.v });
    if (t.t === 'op' && t.v === '-') return node({ k: 'neg', a: primary(d + 1) });
    if (t.t === 'op' && t.v === '(') {
      const e = comparison(d + 1);
      if (!isOp(')')) throw new FormulaError('חסר סוגר )');
      pos++;
      return e;
    }
    if (t.t === 'id') {
      const spec = FORMULA_FUNCTIONS[t.v];
      if (!spec) throw new FormulaError(`פונקציה לא מוכרת: ${t.v}`);
      if (!isOp('(')) throw new FormulaError(`אחרי ${t.v} צריך לבוא (`);
      pos++;
      const args: Node[] = [];
      if (!isOp(')')) {
        do args.push(comparison(d + 1));
        while (isOp(',') && ++pos);
      }
      if (!isOp(')')) throw new FormulaError(`חסר סוגר ) אחרי ${t.v}`);
      pos++;
      if (args.length < spec[0] || args.length > spec[1]) {
        throw new FormulaError(spec[0] === spec[1] ? `${t.v} מקבלת ${spec[0]} ערכים` : `${t.v} מקבלת בין ${spec[0]} ל-${spec[1]} ערכים`);
      }
      return node({ k: 'call', fn: t.v, args });
    }
    throw new FormulaError(`לא צפוי: ${t.v}`);
  };
  const binary = (next: (d: number) => Node, ops: string[]) => (d: number): Node => {
    guard(d);
    let a = next(d + 1);
    while (peek()?.t === 'op' && ops.includes(String(peek()!.v))) {
      const op = toks[pos++]!.v as string;
      a = node({ k: 'bin', op, a, b: next(d + 1) });
    }
    return a;
  };
  const product = binary(primary, ['*', '/']);
  const sum = binary(product, ['+', '-', '&']);
  const comparison: (d: number) => Node = binary(sum, ['>', '<', '>=', '<=', '=', '!=']);

  const tree = comparison(0);
  if (pos < toks.length) throw new FormulaError(`לא צפוי: ${String(toks[pos]!.v)}`);
  return tree;
}

const refsOf = (n: Node, out: Set<string> = new Set()): Set<string> => {
  if (n.k === 'ref') out.add(n.id);
  else if (n.k === 'neg') refsOf(n.a, out);
  else if (n.k === 'bin') (refsOf(n.a, out), refsOf(n.b, out));
  else if (n.k === 'call') n.args.forEach((a) => refsOf(a, out));
  return out;
};

const num = (v: FormulaValue): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'boolean' ? (v ? 1 : 0) : null);
const truthy = (v: FormulaValue): boolean => v === true || (typeof v === 'number' && v !== 0) || (typeof v === 'string' && v !== '');
const text = (v: FormulaValue): string => (v === null ? '' : typeof v === 'boolean' ? (v ? 'כן' : 'לא') : typeof v === 'number' ? formatFormulaNumber(v) : v);

function evalNode(n: Node, ref: (id: string) => FormulaValue, today: number): FormulaValue {
  switch (n.k) {
    case 'num':
    case 'str':
      return n.v;
    case 'ref':
      return ref(n.id);
    case 'neg': {
      const a = num(evalNode(n.a, ref, today));
      return a === null ? null : -a;
    }
    case 'bin': {
      const a = evalNode(n.a, ref, today);
      const b = evalNode(n.b, ref, today);
      if (n.op === '&') return text(a) + text(b);
      if (['+', '-', '*', '/'].includes(n.op)) {
        const x = num(a);
        const y = num(b);
        if (x === null || y === null) return null;
        if (n.op === '/') return y === 0 ? null : x / y;
        return n.op === '+' ? x + y : n.op === '-' ? x - y : x * y;
      }
      if (a === null || b === null) return false;
      if (n.op === '=' || n.op === '!=') {
        const same = typeof a === 'string' || typeof b === 'string' ? text(a).trim() === text(b).trim() : num(a) === num(b);
        return n.op === '=' ? same : !same;
      }
      const x = num(a);
      const y = num(b);
      if (x === null || y === null) return false;
      return n.op === '>' ? x > y : n.op === '<' ? x < y : n.op === '>=' ? x >= y : x <= y;
    }
    case 'call': {
      const arg = (i: number) => evalNode(n.args[i]!, ref, today);
      const nums = () => n.args.map((_, i) => num(arg(i))).filter((x): x is number => x !== null);
      switch (n.fn) {
        case 'IF':
          return truthy(arg(0)) ? arg(1) : arg(2);
        case 'AND':
          return n.args.every((_, i) => truthy(arg(i)));
        case 'OR':
          return n.args.some((_, i) => truthy(arg(i)));
        case 'NOT':
          return !truthy(arg(0));
        case 'EMPTY': {
          const v = arg(0);
          return v === null || v === '';
        }
        case 'ROUND': {
          const x = num(arg(0));
          const d = n.args.length > 1 ? num(arg(1)) : 0;
          if (x === null || d === null) return null;
          const f = 10 ** Math.max(0, Math.min(6, Math.trunc(d)));
          return Math.round(x * f) / f;
        }
        case 'ABS': {
          const x = num(arg(0));
          return x === null ? null : Math.abs(x);
        }
        case 'MIN':
        case 'MAX':
        case 'SUM':
        case 'AVG': {
          const xs = nums(); // blanks are skipped
          if (!xs.length) return n.fn === 'SUM' ? 0 : null;
          const s = xs.reduce((p, q) => p + q, 0);
          return n.fn === 'MIN' ? Math.min(...xs) : n.fn === 'MAX' ? Math.max(...xs) : n.fn === 'SUM' ? s : s / xs.length;
        }
        case 'DAYS': {
          const x = num(arg(0));
          const y = num(arg(1));
          return x === null || y === null ? null : x - y;
        }
        case 'TODAY':
          return today;
        case 'CONCAT':
          return n.args.map((_, i) => text(arg(i))).join('');
        default:
          return null;
      }
    }
  }
}

/** Whole days since 1970-01-01 for an ISO date (YYYY-MM-DD). */
export function dayNumber(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000) : null;
}

/** Column types a formula may read. Formula columns cannot read other formula columns (no cycles). */
export const FORMULA_SOURCE_TYPES = ['number', 'progress', 'rating', 'date', 'date_range', 'checkbox', 'status', 'tags', 'text', 'long_text', 'link', 'email', 'phone', 'risk', 'auto_id', 'hour', 'week', 'vote', 'color', 'created_at'] as const;

function cellAsFormulaValue(c: Column, v: CellValue | undefined, item: Pick<Item, 'seq'> & { createdAt?: string }): FormulaValue {
  if (c.type === 'auto_id') return item.seq;
  // A creation date is a day number like every other date; votes count as a number.
  if (c.type === 'created_at') return item.createdAt ? dayNumber(item.createdAt.slice(0, 10)) : null;
  if (c.type === 'vote') return Array.isArray(v) ? v.length : 0;
  if (v === undefined || v === null) return null;
  switch (c.type) {
    case 'number':
    case 'progress':
    case 'rating':
      return typeof v === 'number' ? v : null;
    case 'checkbox':
      return v === true;
    case 'date':
    case 'week':
      return typeof v === 'string' ? dayNumber(v) : null;
    case 'hour': {
      // Minutes since midnight, so two hours can be subtracted.
      const m = /^(\d{2}):(\d{2})$/.exec(String(v));
      return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    }
    case 'color':
      return typeof v === 'string' ? (PALETTE[v as keyof typeof PALETTE]?.label ?? null) : null;
    case 'date_range':
      return typeof v === 'object' && !Array.isArray(v) && typeof (v as { from?: unknown }).from === 'string' ? dayNumber((v as { from: string }).from) : null;
    case 'status':
      return c.settings.options?.find((o) => o.id === v)?.label ?? null;
    case 'tags':
      return Array.isArray(v) ? v.map((id) => c.settings.options?.find((o) => o.id === id)?.label).filter(Boolean).join(', ') : null;
    case 'risk': {
      const r = v as { l?: unknown; s?: unknown };
      return typeof r.l === 'number' && typeof r.s === 'number' ? r.l * r.s : null;
    }
    case 'text':
    case 'long_text':
    case 'link':
    case 'email':
    case 'phone':
      return typeof v === 'string' ? v : null;
    default:
      return null;
  }
}

/** `null` when the stored formula is valid for this board; otherwise a message for the user. */
export function validateFormula(stored: string, columns: Column[]): string | null {
  try {
    const tree = parse(stored);
    for (const id of refsOf(tree)) {
      const c = columns.find((x) => x.id === id);
      if (!c) return 'הנוסחה מפנה לעמודה שאינה קיימת בלוח';
      if (c.type === 'formula') return `עמודת נוסחה אינה יכולה להסתמך על עמודת נוסחה אחרת ("${c.title}")`;
      if (!(FORMULA_SOURCE_TYPES as readonly string[]).includes(c.type)) return `אי אפשר לחשב על העמודה "${c.title}"`;
    }
    return null;
  } catch (e) {
    return e instanceof FormulaError ? e.message : 'נוסחה לא תקינה';
  }
}

const cache = new Map<string, Node | null>();
function compiled(stored: string): Node | null {
  if (!cache.has(stored)) {
    if (cache.size > 500) cache.clear();
    try {
      cache.set(stored, parse(stored));
    } catch {
      cache.set(stored, null);
    }
  }
  return cache.get(stored)!;
}

/** The value of a formula column for one item. Never throws: a broken formula gives a blank. */
export function evaluateFormula(column: Column, item: Pick<Item, 'values' | 'seq'> & { createdAt?: string }, columns: Column[], todayIsoDate: string): FormulaValue {
  const tree = column.settings.formula ? compiled(column.settings.formula) : null;
  if (!tree) return null;
  const v = evalNode(
    tree,
    (id) => {
      const c = columns.find((x) => x.id === id);
      return c && c.type !== 'formula' ? cellAsFormulaValue(c, item.values[c.id], item) : null;
    },
    dayNumber(todayIsoDate) ?? 0,
  );
  return typeof v === 'number' && !Number.isFinite(v) ? null : v;
}

export function formatFormulaNumber(n: number): string {
  return (Math.round(n * 100) / 100).toLocaleString('he-IL', { maximumFractionDigits: 2 });
}
export function formatFormulaValue(v: FormulaValue): string {
  return v === null ? '' : text(v);
}

/** Rewrites every `{ref}` in a formula; `map` returns the replacement ref or `null` when unknown. */
export function mapFormulaRefs(formula: string, map: (ref: string) => string | null): { formula: string; unknown: string[] } {
  const unknown: string[] = [];
  let inString = false;
  let out = '';
  for (let i = 0; i < formula.length; i++) {
    const ch = formula[i]!;
    if (ch === '"') inString = !inString;
    if (ch === '{' && !inString) {
      const end = formula.indexOf('}', i + 1);
      if (end > 0) {
        const ref = formula.slice(i + 1, end).trim();
        const to = map(ref);
        if (to === null) unknown.push(ref);
        out += `{${to ?? ref}}`;
        i = end;
        continue;
      }
    }
    out += ch;
  }
  return { formula: out, unknown };
}

/** Stored (`{id}`) → what the editor shows (`{title}`). Deleted columns show as `{?}`. */
export const formulaToDisplay = (stored: string, columns: Column[]): string => mapFormulaRefs(stored, (id) => columns.find((c) => c.id === id)?.title ?? '?').formula;

/** Editor text (`{title}`) → stored (`{id}`); `unknown` lists titles that match no column. */
export const formulaToStored = (shown: string, columns: Column[]) => mapFormulaRefs(shown, (title) => columns.find((c) => c.title.trim() === title)?.id ?? null);
