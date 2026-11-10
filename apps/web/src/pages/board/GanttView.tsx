import {
  addDaysIso,
  diffDaysIso,
  findDueColumn,
  findPrimaryStatusColumn,
  formatDateHe,
  isDateRange,
  isItemDone,
  todayIso,
  type BoardDetail,
  type Item,
} from '@suboard/shared';
import { useMemo } from 'react';
import { useBoardDependencies } from '../../api/hooks';
import { colorStyle } from '../../components/StatusPill';

interface Bar {
  item: Item;
  start: string;
  end: string;
  done: boolean;
  /** True when only a due date exists: the bar runs from creation to the due date. */
  derived: boolean;
}

const MONTHS = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];

/**
 * Timeline (Gantt) of top-level items: a date-range column (or creation → due date). Bars follow
 * the board's status colours and always carry text; dependencies show as "תלוי ב" plus a warning
 * when an item starts before its blocker ends (or the blocker is still open and the start passed).
 */
export function GanttView({
  board,
  items,
  scale,
  onScaleChange,
  onOpenItem,
}: {
  board: BoardDetail;
  items: Item[];
  scale: 'week' | 'month';
  onScaleChange: (s: 'week' | 'month') => void;
  onOpenItem: (id: string) => void;
}) {
  const deps = useBoardDependencies(board.id);
  const range = board.columns.find((c) => c.type === 'date_range');
  const due = findDueColumn(board.columns) ?? board.columns.find((c) => c.type === 'date');
  const status = findPrimaryStatusColumn(board.columns);
  const today = todayIso();

  const bars = useMemo<Bar[]>(
    () =>
      items
        .map((i): Bar | null => {
          const r = range ? i.values[range.id] : undefined;
          if (isDateRange(r)) return { item: i, start: r.from, end: r.to, done: isItemDone(i, status), derived: false };
          const d = due ? i.values[due.id] : undefined;
          if (typeof d === 'string') {
            const created = i.createdAt.slice(0, 10);
            return { item: i, start: created < d ? created : d, end: d, done: isItemDone(i, status), derived: true };
          }
          return null;
        })
        .filter((b): b is Bar => b !== null)
        .sort((a, b) => a.start.localeCompare(b.start)),
    [items, range, due, status],
  );

  if (!range && !due) return <p className="muted">לתצוגת ציר זמן נדרשת עמודת טווח תאריכים או תאריך יעד.</p>;
  const undated = items.length - bars.length;
  if (!bars.length) return <p className="muted">אין פריטים עם תאריכים. ({undated} פריטים ללא תאריך)</p>;

  const pad = scale === 'week' ? 3 : 10;
  let from = addDaysIso(bars.reduce((m, b) => (b.start < m ? b.start : m), bars[0]!.start), -pad);
  let to = addDaysIso(bars.reduce((m, b) => (b.end > m ? b.end : m), bars[0]!.end), pad);
  if (today < from) from = addDaysIso(today, -pad);
  if (today > to) to = addDaysIso(today, pad);
  const span = Math.max(1, diffDaysIso(from, to) + 1);
  const pos = (d: string) => (diffDaysIso(from, d) / span) * 100;

  // Header ticks: every Sunday (week scale) or every 1st of the month.
  const ticksList: { at: number; label: string }[] = [];
  for (let d = from; d <= to; d = addDaysIso(d, 1)) {
    const dt = new Date(`${d}T00:00:00Z`);
    if (scale === 'week' ? dt.getUTCDay() === 0 : dt.getUTCDate() === 1) {
      ticksList.push({ at: pos(d), label: scale === 'week' ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : `${MONTHS[dt.getUTCMonth()]} ${String(dt.getUTCFullYear()).slice(2)}` });
    }
  }

  const byId = new Map(bars.map((b) => [b.item.id, b]));
  const blockersOf = (id: string) => (deps.data ?? []).filter((d) => d.blocked === id).map((d) => d.blocker);
  const names = new Map(board.items.map((i) => [i.id, i.name]));
  const doneOf = (id: string) => {
    const it = board.items.find((i) => i.id === id);
    return it ? isItemDone(it, status) : true;
  };

  return (
    <div className="gantt-wrap">
      <div className="toolbar">
        <div className="segmented" role="group" aria-label="קנה מידה">
          <button type="button" aria-pressed={scale === 'week'} onClick={() => onScaleChange('week')}>
            שבועות
          </button>
          <button type="button" aria-pressed={scale === 'month'} onClick={() => onScaleChange('month')}>
            חודשים
          </button>
        </div>
        <span className="muted">
          {range ? `לפי "${range.title}"` : `מיצירה ועד "${due!.title}"`}
          {undated > 0 ? ` · ${undated} פריטים ללא תאריך אינם מוצגים` : ''}
        </span>
      </div>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="ציר זמן">
        <div className={`gantt gantt-${scale}`}>
          <div className="gantt-head" aria-hidden="true">
            <span className="gantt-name" />
            <span className="gantt-track">
              {ticksList.map((t) => (
                <span key={t.at} className="gantt-tick" style={{ insetInlineStart: `${t.at}%` }}>
                  {t.label}
                </span>
              ))}
            </span>
          </div>
          <ol className="list-plain gantt-rows">
            {bars.map((b) => {
              const opt = status?.settings.options?.find((o) => o.id === b.item.values[status.id]);
              const blockers = blockersOf(b.item.id);
              // A finished item has no scheduling conflict left to warn about.
              const conflict = !b.done && blockers.some((id) => {
                const bb = byId.get(id);
                const blockerOpen = !doneOf(id);
                return (bb && bb.end >= b.start && blockerOpen) || (blockerOpen && b.start <= today);
              });
              return (
                <li key={b.item.id} className={b.done ? 'gantt-row done' : 'gantt-row'}>
                  <span className="gantt-name">
                    <button type="button" className="link-btn" onClick={() => onOpenItem(b.item.id)}>
                      {b.item.name}
                    </button>
                    <span className="sr-only">
                      {' '}
                      — {formatDateHe(b.start)} עד {formatDateHe(b.end)}
                      {opt ? `, ${opt.label}` : ''}
                    </span>
                    {blockers.length > 0 && (
                      <span className="gantt-deps">
                        תלוי ב: {blockers.map((id) => names.get(id) ?? 'פריט').join(', ')}
                        {conflict && <span className="badge danger"> מתחיל לפני שהחוסם הושלם</span>}
                      </span>
                    )}
                  </span>
                  <span className="gantt-track">
                    <span className="gantt-today" style={{ insetInlineStart: `${pos(today)}%` }} aria-hidden="true" />
                    <span
                      className={b.derived ? 'gantt-bar derived' : 'gantt-bar'}
                      style={{ ...colorStyle(opt?.color ?? 'gray'), insetInlineStart: `${pos(b.start)}%`, inlineSize: `max(6px, ${((diffDaysIso(b.start, b.end) + 1) / span) * 100}%)` }}
                      aria-hidden="true"
                      title={`${b.item.name}: ${formatDateHe(b.start)} – ${formatDateHe(b.end)}`}
                    >
                      <span className="gantt-bar-label">{formatDateHe(b.end).slice(0, 5)}</span>
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
      <p className="muted gantt-legend">הקו האנכי = היום · פס מקווקו = מיצירת הפריט ועד תאריך היעד · הצבע לפי הסטטוס.</p>
    </div>
  );
}
