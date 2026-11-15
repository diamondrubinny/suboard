/**
 * Turns a spreadsheet (rows of cells, already read in the browser) into the outline of a new board:
 * a title, groups, columns with a guessed type, and the item rows of each group.
 *
 * Two layouts are understood:
 *  - a plain table: one header row, then one item per row;
 *  - a sectioned export, as work-management tools write it: an optional title row, then for each
 *    group a row with the group's name, the header row again, and the group's items. Blocks of
 *    sub-items (a "Subitems" header followed by rows without a name in the first cell) are skipped
 *    and counted.
 * Nothing here is trusted: the result is shown to the person for review, and every value is
 * validated again by the server when the board is created.
 */
export type ImportColumnType = 'text' | 'long_text' | 'number' | 'date' | 'checkbox' | 'status';

export interface ImportedColumn {
  /** Index of the column in the sheet. */
  index: number;
  title: string;
  type: ImportColumnType;
  /** For "status": the distinct labels, in order of first appearance. */
  options?: string[];
}
export interface ImportedGroup {
  name: string;
  rows: unknown[][];
}
export interface SheetAnalysis {
  title: string | null;
  /** Which column of the sheet holds the item's name, and its header. */
  nameIndex: number;
  nameHeader: string;
  columns: ImportedColumn[];
  groups: ImportedGroup[];
  itemCount: number;
  /** Rows without a name in the first cell. */
  skippedRows: number;
  /** Rows that belong to sub-item blocks (not imported). */
  subitemRows: number;
  warnings: string[];
}
export interface ImportLimits {
  maxColumns: number;
  maxGroups: number;
  maxItems: number;
  maxOptions: number;
  titleLength: number;
  groupLength: number;
}

const DATE_RE = /^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4})(\s.*)?$/;
const BOOL_RE = /^(כן|לא|true|false|v|✓|x|0|1)$/i;
const SUBITEMS_RE = /^(subitems?|sub-items?|תת[- ]?פריטים)$/i;
const NAME_RE = /^(name|item|task|שם|שם הפריט|פריט|משימה)$/i;
const GROUP_RE = /^(group|קבוצה)$/i;
const PARENT_RE = /^(parent|parent item|תת[- ]?פריט של)$/i;

/** A cell as text: dates become YYYY-MM-DD, everything else is trimmed. */
export function importCellText(v: unknown): string {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  return v === null || v === undefined ? '' : String(v).trim();
}

const filled = (row: unknown[]): number => row.reduce<number>((n, c) => n + (importCellText(c) ? 1 : 0), 0);
const keyOf = (row: unknown[]): string => row.map(importCellText).join('\u0001').replace(/\u0001+$/, '');

function guessType(values: unknown[], limits: ImportLimits): Pick<ImportedColumn, 'type' | 'options'> {
  const texts = values.map(importCellText).filter(Boolean);
  if (!texts.length) return { type: 'text' };
  if (values.every((v) => importCellText(v) === '' || v instanceof Date || DATE_RE.test(importCellText(v)))) return { type: 'date' };
  if (values.every((v) => importCellText(v) === '' || typeof v === 'number' || /^-?\d+([.,]\d+)?$/.test(importCellText(v)))) {
    // 0 / 1 only reads better as a checkbox
    return texts.every((t) => t === '0' || t === '1') ? { type: 'checkbox' } : { type: 'number' };
  }
  if (texts.every((t) => BOOL_RE.test(t))) return { type: 'checkbox' };
  if (texts.some((t) => t.length > 200 || t.includes('\n'))) return { type: 'long_text' };
  const distinct = [...new Set(texts)];
  // Few short labels that repeat: a status. Free text (mostly unique values) stays text.
  if (distinct.length <= Math.min(12, limits.maxOptions) && distinct.every((t) => t.length <= 40) && distinct.length < texts.length) {
    return { type: 'status', options: distinct };
  }
  return { type: 'text' };
}

