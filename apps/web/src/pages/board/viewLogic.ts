import { findPrimaryStatusColumn, type BoardDetail, type CellValue, type Column, type DirectoryUser, type Item, type ViewConfig } from '@suboard/shared';

/** Items matching the view's search / status / "mine" filters (parents and sub-items alike). */
export function filterItems(board: BoardDetail, config: ViewConfig, userId: string | undefined): Item[] {
  const q = (config.search ?? '').trim().toLowerCase();
  const textCols = board.columns.filter((c) => ['text', 'long_text', 'link', 'email', 'phone'].includes(c.type));
  const personCols = board.columns.filter((c) => c.type === 'person');
  const statusCol = findPrimaryStatusColumn(board.columns);
  return board.items.filter((i) => {
    if (q && !i.name.toLowerCase().includes(q) && !textCols.some((c) => String(i.values[c.id] ?? '').toLowerCase().includes(q))) return false;
    if (config.mine && !personCols.some((c) => Array.isArray(i.values[c.id]) && (i.values[c.id] as string[]).includes(userId ?? ''))) return false;
    if (config.statusFilter && statusCol && i.values[statusCol.id] !== config.statusFilter) return false;
    return true;
  });
}

/** A comparable key for a cell: labels by option order, people by name, ranges by start date. */
function sortKey(c: Column | undefined, v: CellValue | undefined, item: Item, users: DirectoryUser[]): string | number | null {
  if (!c) return null;
  if (c.type === 'auto_id') return item.seq;
  if (v === undefined || v === null) return null;
  switch (c.type) {
    case 'status': {
      const idx = c.settings.options?.findIndex((o) => o.id === v) ?? -1;
      return idx < 0 ? null : idx;
    }
    case 'tags':
      return Array.isArray(v) ? (c.settings.options?.find((o) => o.id === v[0])?.label ?? null) : null;
    case 'person':
      return Array.isArray(v) ? (users.find((u) => u.id === v[0])?.name ?? null) : null;
    case 'date_range':
      return typeof v === 'object' && !Array.isArray(v) ? v.from : null;
    case 'checkbox':
      return v ? 1 : 0;
    default:
      return typeof v === 'number' ? v : String(v);
  }
}

const collator = new Intl.Collator('he', { numeric: true, sensitivity: 'base' });

/** Sorts by the view's sort (empty values always last), else by manual position. */
export function sortItems(items: Item[], columns: Column[], sort: ViewConfig['sort'], users: DirectoryUser[]): Item[] {
  const byPos = [...items].sort((a, b) => a.position - b.position);
  if (!sort) return byPos;
  const col = columns.find((c) => c.id === sort.by);
  const key = (i: Item) => (sort.by === 'name' ? i.name : sort.by === 'seq' ? i.seq : sortKey(col, i.values[sort.by], i, users));
  const dir = sort.dir === 'asc' ? 1 : -1;
  return byPos.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka === null && kb === null) return 0;
    if (ka === null) return 1;
    if (kb === null) return -1;
    const cmp = typeof ka === 'number' && typeof kb === 'number' ? ka - kb : collator.compare(String(ka), String(kb));
    return cmp * dir;
  });
}
