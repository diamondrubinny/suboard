import { formatDateHe, type Automation, type BoardDetail, type Recurrence, type ScheduledReport } from '@suboard/shared';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { errorMessage } from '../../../api/client';
import {
  useAutomationMutations,
  useAutomationRuns,
  useAutomations,
  useBoard,
  useRecurrenceMutations,
  useRecurrences,
  useReportMutations,
  useReports,
} from '../../../api/hooks';
import { ErrorState, LoadingState, useFeedback } from '../../../components/Feedback';
import { Icon } from '../../../components/Icon';
import { usePageTitle } from '../../../components/Layout';
import { formatDateTime } from '../activityText';
import { RecurrenceEditor, scheduleText } from './RecurrenceEditor';
import { FREQ_TEXT, ReportEditor, reportWhen } from './ReportEditor';
import { RuleEditor, RuleSentence } from './RuleEditor';

type Tab = 'rules' | 'recurring' | 'reports' | 'log';
const TABS: [Tab, string][] = [
  ['rules', 'חוקים'],
  ['recurring', 'פריטים חוזרים'],
  ['reports', 'דוחות מתוזמנים'],
  ['log', 'יומן הרצות'],
];

/** Board automation centre: rules, recurring items, scheduled reports and the run log. */
export function AutomationsPage() {
  const { boardId = '' } = useParams();
  const board = useBoard(boardId);
  const [params, setParams] = useSearchParams();
  usePageTitle(`אוטומציות — ${board.data?.name ?? 'לוח'}`);
  if (board.isPending) return <LoadingState />;
  if (board.isError) return <ErrorState message={errorMessage(board.error)} onRetry={() => board.refetch()} />;
  const b = board.data;
  const canEdit = b.myRole !== 'viewer';
  // Viewers see recurring items only (rules, reports and the log need editor rights).
  const tabs = canEdit ? TABS : TABS.filter(([k]) => k === 'recurring');
  const requested = params.get('tab') as Tab | null;
  const tab: Tab = tabs.some(([k]) => k === requested) ? (requested as Tab) : tabs[0]![0];
  const setTab = (t: Tab) => setParams({ tab: t }, { replace: true });

  return (
    <>
      <div className="page-header">
        <div>
          <h1>אוטומציות: {b.name}</h1>
          <p className="muted" style={{ margin: 'var(--space-1) 0 0' }}>
            חוקים שפועלים לבד, פריטים שנוצרים במועדם ודוחות שנשלחים בזמן.
          </p>
        </div>
        <div className="actions">
          <Link to={`/boards/${b.id}/report`} className="btn">
            <Icon name="chart" /> סיכום לוח
          </Link>
          <Link to={`/boards/${b.id}`} className="btn">
            חזרה ללוח
          </Link>
        </div>
      </div>

      <div role="tablist" aria-label="סוגי אוטומציה" className="tabs">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`atab-${key}`}
            aria-selected={tab === key}
            aria-controls={`apanel-${key}`}
            tabIndex={tab === key ? 0 : -1}
            onClick={() => setTab(key)}
            onKeyDown={(e) => {
              const order = tabs.map(([k]) => k);
              const idx = order.indexOf(key);
              const n = order.length;
              const next =
                e.key === 'ArrowLeft' ? order[(idx + 1) % n] : e.key === 'ArrowRight' ? order[(idx + n - 1) % n] : e.key === 'Home' ? order[0] : e.key === 'End' ? order[n - 1] : null;
              if (next) {
                e.preventDefault();
                setTab(next);
                document.getElementById(`atab-${next}`)?.focus();
              }
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`apanel-${tab}`} aria-labelledby={`atab-${tab}`} className="automation-panel">
        {tab === 'rules' && <RulesPanel board={b} />}
        {tab === 'recurring' && <RecurringPanel board={b} canEdit={canEdit} />}
        {tab === 'reports' && <ReportsPanel board={b} />}
        {tab === 'log' && <RunsPanel board={b} />}
      </div>
    </>
  );
}

function EnabledToggle({ checked, label, disabled, onChange }: { checked: boolean; label: string; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span aria-hidden="true">{checked ? 'פעיל' : 'כבוי'}</span>
    </label>
  );
}

