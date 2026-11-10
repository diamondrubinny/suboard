import { formatDateHe, PALETTE, type DashboardItemRef } from '@suboard/shared';
import { Link } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { useDashboard } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { EmptyState, ErrorState, LoadingState } from '../components/Feedback';
import { usePageTitle } from '../components/Layout';
import { StatusPill } from '../components/StatusPill';

function ItemRefList({ items, empty, overdue }: { items: DashboardItemRef[]; empty: string; overdue?: boolean }) {
  if (!items.length) return <p className="muted">{empty}</p>;
  return (
    <ul className="list-plain item-list">
      {items.map((i) => (
        <li key={i.itemId}>
          <span className="grow">
            <Link to={`/boards/${i.boardId}?item=${i.itemId}`}>{i.itemName}</Link>
            <br />
            <small className="muted">{i.boardName}</small>
          </span>
          <StatusPill label={i.statusLabel} color={i.statusColor} />
          {i.dueDate && (
            <span className={overdue ? 'badge danger' : 'badge'}>
              {overdue && <span className="sr-only">באיחור, </span>}
              יעד: {formatDateHe(i.dueDate)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function DashboardPage() {
  usePageTitle('לוח בקרה');
  const { user } = useAuth();
  const q = useDashboard();

  if (q.isPending) return <LoadingState />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const d = q.data;
  const totalOpen = d.boards.reduce((s, b) => s + b.open, 0);

  return (
    <>
      <div className="page-header">
        <h1>שלום, {user?.name}</h1>
      </div>

      <section aria-label="תמונת מצב" className="stat-row">
        <div className="card stat">
          <span className="muted">פריטים פתוחים</span>
          <span className="value">{totalOpen}</span>
        </div>
        <div className={`card stat ${d.overdue.length ? 'danger' : ''}`}>
          <span className="muted">באיחור</span>
          <span className="value">{d.overdue.length}</span>
        </div>
        <div className="card stat">
          <span className="muted">יעד ב-7 הימים הקרובים</span>
          <span className="value">{d.dueSoon.length}</span>
        </div>
        <div className="card stat">
          <span className="muted">משויכים אליי</span>
          <span className="value">{d.myOpenItems.length}</span>
        </div>
      </section>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', alignItems: 'start' }}>
        <section className="card" aria-labelledby="overdue-h">
          <h2 id="overdue-h">באיחור</h2>
          <ItemRefList items={d.overdue} empty="אין פריטים באיחור. כל הכבוד!" overdue />
        </section>
        <section className="card" aria-labelledby="mine-h">
          <h2 id="mine-h">משויכים אליי</h2>
          <ItemRefList items={d.myOpenItems} empty="אין פריטים פתוחים המשויכים אליך." />
        </section>
        <section className="card" aria-labelledby="soon-h">
          <h2 id="soon-h">יעד קרוב (7 ימים)</h2>
          <ItemRefList items={d.dueSoon} empty="אין יעדים בשבוע הקרוב." />
        </section>
      </div>

      <section aria-labelledby="boards-h" style={{ marginTop: '1.5rem' }}>
        <h2 id="boards-h">מצב לפי לוח</h2>
        {d.boards.length === 0 ? (
          <div className="card">
            <EmptyState title="אין לך עדיין גישה ללוחות">
              <Link to="/boards">למעבר לרשימת הלוחות</Link>
            </EmptyState>
          </div>
        ) : (
          <div className="grid grid-cards">
            {d.boards.map((b) => (
              <Link key={b.boardId} to={`/boards/${b.boardId}`} className="card board-card">
                <h3 style={{ margin: 0 }}>{b.boardName}</h3>
                <span className="muted">
                  {b.open} פתוחים מתוך {b.total}
                  {b.overdue > 0 && (
                    <>
                      {' · '}
                      <span className="badge danger">{b.overdue} באיחור</span>
                    </>
                  )}
                </span>
                {b.total > 0 && (
                  <>
                    <div className="dist" aria-hidden="true">
                      {b.byStatus
                        .filter((s) => s.count > 0)
                        .map((s) => (
                          <span key={s.label} style={{ inlineSize: `${(s.count / b.total) * 100}%`, background: PALETTE[s.color].bg }} />
                        ))}
                    </div>
                    <div className="legend">
                      {b.byStatus
                        .filter((s) => s.count > 0)
                        .map((s) => (
                          <span key={s.label}>
                            <i style={{ background: PALETTE[s.color].bg }} aria-hidden="true" />
                            {s.label}: {s.count}
                          </span>
                        ))}
                    </div>
                  </>
                )}
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
