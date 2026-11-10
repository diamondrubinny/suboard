import { isDateRange, addDaysIso, findDueColumn, findPrimaryStatusColumn, isItemDone, type Column, type Item } from '@suboard/shared';
import type { AppConfig } from '../config.js';
import type { DB } from '../db/index.js';
import { badRequest } from '../lib/errors.js';
import type { AccessService, Actor } from './access.js';
import type { AuditService } from './audit.js';
import type { BoardService } from './boards.js';
import { toItem, type ItemRow } from './mappers.js';

/** RFC 5545 TEXT escaping: backslash, semicolon, comma and newlines. Control characters are dropped. */
export function icsText(value: string): string {
  return value
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Folds a content line at 75 octets (UTF-8), never splitting a multi-byte character. */
export function icsFold(line: string): string {
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const len = Buffer.byteLength(ch);
    const limit = out.length === 0 ? 75 : 74; // continuation lines start with a space
    if (bytes + len > limit) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += len;
  }
  out.push(current);
  return out.join('\r\n ');
}

const compact = (iso: string) => iso.replace(/-/g, '');

interface IcsEvent {
  uid: string;
  summary: string;
  start: string; // YYYY-MM-DD (inclusive)
  end: string; // YYYY-MM-DD (inclusive)
  url: string;
}

/**
 * iCalendar (.ics) export of dated items, for Outlook / Google Calendar import.
 * Only the item name and a link are included — no free-text content.
 * There is deliberately no subscription URL: it would need a token that works without signing in.
 */
export class CalendarService {
  constructor(
    private readonly db: DB,
    private readonly config: AppConfig,
    private readonly access: AccessService,
    private readonly boards: BoardService,
    private readonly audit: AuditService,
  ) {}

  private build(calName: string, events: IcsEvent[]): string {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//SUBoard//Safety Unit//HE',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-CALNAME:${icsText(calName)}`,
    ];
    for (const e of events) {
      lines.push(
        'BEGIN:VEVENT',
        `UID:${e.uid}@suboard`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${compact(e.start)}`,
        `DTEND;VALUE=DATE:${compact(addDaysIso(e.end, 1))}`, // DTEND is exclusive for all-day events
        `SUMMARY:${icsText(e.summary)}`,
        `URL:${e.url}`, // URI value (from PUBLIC_URL + ids), not TEXT
        `DESCRIPTION:${icsText(e.url)}`,
        'TRANSP:TRANSPARENT',
        'END:VEVENT',
      );
    }
    lines.push('END:VCALENDAR');
    return lines.map(icsFold).join('\r\n') + '\r\n';
  }

  private eventFor(item: Item, col: Column, boardId: string): IcsEvent | null {
    const v = item.values[col.id];
    const url = `${this.config.publicUrl}/boards/${boardId}?item=${item.id}`;
    if (col.type === 'date' && typeof v === 'string') return { uid: `${item.id}-${col.id}`, summary: item.name, start: v, end: v, url };
    if (col.type === 'date_range' && isDateRange(v)) {
      return { uid: `${item.id}-${col.id}`, summary: item.name, start: v.from, end: v.to, url };
    }
    return null;
  }

  private filename(name: string) {
    return `${name.replace(/[\\/:*?"<>|]/g, ' ').trim() || 'calendar'}.ics`;
  }

  /** One board, by a chosen date / date-range column (default: the due column, else the first date column). */
  board(actor: Actor, boardId: string, columnId: string | undefined, ip: string): { filename: string; ics: string } {
    const board = this.boards.get(actor, boardId); // viewer access
    const dated = board.columns.filter((c) => c.type === 'date' || c.type === 'date_range');
    const col = columnId ? dated.find((c) => c.id === columnId) : (findDueColumn(board.columns) ?? dated[0]);
    if (!col) throw badRequest('אין בלוח עמודת תאריך', { columnId: 'עמודה לא תקינה' });
    const events = board.items.map((i) => this.eventFor(i, col, boardId)).filter((e): e is IcsEvent => e !== null);
    this.audit.log('data_export', { userId: actor.id, ip, meta: { boardId, rows: events.length, format: 'ics' } });
    return { filename: this.filename(board.name), ics: this.build(`${board.name} — ${col.title}`, events) };
  }

  /** The actor's open, assigned items with a due date, from every board they can see. */
  mine(actor: Actor, ip: string): { filename: string; ics: string } {
    const events: IcsEvent[] = [];
    for (const boardId of this.access.accessibleBoardIds(actor)) {
      const columns = this.boards.columns(boardId);
      const due = findDueColumn(columns) ?? columns.find((c) => c.type === 'date');
      if (!due) continue;
      const status = findPrimaryStatusColumn(columns);
      const persons = columns.filter((c) => c.type === 'person');
      const rows = this.db.prepare('SELECT * FROM items WHERE board_id = ? AND deleted_at IS NULL').all(boardId) as ItemRow[];
      for (const item of rows.map(toItem)) {
        if (isItemDone(item, status)) continue;
        if (!persons.some((c) => Array.isArray(item.values[c.id]) && (item.values[c.id] as string[]).includes(actor.id))) continue;
        const e = this.eventFor(item, due, boardId);
        if (e) events.push(e);
      }
    }
    this.audit.log('data_export', { userId: actor.id, ip, meta: { rows: events.length, format: 'ics', scope: 'mine' } });
    return { filename: 'SUBoard-my-items.ics', ics: this.build('SUBoard — הפריטים שלי', events) };
  }
}
