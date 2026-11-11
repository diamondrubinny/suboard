import type { Column, DirectoryUser } from '@suboard/shared';

/** Reads a CSV or XLSX file IN THE BROWSER into rows of cells (the server never parses the file). */
export async function readSpreadsheet(file: File): Promise<unknown[][]> {
  const name = file.name.toLowerCase();
  if (file.size > 5 * 1024 * 1024) throw new Error('הקובץ גדול מ-5MB');
  if (name.endsWith('.csv')) {
    const Papa = (await import('papaparse')).default;
    const text = await file.text();
    const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), { skipEmptyLines: 'greedy' });
    return parsed.data;
  }
  if (name.endsWith('.xlsx')) {
    const { readSheet } = await import('read-excel-file/browser');
    return (await readSheet(file)) as unknown[][]; // first sheet
  }
  throw new Error('יש לבחור קובץ CSV או XLSX');
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Accepts Date objects, YYYY-MM-DD, DD/MM/YYYY, D.M.YY; returns ISO date or null. */
export function toIsoDate(raw: unknown): string | null {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return `${raw.getFullYear()}-${pad(raw.getMonth() + 1)}-${pad(raw.getDate())}`;
  const s = String(raw ?? '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(s);
  if (m) {
    const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${y}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
  }
  return null;
}

/**
 * Converts a spreadsheet cell to the API value for a column. Unknown labels / people / dates are
 * passed through as-is so the server rejects that row with a clear per-row error.
 */
export function convertCell(col: Column, raw: unknown, members: DirectoryUser[]): unknown {
  if (raw === null || raw === undefined || String(raw).trim() === '') return undefined;
  const s = String(raw).trim();
  const byLabel = (label: string) => col.settings.options?.find((o) => o.label.trim() === label.trim())?.id ?? label;
  const list = (v: string) => v.split(/[;,]/).map((x) => x.trim()).filter(Boolean);
  switch (col.type) {
    case 'status':
      return byLabel(s);
    case 'tags':
      return list(s).map(byLabel);
    case 'person':
      return list(s).map((n) => members.find((u) => u.name === n)?.id ?? n);
    case 'date':
      return toIsoDate(raw) ?? s;
    case 'date_range': {
      const [a, b] = s.split(/\s+[–-]\s+/);
      const from = toIsoDate(a);
      const to = toIsoDate(b);
      return from && to ? { from, to } : s;
    }
    case 'number':
    case 'progress':
    case 'rating': {
      const n = typeof raw === 'number' ? raw : Number(s.replace('%', '').replace(',', '.'));
      return Number.isFinite(n) ? (col.type === 'number' ? n : Math.round(n)) : s;
    }
    case 'checkbox':
      return /^(כן|true|1|v|✓|x)$/i.test(s) ? true : /^(לא|false|0)$/i.test(s) ? false : s;
    case 'auto_id':
    case 'created_by':
    case 'updated_at':
      return undefined;
    default:
      return s;
  }
}
