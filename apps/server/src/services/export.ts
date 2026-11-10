import { formatDateHe, type CellValue, type Column } from '@suboard/shared';
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

export class ExportService {
  constructor(
    private readonly db: DB,
    private readonly access: AccessService,
    private readonly boards: BoardService,
    private readonly audit: AuditService,
  ) {}

  /** CSV with UTF-8 BOM (so Excel shows Hebrew correctly), human-readable labels and dates. */
  boardCsv(actor: Actor, boardId: string, ip: string): { filename: string; csv: string } {
    const board = this.boards.get(actor, boardId); // enforces viewer access
    const users = new Map(
      (this.db.prepare('SELECT id, name FROM users').all() as { id: string; name: string }[]).map((u) => [u.id, u.name]),
    );
    const groups = new Map(board.groups.map((g) => [g.id, g.name]));
    const format = (c: Column, v: CellValue | undefined): string => {
      if (v === undefined || v === null) return '';
      switch (c.type) {
        case 'status':
          return c.settings.options?.find((o) => o.id === v)?.label ?? '';
        case 'person':
          return Array.isArray(v) ? v.map((id) => users.get(id) ?? '').filter(Boolean).join('; ') : '';
        case 'date':
          return formatDateHe(String(v));
        case 'checkbox':
          return v ? 'כן' : 'לא';
        default:
          return String(v);
      }
    };

    const header = ['קבוצה', 'פריט', ...board.columns.map((c) => c.title), 'נוצר', 'עודכן'];
    const groupOrder = new Map(board.groups.map((g, i) => [g.id, i]));
    const items = [...board.items].sort((a, b) => (groupOrder.get(a.groupId) ?? 0) - (groupOrder.get(b.groupId) ?? 0) || a.position - b.position);
    const lines = [header, ...items.map((i) => [groups.get(i.groupId) ?? '', i.name, ...board.columns.map((c) => format(c, i.values[c.id])), i.createdAt.slice(0, 10), i.updatedAt.slice(0, 10)])];
    const csv = '﻿' + lines.map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n';

    this.audit.log('data_export', { userId: actor.id, ip, meta: { boardId, rows: items.length, format: 'csv' } });
    const date = new Date().toISOString().slice(0, 10);
    return { filename: `${board.name}-${date}.csv`, csv };
  }
}
