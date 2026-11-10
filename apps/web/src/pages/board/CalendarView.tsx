import { isDateRange, findPrimaryStatusColumn, isOverdue, todayIso, type BoardDetail, type Item } from '@suboard/shared';
import { useState } from 'react';
import { EmptyState } from '../../components/Feedback';
import { colorStyle } from '../../components/StatusPill';

const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const MAX_PER_DAY = 4;

const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/**
 * Month calendar by a date (or date-range start) column. A real table (days × weeks) with a caption,
 * so screen readers announce "Tuesday, 12"; items are buttons that open the drawer.
 */
export function CalendarView({
  board,
  items,
  onOpenItem,
  columnId,
  onColumnChange,
}: {
  board: BoardDetail;
  items: Item[];
  onOpenItem: (id: string) => void;
  columnId?: string;
  onColumnChange: (id: string) => void;
}) {
  const dateCols = board.columns.filter((c) => c.type === 'date' || c.type === 'date_range');
  const col = dateCols.find((c) => c.id === columnId) ?? dateCols.find((c) => c.settings.role === 'due') ?? dateCols[0];
  const today = todayIso();
  const [cursor, setCursor] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }));
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  if (!col) return <EmptyState title="אין בלוח עמודת תאריך">הוסיפו עמודת תאריך בהגדרות הלוח כדי להשתמש בלוח השנה.</EmptyState>;

  const status = findPrimaryStatusColumn(board.columns);
  const dateOf = (i: Item): string | null => {
    const v = i.values[col.id];
    if (typeof v === 'string') return v;
    if (isDateRange(v)) return v.from;
    return null;
  };
  const byDay = new Map<string, Item[]>();
  for (const i of items) {
    const d = dateOf(i);
    if (d) byDay.set(d, [...(byDay.get(d) ?? []), i]);
  }

  const first = new Date(Date.UTC(cursor.y, cursor.m, 1));
  const daysInMonth = new Date(Date.UTC(cursor.y, cursor.m + 1, 0)).getUTCDate();
  const lead = first.getUTCDay(); // 0 = Sunday (Israeli week starts on Sunday)
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
  const monthName = new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first);
  const move = (delta: number) => setCursor((c) => ({ y: c.y + Math.floor((c.m + delta) / 12), m: (((c.m + delta) % 12) + 12) % 12 }));
  const inMonth = items.filter((i) => dateOf(i)?.startsWith(iso(cursor.y, cursor.m, 1).slice(0, 7))).length;

  return (
    <div className="calendar">
      <div className="toolbar">
        <button type="button" className="btn btn-sm" onClick={() => move(-1)} aria-label="החודש הקודם">
          ‹ הקודם
        </button>
        <h2 className="calendar-title" aria-live="polite">
          {monthName}
        </h2>
        <button type="button" className="btn btn-sm" onClick={() => move(1)} aria-label="החודש הבא">
          הבא ›
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCursor({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 })}>
          היום
        </button>
        {dateCols.length > 1 && (
          <>
            <label htmlFor="cal-col" style={{ marginInlineStart: 'auto' }}>
              לפי עמודה
            </label>
            <select id="cal-col" className="select" value={col.id} onChange={(e) => onColumnChange(e.target.value)}>
              {dateCols.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </>
        )}
        <span className="muted" style={dateCols.length > 1 ? undefined : { marginInlineStart: 'auto' }}>
          {inMonth} פריטים בחודש
        </span>
      </div>
      <div className="table-wrap">
        <table className="calendar-grid">
          <caption className="sr-only">
            {monthName} — לפי {col.title}
          </caption>
          <thead>
            <tr>
              {DAYS.map((d) => (
                <th key={d} scope="col" abbr={d}>
                  <span aria-hidden="true">{d.slice(0, 1)}׳</span>
                  <span className="sr-only">{d}</span>
                  <span className="day-long" aria-hidden="true">
                    {d}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, w) => (
              <tr key={w}>
                {week.map((day, d) => {
                  if (!day) return <td key={d} className="cal-empty" />;
                  const key = iso(cursor.y, cursor.m, day);
                  const list = byDay.get(key) ?? [];
                  const showAll = expandedDay === key;
                  return (
                    <td key={d} className={key === today ? 'cal-day today' : 'cal-day'} aria-current={key === today ? 'date' : undefined}>
                      <span className="cal-num num">
                        {day}
                        <span className="sr-only">
                          {' '}
                          ב{monthName}, יום {DAYS[d]}
                          {list.length ? `, ${list.length} פריטים` : ''}
                        </span>
                      </span>
                      <ul className="list-plain">
                        {(showAll ? list : list.slice(0, MAX_PER_DAY)).map((i) => {
                          const opt = status ? status.settings.options?.find((o) => o.id === i.values[status.id]) : undefined;
                          const late = isOverdue(i, board.columns, today);
                          return (
                            <li key={i.id}>
                              <button
                                type="button"
                                className={late ? 'cal-chip late' : 'cal-chip'}
                                style={opt ? colorStyle(opt.color) : undefined}
                                onClick={() => onOpenItem(i.id)}
                              >
                                {late && <span className="sr-only">באיחור: </span>}
                                {i.name}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                      {list.length > MAX_PER_DAY && !showAll && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setExpandedDay(key)}>
                          ועוד {list.length - MAX_PER_DAY}
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
