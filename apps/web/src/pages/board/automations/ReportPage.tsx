import { formatDateHe, type ReportItemRef } from '@suboard/shared';
import { useId, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { errorMessage } from '../../../api/client';
import { useBoard, useReportSummary } from '../../../api/hooks';
import { ErrorState, LoadingState } from '../../../components/Feedback';
import { Icon } from '../../../components/Icon';
import { usePageTitle } from '../../../components/Layout';
import { colorStyle } from '../../../components/StatusPill';
import { formatDateTime } from '../activityText';

const PERIODS = [
  [7, '7 ימים'],
  [30, '30 יום'],
  [90, '90 יום'],
] as const;

/** Board summary — the same content the scheduled report sends. */
export function ReportPage() {
  const { boardId = '' } = useParams();
  const board = useBoard(boardId);
  const [days, setDays] = useState<number>(7);
  const q = useReportSummary(boardId, days);
  const periodId = useId();
  usePageTitle(`סיכום — ${board.data?.name ?? 'לוח'}`);
  if (board.isError) return <ErrorState message={errorMessage(board.error)} onRetry={() => board.refetch()} />;
  const s = q.data;
  const max = Math.max(1, ...(s?.byStatus.map((x) => x.count) ?? [1]));

  return (
    <>
      <div className="page-header">
        <div>
          <h1>סיכום לוח: {board.data?.name ?? ''}</h1>
          {s && <p className="muted" style={{ margin: 'var(--space-1) 0 0' }}>נכון ל-{formatDateTime(s.generatedAt)}</p>}
        </div>
        <div className="actions">
          <label htmlFor={periodId} className="sr-only">
            תקופה
          </label>
          <select id={periodId} className="select" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {PERIODS.map(([d, label]) => (
              <option key={d} value={d}>
                {label} אחרונים
              </option>
            ))}
          </select>
          <button type="button" className="btn" onClick={() => window.print()}>
            <Icon name="printer" /> PDF / הדפסה
          </button>
          <Link to={`/boards/${boardId}`} className="btn">
            חזרה ללוח
          </Link>
        </div>
      </div>
      {q.isPending && <LoadingState />}
      {q.isError && <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {s && (
        <>
          <section aria-label="תמונת מצב" className="stat-row">
            <Stat label="פריטים" value={s.total} />
            <Stat label="פתוחים" value={s.open} />
            <Stat label="באיחור" value={s.overdue.length} tone={s.overdue.length ? 'danger' : undefined} />
            <Stat label={`נפתחו ב-${s.periodDays} ימים`} value={s.createdInPeriod} />
            <Stat label={`נסגרו ב-${s.periodDays} ימים`} value={s.closedInPeriod} />
          </section>

          <section className="card" aria-labelledby="dist-h">
            <h2 id="dist-h">התפלגות לפי סטטוס</h2>
            {s.byStatus.length === 0 ? (
              <p className="muted">אין עמודת סטטוס בלוח.</p>
            ) : (
              <ul className="list-plain status-bars">
                {s.byStatus.map((x) => (
                  <li key={x.optionId ?? 'none'}>
                    <span className="status-bar-label">{x.label}</span>
                    <span className="status-bar-track" aria-hidden="true">
                      <span className="status-bar-fill" style={{ ...colorStyle(x.color as never), inlineSize: `${(x.count / max) * 100}%` }} />
                    </span>
                    <span className="status-bar-count">{x.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="report-columns">
            <ItemList boardId={boardId} title="באיחור" icon="alert" items={s.overdue} empty="אין פריטים באיחור." />
            <ItemList boardId={boardId} title="יעדים ב-7 הימים הקרובים" icon="calendar" items={s.upcoming} empty="אין יעדים בשבוע הקרוב." />
          </div>
        </>
      )}
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'danger' }) {
  return (
    <div className={tone ? `card stat ${tone}` : 'card stat'}>
      <span className="muted">{label}</span>
      <span className="value">{value}</span>
    </div>
  );
}

function ItemList({ boardId, title, icon, items, empty }: { boardId: string; title: string; icon: 'alert' | 'calendar'; items: ReportItemRef[]; empty: string }) {
  const id = useId();
  return (
    <section className="card" aria-labelledby={id}>
      <h2 id={id}>
        <Icon name={icon} /> {title} {items.length > 0 && <span className="muted">({items.length}{items.length >= 20 ? '+' : ''})</span>}
      </h2>
      {items.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <ul className="list-plain report-items">
          {items.map((i) => (
            <li key={i.id}>
              <Link to={`/boards/${boardId}?item=${i.id}`}>{i.name}</Link> <span className="muted">— {formatDateHe(i.date)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
