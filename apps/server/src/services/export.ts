import { formatDateTimeHe, checklistStats, formatRisk, isDateRange, formatAutoId, formatDateHe, formatDateRangeHe, type CellValue, type Column, type Item } from '@suboard/shared';
import writeXlsxFile from 'write-excel-file/node';
import type { DB } from '../db/index.js';
import type { AccessService, Actor } from './access.js';
import type { AuditService } from './audit.js';
import type { BoardService } from './boards.js';

/**
 * Neutralises spreadsheet formula injection (CSV injection): values that a spreadsheet would
 * evaluate as a formula are prefixed with an apostrophe.
 */
export function csvSafe(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function csvField(value: string): string {
  const v = csvSafe(value);
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Human-readable text for a cell (labels instead of ids, Israeli dates, names instead of user ids). */
export function formatCell(c: Column, v: CellValue | undefined, item: Item, users: Map<string, string>): string {
  if (c.type === 'auto_id') return formatAutoId(item.seq, c.settings.prefix);
  if (c.type === 'created_by') return item.createdBy ? (users.get(item.createdBy) ?? '') : 'אוטומציה';
  if (c.type === 'updated_at') return formatDateTimeHe(item.updatedAt);
  if (v === undefined || v === null) return '';
  const label = (id: unknown) => c.settings.options?.find((o) => o.id === id)?.label ?? '';
  switch (c.type) {
    case 'status':
      return label(v);
    case 'tags':
      return Array.isArray(v) ? v.map(label).filter(Boolean).join('; ') : '';
    case 'person':
      return Array.isArray(v) ? (v as string[]).map((id) => users.get(id) ?? '').filter(Boolean).join('; ') : '';
    case 'date':
      return formatDateHe(String(v));
    case 'date_range':
      return isDateRange(v) ? formatDateRangeHe(v) : '';
    case 'checkbox':
      return v ? 'כן' : 'לא';
    case 'progress':
      return `${String(v)}%`;
    case 'risk':
      return formatRisk(v);
    case 'checklist': {
      const st = checklistStats(c, v);
      return `${st.pass} תקין, ${st.fail} לא תקין, ${st.na} לא רלוונטי, ${st.open} לא נבדק`;
    }
    default:
      return String(v);
  }
}

export class ExportService {
  constructor(
    private readonly db: DB,
    private readonly access: AccessService,
    private readonly boards: BoardService,
    private readonly audit: AuditService,
  ) {}

  /** Rows (header first) for a board, sorted by group then position; sub-items follow their parent. */
  private table(actor: Actor, boardId: string) {
    const board = this.boards.get(actor, boardId); // enforces viewer access
    const users = new Map((this.db.prepare('SELECT id, name FROM users').all() as { id: string; name: string }[]).map((u) => [u.id, u.name]));
    const groups = new Map(board.groups.map((g) => [g.id, g.name]));
    const groupOrder = new Map(board.groups.map((g, i) => [g.id, i]));
    const tops = board.items
      .filter((i) => !i.parentId)
      .sort((a, b) => (groupOrder.get(a.groupId) ?? 0) - (groupOrder.get(b.groupId) ?? 0) || a.position - b.position);
    const ordered: Item[] = [];
    for (const t of tops) ordered.push(t, ...board.items.filter((i) => i.parentId === t.id).sort((a, b) => a.position - b.position));
    const header = ['קבוצה', 'פריט', 'תת-פריט של', ...board.columns.map((c) => c.title), 'נוצר', 'עודכן'];
    const byId = new Map(board.items.map((i) => [i.id, i]));
    const rows = ordered.map((i) => [
      groups.get(i.groupId) ?? '',
      i.name,
      i.parentId ? (byId.get(i.parentId)?.name ?? '') : '',
      ...board.columns.map((c) => formatCell(c, i.values[c.id], i, users)),
      formatDateHe(i.createdAt.slice(0, 10)),
      formatDateHe(i.updatedAt.slice(0, 10)),
    ]);
    return { board, header, rows };
  }

  private filename(name: string, ext: string) {
    return `${name}-${new Date().toISOString().slice(0, 10)}.${ext}`;
  }

  /** CSV with UTF-8 BOM (so Excel shows Hebrew correctly). */
  boardCsv(actor: Actor, boardId: string, ip: string): { filename: string; csv: string } {
    const { board, header, rows } = this.table(actor, boardId);
    const csv = '﻿' + [header, ...rows].map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n';
    this.audit.log('data_export', { userId: actor.id, ip, meta: { boardId, rows: rows.length, format: 'csv' } });
    return { filename: this.filename(board.name, 'csv'), csv };
  }

  /** Native .xlsx, right-to-left sheet. Every cell is written as text, never as a formula. */
  async boardXlsx(actor: Actor, boardId: string, ip: string): Promise<{ filename: string; data: Buffer }> {
    const { board, header, rows } = this.table(actor, boardId);
    const sheet = [
      header.map((value) => ({ value, fontWeight: 'bold' as const })),
      ...rows.map((r) => r.map((value) => ({ value, type: String }))),
    ];
    const data = await writeXlsxFile(sheet, {
      sheet: board.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Board',
      rightToLeft: true,
      stickyRowsCount: 1,
      columns: header.map((h, i) => ({ width: i === 1 ? 40 : Math.min(30, Math.max(12, h.length + 4)) })),
    }).toBuffer();
    this.audit.log('data_export', { userId: actor.id, ip, meta: { boardId, rows: rows.length, format: 'xlsx' } });
    return { filename: this.filename(board.name, 'xlsx'), data };
  }
}