export function analyzeSheet(rows: unknown[][], limits: ImportLimits): SheetAnalysis | { error: string } {
  const data = rows.map((r) => (Array.isArray(r) ? r : []));
  const headerAt = data.findIndex((r) => filled(r) >= 2);
  if (headerAt < 0) return { error: 'לא נמצאה שורת כותרות (שורה עם שתי עמודות לפחות).' };
  const header = data[headerAt]!;
  const headerKey = keyOf(header);
  const warnings: string[] = [];
  // Flat exports name their columns: the item's name is not always first, and the group / the
  // parent item can be columns of their own.
  const headerTexts = header.map(importCellText);
  const find = (re: RegExp) => headerTexts.findIndex((t) => re.test(t));
  const nameIndex = Math.max(0, find(NAME_RE));
  const groupIndex = find(GROUP_RE) === nameIndex ? -1 : find(GROUP_RE);
  const parentIndex = find(PARENT_RE) === nameIndex ? -1 : find(PARENT_RE);

  // Single-cell rows above the first header: a title, and (when there are two) the first group's name.
  const singles = data.slice(0, headerAt).filter((r) => filled(r) === 1).map((r) => importCellText(r.find((c) => importCellText(c)) ?? ''));
  const title = singles.length ? singles[0]! : null;
  let pendingGroup: string | null = singles.length >= 2 ? singles[singles.length - 1]! : null;

  const groups: ImportedGroup[] = [];
  const open = (name: string | null) => {
    groups.push({ name: (name ?? `קבוצה ${groups.length + 1}`).slice(0, limits.groupLength), rows: [] });
  };
  open(pendingGroup);
  pendingGroup = null;

  let skippedRows = 0;
  let subitemRows = 0;
  let inSubitems = false;
  for (let i = headerAt + 1; i < data.length; i++) {
    const row = data[i]!;
    const n = filled(row);
    if (n === 0) continue;
    if (keyOf(row) === headerKey) {
      // The header again: a new section. An empty first section (a title-only start) is reused.
      if (groups[groups.length - 1]!.rows.length === 0 && groups.length === 1 && pendingGroup) groups[0]!.name = pendingGroup.slice(0, limits.groupLength);
      else if (groups[groups.length - 1]!.rows.length > 0 || pendingGroup) open(pendingGroup);
      pendingGroup = null;
      inSubitems = false;
      continue;
    }
    const first = importCellText(row[0]);
    const firstFilled = importCellText(row.find((c) => importCellText(c)) ?? '');
    if (SUBITEMS_RE.test(firstFilled) && n >= 1 && (first === '' || SUBITEMS_RE.test(first))) {
      inSubitems = true;
      continue;
    }
    if (inSubitems) {
      if (first === '') {
        subitemRows++;
        continue;
      }
      inSubitems = false;
    }
    if (n === 1 && first) {
      // A lone cell: a group's name when the header follows it, otherwise an item that has only a name.
      const next = data.slice(i + 1).find((r) => filled(r) > 0);
      if (next && keyOf(next) === headerKey) {
        pendingGroup = first;
        continue;
      }
    }
    if (parentIndex >= 0 && importCellText(row[parentIndex])) {
      subitemRows++; // a row that names its parent item is a sub-item
      continue;
    }
    if (!importCellText(row[nameIndex])) {
      skippedRows++;
      continue;
    }
    groups[groups.length - 1]!.rows.push(row);
  }

  let kept = groups.filter((g) => g.rows.length > 0);
  if (!kept.length) return { error: 'לא נמצאו שורות עם שם בעמודה הראשונה.' };
  // One flat table with a "group" column: the groups come from that column, in order of appearance.
  const byColumn = kept.length === 1 && groupIndex >= 0 && kept[0]!.rows.some((r) => importCellText(r[groupIndex]));
  if (byColumn) {
    const map = new Map<string, unknown[][]>();
    for (const r of kept[0]!.rows) {
      const g = importCellText(r[groupIndex]).slice(0, limits.groupLength) || 'ללא קבוצה';
      (map.get(g) ?? map.set(g, []).get(g)!).push(r);
    }
    kept = [...map].map(([name, rows]) => ({ name, rows }));
  }
  if (kept.length > limits.maxGroups) {
    warnings.push(`בקובץ ${kept.length} קבוצות; יובאו ${limits.maxGroups} הראשונות.`);
    kept = kept.slice(0, limits.maxGroups);
  }
  let itemCount = kept.reduce((a, g) => a + g.rows.length, 0);
  if (itemCount > limits.maxItems) {
    warnings.push(`בקובץ ${itemCount} פריטים; יובאו ${limits.maxItems} הראשונים.`);
    let room = limits.maxItems;
    kept = kept
      .map((g) => {
        const rows = g.rows.slice(0, room);
        room -= rows.length;
        return { ...g, rows };
      })
      .filter((g) => g.rows.length > 0);
    itemCount = kept.reduce((a, g) => a + g.rows.length, 0);
  }

  const columns: ImportedColumn[] = [];
  const used = new Set<string>();
  let dropped = 0;
  for (let index = 0; index < header.length; index++) {
    const raw = importCellText(header[index]);
    if (index === nameIndex || index === parentIndex || (byColumn && index === groupIndex)) continue;
    if (!raw || SUBITEMS_RE.test(raw)) continue;
    const values = kept.flatMap((g) => g.rows.map((r) => r[index]));
    if (!values.some((v) => importCellText(v))) continue; // an empty column is not worth a column
    if (columns.length >= limits.maxColumns) {
      dropped++;
      continue;
    }
    let t = raw.slice(0, limits.titleLength);
    for (let k = 2; used.has(t); k++) t = `${raw.slice(0, limits.titleLength - 4)} (${k})`;
    used.add(t);
    columns.push({ index, title: t, ...guessType(values, limits) });
  }
  if (dropped) warnings.push(`${dropped} עמודות לא יובאו (מעבר למגבלת העמודות בלוח).`);
  if (subitemRows) warnings.push(`${subitemRows} שורות של תת-פריטים לא יובאו.`);
  if (skippedRows) warnings.push(`${skippedRows} שורות בלי שם פריט דולגו.`);

  return { title, nameIndex, nameHeader: importCellText(header[nameIndex]), columns, groups: kept, itemCount, skippedRows, subitemRows, warnings };
}
