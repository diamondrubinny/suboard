import { CHART_BY_TYPES, CHART_VALUE_TYPES, chartBucketRule, chartBuckets, todayIso, type BoardDetail, type DirectoryUser, type FilterRule, type Item } from '@suboard/shared';
import { useMemo } from 'react';
import { useTeams } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { EmptyState } from '../../components/Feedback';
import { colorStyle } from '../../components/StatusPill';

interface Props {
  board: BoardDetail;
  /** The items the board currently shows (search and filters applied), top level only. */
  items: Item[];
  users: DirectoryUser[];
  by?: string;
  valueColumnId?: string;
  onChange: (patch: { chartBy?: string; chartValueColumnId?: string | undefined }) => void;
  /** Show the items of one bar in the table (adds a filter rule). Omitted when it cannot be combined with the current filter. */
  onDrill?: (rule: FilterRule, label: string) => void;
}

const fmt = (n: number) => new Intl.NumberFormat('he-IL', { maximumFractionDigits: 1 }).format(n);

/**
 * Chart of the board's (filtered) items: one bar per group / label / person / team, measuring the
 * number of items or the sum of a number column. A list with numbers, not a picture — the bars are
 * decoration, every value is readable as text.
 */
export function ChartView({ board, items, users, by, valueColumnId, onChange, onDrill }: Props) {
  const { user } = useAuth();
  const teams = useTeams(Boolean(user) && !user!.guest && board.columns.some((c) => c.type === 'team'));
  const byColumns = board.columns.filter((c) => CHART_BY_TYPES.includes(c.type));
  const valueColumns = board.columns.filter((c) => CHART_VALUE_TYPES.includes(c.type));
  const effectiveBy = by && (by === 'group' || byColumns.some((c) => c.id === by)) ? by : (byColumns.find((c) => c.type === 'status')?.id ?? 'group');
  const valueCol = valueColumns.find((c) => c.id === valueColumnId);
  const names = useMemo(() => new Map([...users.map((u) => [u.id, u.name] as const), ...(teams.data ?? []).map((t) => [t.id, t.name] as const)]), [users, teams.data]);
  const buckets = useMemo(
    () => chartBuckets({ items, columns: board.columns, groups: board.groups, by: effectiveBy, valueColumnId: valueCol?.id, names, today: todayIso() }),
    [items, board.columns, board.groups, effectiveBy, valueCol?.id, names],
  );
  const max = Math.max(1, ...buckets.map((b) => Math.abs(b.value)));
  const total = buckets.reduce((a, b) => a + b.value, 0);
  const byTitle = effectiveBy === 'group' ? 'קבוצה' : (byColumns.find((c) => c.id === effectiveBy)?.title ?? '');
  const byColumn = byColumns.find((c) => c.id === effectiveBy);
  const unit = valueCol?.settings.unit ?? '';
  const show = (n: number) => `${fmt(n)}${unit ? ` ${unit}` : ''}`;
  const multi = effectiveBy !== 'group' && ['tags', 'person', 'team'].includes(byColumns.find((c) => c.id === effectiveBy)?.type ?? '');

  return (
    <section className="card" aria-labelledby="chart-h">
      <h2 id="chart-h">
        {valueCol ? `סה"כ ${valueCol.title}` : `מספר ה${board.itemTerm || 'פריטים'}`} לפי {byTitle}
      </h2>
      <div className="toolbar">
        <div className="field">
          <label htmlFor="chart-by">חלוקה לפי</label>
          <select id="chart-by" className="select" value={effectiveBy} onChange={(e) => onChange({ chartBy: e.target.value })}>
            <option value="group">קבוצה</option>
            {byColumns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="chart-value">מה למדוד</label>
          <select id="chart-value" className="select" value={valueCol?.id ?? ''} onChange={(e) => onChange({ chartValueColumnId: e.target.value || undefined })}>
            <option value="">מספר הפריטים</option>
            {valueColumns.map((c) => (
              <option key={c.id} value={c.id}>
                סכום: {c.title}
              </option>
            ))}
          </select>
        </div>
      </div>
      {buckets.length === 0 ? (
        <EmptyState title="אין מה להציג">
          <p>אין פריטים שתואמים לסינון הנוכחי.</p>
        </EmptyState>
      ) : (
        <>
          <ul className="list-plain status-bars chart-bars" aria-label={`${valueCol ? `סכום ${valueCol.title}` : 'מספר הפריטים'} לפי ${byTitle}`}>
            {buckets.map((b) => (
              <li key={b.key}>
                <span className="status-bar-label">
                  {(() => {
                    const rule = onDrill ? chartBucketRule(byColumn, b.key) : null;
                    return rule ? (
                      <button type="button" className="link-btn" onClick={() => onDrill!(rule, b.label)} aria-label={`${b.label} — הצגת הפריטים בטבלה`} title="הצגת הפריטים בטבלה">
                        {b.label}
                      </button>
                    ) : (
                      b.label
                    );
                  })()}
                </span>
                <span className="status-bar-track" aria-hidden="true">
                  <span className="status-bar-fill" style={{ ...(b.color ? colorStyle(b.color) : {}), inlineSize: `${(Math.abs(b.value) / max) * 100}%` }} />
                </span>
                <span className="status-bar-count">
                  {show(b.value)}
                  {valueCol && <span className="muted chart-sub"> ({b.count} פריטים)</span>}
                </span>
              </li>
            ))}
          </ul>
          <p className="muted">
            {multi ? (
              <>פריט עם כמה ערכים נספר בכל אחד מהם, ולכן הסכום יכול לעלות על מספר הפריטים ({items.length}).</>
            ) : (
              <>
                סה"כ: <strong className="num">{show(total)}</strong>
                {valueCol && <> ב-{items.length} פריטים</>}.
              </>
            )}{' '}
            התרשים מציג את הפריטים שהלוח מציג כרגע (אחרי חיפוש וסינון), בלי תת-פריטים.{onDrill && byColumn ? ' לחיצה על שם של עמודה בתרשים מציגה את הפריטים שלה בטבלה.' : ''}
          </p>
        </>
      )}
    </section>
  );
}
