import { formatDateHe, type BoardCompliance, type ComplianceBucket } from '@suboard/shared';
import { Link } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import { useComplianceOverview } from '../../api/hooks';
import { ErrorState, LoadingState } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { usePageTitle } from '../../components/Layout';

/** Percent bar with the number printed (never colour alone); tone follows the threshold. */
function Meter({ b }: { b: ComplianceBucket }) {
  if (b.percent === null) return <span className="muted">אין פריטים</span>;
  const tone = b.percent >= 90 ? 'good' : b.percent >= 70 ? 'warn' : 'bad';
  return (
    <span className={`meter meter-${tone}`}>
      <span className="meter-track" aria-hidden="true">
        <span className="meter-fill" style={{ inlineSize: `${b.percent}%` }} />
      </span>
      <strong className="num">{b.percent}%</strong>
    </span>
  );
}

function Counts({ b }: { b: ComplianceBucket }) {
  return (
    <>
      <td className="num">{b.total}</td>
      <td className="num">{b.ok}</td>
      <td className="num">{b.dueSoon}</td>
      <td className="num">{b.overdue ? <span className="badge danger">{b.overdue}</span> : 0}</td>
      <td className="num">{b.missing}</td>
    </>
  );
}

function BoardBlock({ c }: { c: BoardCompliance }) {
  const head = (
    <tr>
      <th scope="col">{c.groupByTitle ?? 'קבוצה'}</th>
      <th scope="col">עמידה</th>
      <th scope="col">סה"כ</th>
      <th scope="col">בתוקף</th>
      <th scope="col">קרוב ({c.settings.windowDays} יום)</th>
      <th scope="col">באיחור</th>
      <th scope="col">ללא תאריך</th>
    </tr>
  );
  return (
    <section className="card compliance-board" aria-labelledby={`comp-${c.boardId}`}>
      <div className="section-head">
        <h2 id={`comp-${c.boardId}`}>
          <Link to={`/boards/${c.boardId}`}>{c.boardName}</Link>
        </h2>
        <Meter b={c.summary} />
      </div>
      <p className="muted">לפי "{c.dateColumnTitle}"</p>
      {/* Focusable so keyboard users can scroll it on narrow screens. */}
        <div className="table-scroll" tabIndex={0} role="region" aria-label={`טבלת עמידה — ${c.boardName}`}>
        <table className="data-table">
          <caption className="sr-only">עמידה בבדיקות — {c.boardName}</caption>
          <thead>{head}</thead>
          <tbody>
            {c.groups.map((g) => (
              <tr key={g.key}>
                <th scope="row">{g.label}</th>
                <td>
                  <Meter b={g} />
                </td>
                <Counts b={g} />
              </tr>
            ))}
            <tr className="total-row">
              <th scope="row">סה"כ</th>
              <td>
                <Meter b={c.summary} />
              </td>
              <Counts b={c.summary} />
            </tr>
          </tbody>
        </table>
      </div>
      {c.overdueItems.length > 0 && (
        <details className="compliance-overdue">
          <summary>
            <Icon name="alert" /> {c.overdueItems.length} פריטים באיחור
          </summary>
          <ul className="list-plain report-items">
            {c.overdueItems.map((i) => (
              <li key={i.id}>
                <Link to={`/boards/${c.boardId}?item=${i.id}`}>{i.name}</Link> <span className="muted">— {formatDateHe(i.date)}{i.group ? ` · ${i.group}` : ''}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** Cross-board periodic compliance (`/compliance`): only boards the user can see. */
export function CompliancePage() {
  usePageTitle('תאימות');
  const q = useComplianceOverview();
  if (q.isPending) return <LoadingState />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const all = q.data.reduce(
    (acc, c) => ({ total: acc.total + c.summary.total, inDate: acc.inDate + c.summary.ok + c.summary.dueSoon, overdue: acc.overdue + c.summary.overdue }),
    { total: 0, inDate: 0, overdue: 0 },
  );
  return (
    <>
      <div className="page-header">
        <div>
          <h1>תאימות תקופתית</h1>
          <p className="muted" style={{ margin: 'var(--space-1) 0 0' }}>
            עמידה בבדיקות ציוד ומעבדות לפי מועד "הבדיקה הבאה". מוצגים רק לוחות שיש לך גישה אליהם.
          </p>
        </div>
      </div>
      {q.data.length === 0 ? (
        <div className="empty-state">
          <Icon name="checks" />
          <p>אין עדיין לוחות עם מעקב תאימות. בעלי לוח מפעילים אותו בהגדרות הלוח ← "מעקב תאימות תקופתית".</p>
        </div>
      ) : (
        <>
          <section aria-label="תמונת מצב" className="stat-row">
            <div className="card stat">
              <span className="muted">עמידה כוללת</span>
              <span className="value">{all.total ? Math.round((all.inDate / all.total) * 100) : 0}%</span>
            </div>
            <div className={`card stat ${all.overdue ? 'danger' : ''}`}>
              <span className="muted">באיחור</span>
              <span className="value">{all.overdue}</span>
            </div>
            <div className="card stat">
              <span className="muted">פריטים במעקב</span>
              <span className="value">{all.total}</span>
            </div>
          </section>
          <div className="grid" style={{ gap: 'var(--space-4)' }}>
            {q.data.map((c) => (
              <BoardBlock key={c.boardId} c={c} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
