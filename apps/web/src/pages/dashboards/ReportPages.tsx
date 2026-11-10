import { formatDateHe, RISK_LEVEL_COLORS, RISK_LEVEL_LABELS, todayIso } from '@suboard/shared';
import { useId } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, errorMessage } from '../../api/client';
import { useMonthlyReport, useWorkload } from '../../api/hooks';
import { ErrorState, LoadingState } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { usePageTitle } from '../../components/Layout';
import { colorStyle } from '../../components/StatusPill';
import { Meter, WorkloadTable } from './Widgets';

export function WorkloadPage() {
  usePageTitle('עומס צוות');
  const q = useWorkload();
  return (
    <>
      <div className="page-header">
        <div>
          <h1>עומס צוות</h1>
          <p className="muted" style={{ margin: 'var(--space-1) 0 0' }}>
            פריטים פתוחים לכל אחראי, מכל הלוחות שיש לך גישה אליהם. ממוין לפי איחורים.
          </p>
        </div>
        <div className="actions no-print">
          <button type="button" className="btn" onClick={() => window.print()}>
            <Icon name="printer" /> PDF / הדפסה
          </button>
        </div>
      </div>
      {q.isPending && <LoadingState />}
      {q.isError && <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {q.data?.length === 0 && <p className="muted">אין פריטים פתוחים משויכים.</p>}
      {q.data && q.data.length > 0 && (
        <section className="card">
          <WorkloadTable rows={q.data} />
        </section>
      )}
    </>
  );
}

const prevMonth = () => {
  const [y, m] = todayIso().split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
};

/** Delta vs the previous month in words (never colour alone). */
function Delta({ now, before, goodWhenUp }: { now: number; before: number; goodWhenUp: boolean }) {
  const d = now - before;
  if (d === 0) return <span className="muted">ללא שינוי</span>;
  const up = d > 0;
  const good = up === goodWhenUp;
  return (
    <span className={good ? 'delta good' : 'delta bad'}>
      {up ? '▲' : '▼'} {Math.abs(d)} {up ? 'יותר' : 'פחות'}
    </span>
  );
}

/** "מבט מנהל" — monthly management report (N11), printable as PDF. */
export function MonthlyReportPage() {
  const [params, setParams] = useSearchParams();
  const month = params.get('month') || prevMonth();
  const q = useMonthlyReport(month);
  const monthId = useId();
  usePageTitle(q.data ? `מבט מנהל — ${q.data.label}` : 'מבט מנהל');

  if (q.isError && q.error instanceof ApiError && q.error.status === 403)
    return (
      <div className="state" role="alert">
        <h1>אין הרשאה</h1>
        <p>הדוח החודשי מיועד למנהלים ולמנהלי מערכת.</p>
      </div>
    );
  const r = q.data;
  return (
    <>
      <div className="page-header">
        <div>
          <h1>מבט מנהל{r ? `: ${r.label}` : ''}</h1>
          <p className="muted" style={{ margin: 'var(--space-1) 0 0' }}>
            סיכום חודשי מכל הלוחות שיש לך גישה אליהם, מול החודש הקודם.
          </p>
        </div>
        <div className="actions no-print">
          <label htmlFor={monthId} className="sr-only">
            חודש
          </label>
          <input id={monthId} type="month" className="input" value={month} max={todayIso().slice(0, 7)} onChange={(e) => e.target.value && setParams({ month: e.target.value })} />
          <button type="button" className="btn btn-primary" onClick={() => window.print()} disabled={!r}>
            <Icon name="printer" /> PDF / הדפסה
          </button>
        </div>
      </div>
      {q.isPending && <LoadingState />}
      {q.isError && <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {r && (
        <div className="monthly">
          <section aria-label="תמונת מצב" className="stat-row">
            <div className="card stat">
              <span className="muted">נפתחו</span>
              <span className="value">{r.totals.created}</span>
              <Delta now={r.totals.created} before={r.totals.prevCreated} goodWhenUp={false} />
            </div>
            <div className="card stat">
              <span className="muted">נסגרו</span>
              <span className="value">{r.totals.closed}</span>
              <Delta now={r.totals.closed} before={r.totals.prevClosed} goodWhenUp />
            </div>
            <div className={`card stat ${r.totals.overdueAtEnd ? 'danger' : ''}`}>
              <span className="muted">באיחור בסוף החודש</span>
              <span className="value">{r.totals.overdueAtEnd}</span>
            </div>
          </section>

          <section className="card" aria-labelledby="mb-h">
            <h2 id="mb-h">לפי לוח</h2>
            {r.boards.length === 0 ? (
              <p className="muted">אין פעילות בחודש זה.</p>
            ) : (
              <div className="table-scroll" tabIndex={0} role="region" aria-label="טבלת פעילות לפי לוח">
                <table className="data-table">
                  <caption className="sr-only">פעילות לפי לוח — {r.label}</caption>
                  <thead>
                    <tr>
                      <th scope="col">לוח</th>
                      <th scope="col">נפתחו</th>
                      <th scope="col">נסגרו</th>
                      <th scope="col">פתוחים בסוף החודש</th>
                      <th scope="col">באיחור בסוף החודש</th>
                      <th scope="col">זמן סגירה ממוצע</th>
                      <th scope="col">החודש הקודם (נפתחו / נסגרו)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.boards.map((b) => (
                      <tr key={b.boardId}>
                        <th scope="row">
                          <Link to={`/boards/${b.boardId}`}>{b.boardName}</Link>
                        </th>
                        <td className="num">{b.created}</td>
                        <td className="num">{b.closed}</td>
                        <td className="num">{b.openAtEnd}</td>
                        <td className="num">{b.overdueAtEnd ? <span className="badge danger">{b.overdueAtEnd}</span> : 0}</td>
                        <td className="num">{b.avgCloseDays === null ? '—' : `${b.avgCloseDays} ימים`}</td>
                        <td className="num">
                          {b.prev.created} / {b.prev.closed}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="report-columns">
            <section className="card" aria-labelledby="mc-h">
              <h2 id="mc-h">תאימות (כעת)</h2>
              {r.compliance.length === 0 ? (
                <p className="muted">אין לוחות עם מעקב תאימות.</p>
              ) : (
                <ul className="list-plain widget-rows">
                  {r.compliance.map((c) => (
                    <li key={c.boardId}>
                      <span>{c.boardName}</span>
                      <Meter percent={c.percent} />
                      {c.overdue > 0 && <span className="badge danger">{c.overdue} באיחור</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="card" aria-labelledby="mr-h">
              <h2 id="mr-h">סיכונים פתוחים (כעת)</h2>
              <ul className="list-plain status-bars">
                {r.risk.map((l) => {
                  const max = Math.max(1, ...r.risk.map((x) => x.count));
                  return (
                    <li key={l.level}>
                      <span className="status-bar-label">{RISK_LEVEL_LABELS[l.level]}</span>
                      <span className="status-bar-track" aria-hidden="true">
                        <span className="status-bar-fill" style={{ ...colorStyle(RISK_LEVEL_COLORS[l.level]), inlineSize: `${(l.count / max) * 100}%` }} />
                      </span>
                      <span className="status-bar-count">{l.count}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>

          <section className="card" aria-labelledby="mo-h" style={{ marginTop: 'var(--space-4)' }}>
            <h2 id="mo-h">10 האיחורים הגדולים (כעת)</h2>
            {r.topOverdue.length === 0 ? (
              <p className="muted">אין פריטים באיחור.</p>
            ) : (
              <ol className="report-items">
                {r.topOverdue.map((i) => (
                  <li key={i.id}>
                    <Link to={`/boards/${i.boardId}?item=${i.id}`}>{i.name}</Link> <span className="badge danger">{i.daysLate} ימים</span>{' '}
                    <span className="muted">
                      {i.boardName} · יעד {formatDateHe(i.due)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <p className="muted print-only">הופק ב-{new Date(r.generatedAt).toLocaleString('he-IL')} · SUBoard · יחידת הבטיחות</p>
        </div>
      )}
    </>
  );
}