// ---------------------------------------------------------------- rules
function RulesPanel({ board }: { board: BoardDetail }) {
  const q = useAutomations(board.id);
  const { update, remove } = useAutomationMutations(board.id);
  const { toast, confirm } = useFeedback();
  const [editing, setEditing] = useState<Automation | 'new' | null>(null);
  const isOwner = board.myRole === 'owner';

  return (
    <section aria-labelledby="rules-h">
      <div className="section-head">
        <h2 id="rules-h">חוקי אוטומציה</h2>
        {isOwner && (
          <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
            <Icon name="plus" /> חוק חדש
          </button>
        )}
      </div>
      {!isOwner && <p className="muted">רק בעלי הלוח יכולים ליצור ולשנות חוקים.</p>}
      {q.isPending && <LoadingState />}
      {q.isError && <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {q.data?.length === 0 && (
        <div className="empty-state">
          <Icon name="bolt" />
          <p>עוד אין חוקים. אפשר להתחיל ממתכון מוכן — למשל SLA ("לא טופל תוך 3 ימים ← התראה") או תזכורת יום לפני היעד.</p>
        </div>
      )}
      <ul className="list-plain automation-list">
        {q.data?.map((a) => (
          <li key={a.id} className={a.enabled ? 'automation-card' : 'automation-card disabled'}>
            <div className="automation-card-head">
              <h3>{a.name}</h3>
              <EnabledToggle
                checked={a.enabled}
                disabled={!isOwner || update.isPending}
                label={`החוק "${a.name}" פעיל`}
                onChange={(enabled) => update.mutate({ id: a.id, patch: { enabled } }, { onSuccess: () => toast(enabled ? 'החוק הופעל' : 'החוק הושבת'), onError: (e) => toast(errorMessage(e), 'error') })}
              />
            </div>
            <RuleSentence board={board} rule={a} />
            <p className="muted automation-meta">
              {a.runCount ? `רץ ${a.runCount} פעמים` : 'עוד לא רץ'}
              {a.lastRunAt ? ` · לאחרונה ${formatDateTime(a.lastRunAt)}` : ''}
              {a.errorCount > 0 && <span className="badge danger"> {a.errorCount} שגיאות</span>}
              {a.createdByName ? ` · נוצר ע"י ${a.createdByName}` : ''}
            </p>
            {isOwner && (
              <div className="actions">
                <button type="button" className="btn btn-sm" onClick={() => setEditing(a)}>
                  עריכה<span className="sr-only"> של {a.name}</span>
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={async () => {
                    if (await confirm({ title: 'מחיקת חוק', message: `למחוק את החוק "${a.name}"? יומן ההרצות שלו יימחק.`, confirmLabel: 'מחיקה', danger: true })) {
                      remove.mutate(a.id, { onSuccess: () => toast('החוק נמחק'), onError: (e) => toast(errorMessage(e), 'error') });
                    }
                  }}
                >
                  מחיקה<span className="sr-only"> של {a.name}</span>
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {editing && <RuleEditor key={editing === 'new' ? 'new' : editing.id} board={board} rule={editing === 'new' ? null : editing} open onClose={() => setEditing(null)} />}
    </section>
  );
}

// ---------------------------------------------------------------- recurring
function RecurringPanel({ board, canEdit }: { board: BoardDetail; canEdit: boolean }) {
  const q = useRecurrences(board.id);
  const { update, remove } = useRecurrenceMutations(board.id);
  const { toast, confirm } = useFeedback();
  const [editing, setEditing] = useState<Recurrence | 'new' | null>(null);
  const group = (id: string) => board.groups.find((g) => g.id === id)?.name ?? '';

  return (
    <section aria-labelledby="rec-h">
      <div className="section-head">
        <h2 id="rec-h">פריטים חוזרים</h2>
        {canEdit && (
          <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
            <Icon name="plus" /> פריט חוזר חדש
          </button>
        )}
      </div>
      {q.isPending && <LoadingState />}
      {q.isError && <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {q.data?.length === 0 && (
        <div className="empty-state">
          <Icon name="repeat" />
          <p>אין פריטים חוזרים. מתאים לבדיקות ציוד תקופתיות, סקרים חודשיים ותרגילים שנתיים — הפריט ייווצר לבד במועדו, עם תאריך יעד ואחראי.</p>
        </div>
      )}
      <ul className="list-plain automation-list">
        {q.data?.map((r) => (
          <li key={r.id} className={r.enabled ? 'automation-card' : 'automation-card disabled'}>
            <div className="automation-card-head">
              <h3>{r.name}</h3>
              <EnabledToggle
                checked={r.enabled}
                disabled={!canEdit || update.isPending}
                label={`הפריט החוזר "${r.name}" פעיל`}
                onChange={(enabled) => update.mutate({ id: r.id, patch: { enabled } }, { onError: (e) => toast(errorMessage(e), 'error') })}
              />
            </div>
            <p className="rule-sentence">
              <Icon name="repeat" /> {scheduleText(r.schedule)} · בקבוצה "{group(r.groupId)}"
              {r.dueColumnId ? ` · יעד אחרי ${r.dueOffsetDays} ימים` : ''}
            </p>
            <p className="muted automation-meta">
              {r.nextDate ? `המועד הבא: ${formatDateHe(r.nextDate)}` : 'הסדרה הסתיימה'}
              {r.lastCreatedAt ? ` · נוצר לאחרונה ${formatDateTime(r.lastCreatedAt)}` : ''}
              {r.lastItemId && (
                <>
                  {' · '}
                  <Link to={`/boards/${board.id}?item=${r.lastItemId}`}>לפריט האחרון</Link>
                </>
              )}
            </p>
            {canEdit && (
              <div className="actions">
                <button type="button" className="btn btn-sm" onClick={() => setEditing(r)}>
                  עריכה<span className="sr-only"> של {r.name}</span>
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={async () => {
                    if (await confirm({ title: 'מחיקת פריט חוזר', message: `להפסיק ליצור את "${r.name}"? פריטים שכבר נוצרו לא יימחקו.`, confirmLabel: 'מחיקה', danger: true })) {
                      remove.mutate(r.id, { onSuccess: () => toast('הפריט החוזר נמחק'), onError: (e) => toast(errorMessage(e), 'error') });
                    }
                  }}
                >
                  מחיקה<span className="sr-only"> של {r.name}</span>
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {editing && <RecurrenceEditor key={editing === 'new' ? 'new' : editing.id} board={board} rec={editing === 'new' ? null : editing} open onClose={() => setEditing(null)} />}
    </section>
  );
}

// ---------------------------------------------------------------- reports
function ReportsPanel({ board }: { board: BoardDetail }) {
  const q = useReports(board.id);
  const { update, remove } = useReportMutations(board.id);
  const { toast, confirm } = useFeedback();
  const [editing, setEditing] = useState<ScheduledReport | 'new' | null>(null);
  const isOwner = board.myRole === 'owner';
  const names = (ids: string[]) => ids.map((id) => board.members.find((m) => m.userId === id)?.name ?? 'לא חבר בלוח').join(', ');

  return (
    <section aria-labelledby="rep-h">
      <div className="section-head">
        <h2 id="rep-h">דוחות מתוזמנים</h2>
        {isOwner && (
          <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
            <Icon name="plus" /> דוח חדש
          </button>
        )}
      </div>
      {q.isPending && <LoadingState />}
      {q.isError && <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {q.data?.length === 0 && (
        <div className="empty-state">
          <Icon name="chart" />
          <p>
            אין דוחות מתוזמנים. דוח שבועי להנהלה כולל התפלגות סטטוסים, פריטים באיחור, יעדים קרובים ומה נפתח ונסגר בתקופה.{' '}
            <Link to={`/boards/${board.id}/report`}>לצפייה בסיכום הנוכחי</Link>
          </p>
        </div>
      )}
      <ul className="list-plain automation-list">
        {q.data?.map((r) => (
          <li key={r.id} className={r.enabled ? 'automation-card' : 'automation-card disabled'}>
            <div className="automation-card-head">
              <h3>{r.name}</h3>
              <EnabledToggle
                checked={r.enabled}
                disabled={!isOwner || update.isPending}
                label={`הדוח "${r.name}" פעיל`}
                onChange={(enabled) => update.mutate({ id: r.id, patch: { enabled } }, { onError: (e) => toast(errorMessage(e), 'error') })}
              />
            </div>
            <p className="rule-sentence">
              {FREQ_TEXT[r.frequency]} — {reportWhen(r)} · אל: {names(r.recipients)}
            </p>
            <p className="muted automation-meta">{r.lastSentDay ? `נשלח לאחרונה ${formatDateHe(r.lastSentDay)}` : 'עוד לא נשלח'}</p>
            {isOwner && (
              <div className="actions">
                <button type="button" className="btn btn-sm" onClick={() => setEditing(r)}>
                  עריכה<span className="sr-only"> של {r.name}</span>
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={async () => {
                    if (await confirm({ title: 'מחיקת דוח', message: `למחוק את הדוח "${r.name}"?`, confirmLabel: 'מחיקה', danger: true })) {
                      remove.mutate(r.id, { onSuccess: () => toast('הדוח נמחק'), onError: (e) => toast(errorMessage(e), 'error') });
                    }
                  }}
                >
                  מחיקה<span className="sr-only"> של {r.name}</span>
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {editing && <ReportEditor key={editing === 'new' ? 'new' : editing.id} board={board} report={editing === 'new' ? null : editing} open onClose={() => setEditing(null)} />}
    </section>
  );
}

// ---------------------------------------------------------------- run log
function RunsPanel({ board }: { board: BoardDetail }) {
  const q = useAutomationRuns(board.id);
  return (
    <section aria-labelledby="log-h">
      <div className="section-head">
        <h2 id="log-h">יומן הרצות</h2>
        <button type="button" className="btn btn-sm" onClick={() => q.refetch()} disabled={q.isFetching}>
          רענון
        </button>
      </div>
      <p className="muted">100 ההרצות האחרונות. היומן נשמר 90 יום.</p>
      {q.isPending && <LoadingState />}
      {q.isError && <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {q.data?.length === 0 && <p className="muted">עוד לא היו הרצות.</p>}
      {q.data && q.data.length > 0 && (
        <div className="table-scroll">
          <table className="data-table">
            <caption className="sr-only">יומן הרצות אוטומציה</caption>
            <thead>
              <tr>
                <th scope="col">זמן</th>
                <th scope="col">חוק</th>
                <th scope="col">פריט</th>
                <th scope="col">תוצאה</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((r) => (
                <tr key={r.id}>
                  <td>{formatDateTime(r.createdAt)}</td>
                  <td>{r.automationName}</td>
                  <td>{r.itemId && r.itemName ? <Link to={`/boards/${board.id}?item=${r.itemId}`}>{r.itemName}</Link> : <span className="muted">—</span>}</td>
                  <td>{r.status === 'ok' ? <span className="badge success">הצליח</span> : <span className="badge danger">שגיאה: {r.detail}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
