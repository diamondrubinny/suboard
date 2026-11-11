import { apiUrl } from '../../api/base';
import { formatDateHe, todayIso, type Training, type TrainingCell, type TrainingState } from '@suboard/shared';
import { useId, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import { useDirectory, useMyTrainings, useTrainingMatrix, useTrainingMutations, useTrainings } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { Dialog } from '../../components/Dialog';
import { ErrorState, LoadingState, useFeedback } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { usePageTitle } from '../../components/Layout';

export const STATE_TEXT: Record<TrainingState, string> = { valid: 'בתוקף', expiring: 'פג בקרוב', expired: 'פג', missing: 'חסר', not_required: '' };

/** A matrix cell: state in words + date (colour is a second cue, never the only one). */
export function StateChip({ cell }: { cell: TrainingCell }) {
  if (cell.state === 'not_required' && !cell.completedOn)
    return (
      <span className="muted">
        <span aria-hidden="true">—</span>
        <span className="sr-only">לא נדרש</span>
      </span>
    );
  const date = cell.expiresOn ? `עד ${formatDateHe(cell.expiresOn)}` : cell.completedOn ? formatDateHe(cell.completedOn) : '';
  return (
    <span className={`train-chip train-${cell.state}`}>
      <strong>{STATE_TEXT[cell.state] || 'בוצע'}</strong>
      {date && <span>{date}</span>}
    </span>
  );
}

// ---------------------------------------------------------------- managers
export function TrainingsPage() {
  usePageTitle('הדרכות');
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'catalog' ? 'catalog' : 'matrix';
  if (user?.role === 'member') return <MyTrainingsPage />;
  return (
    <>
      <div className="page-header">
        <div>
          <h1>מטריצת הדרכות</h1>
          <p className="muted" style={{ margin: 'var(--space-1) 0 0' }}>
            מי חייב איזו הדרכה, ומה התוקף. רשומות הדרכה הן מידע על עובדים — גלויות למנהלים ולעובד עצמו בלבד.
          </p>
        </div>
        <div className="actions no-print">
          <a className="btn" href={apiUrl('/trainings/matrix.csv')} download>
            <Icon name="download" /> CSV
          </a>
          <button type="button" className="btn" onClick={() => window.print()}>
            <Icon name="printer" /> PDF / הדפסה
          </button>
        </div>
      </div>
      <div role="tablist" aria-label="הדרכות" className="tabs no-print">
        {(
          [
            ['matrix', 'מטריצה'],
            ['catalog', 'קטלוג ורישום'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" role="tab" id={`ttab-${k}`} aria-selected={tab === k} aria-controls={`tpanel-${k}`} tabIndex={tab === k ? 0 : -1} onClick={() => setParams({ tab: k }, { replace: true })}>
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`tpanel-${tab}`} aria-labelledby={`ttab-${tab}`}>
        {tab === 'matrix' ? <MatrixPanel /> : <CatalogPanel />}
      </div>
    </>
  );
}

function MatrixPanel() {
  const q = useTrainingMatrix();
  const [cell, setCell] = useState<{ training: Training; userId: string; userName: string; cell: TrainingCell } | null>(null);
  const [onlyGaps, setOnlyGaps] = useState(false);
  if (q.isPending) return <LoadingState />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const m = q.data;
  if (!m.trainings.length)
    return (
      <div className="empty-state">
        <Icon name="school" />
        <p>אין הדרכות בקטלוג. הוסיפו בלשונית "קטלוג ורישום".</p>
      </div>
    );
  const gap = (c: TrainingCell) => c.state === 'missing' || c.state === 'expired' || c.state === 'expiring';
  const users = onlyGaps ? m.users.filter((u) => Object.values(u.cells).some(gap)) : m.users;
  return (
    <>
      <div className="toolbar no-print">
        <label className="check">
          <input type="checkbox" checked={onlyGaps} onChange={(e) => setOnlyGaps(e.target.checked)} /> רק עובדים עם פערים
        </label>
        <span className="muted">{users.length} עובדים</span>
      </div>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="מטריצת הדרכות">
        <table className="data-table train-matrix">
          <caption className="sr-only">מטריצת הדרכות: עובדים בשורות, הדרכות בעמודות</caption>
          <thead>
            <tr>
              <th scope="col">עובד/ת</th>
              {m.trainings.map((t) => (
                <th key={t.id} scope="col">
                  {t.name}
                  <span className="train-total">
                    {m.totals[t.id]!.valid + m.totals[t.id]!.expiring}/{m.totals[t.id]!.required} בתוקף
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <th scope="row">{u.name}</th>
                {m.trainings.map((t) => {
                  const c = u.cells[t.id]!;
                  return (
                    <td key={t.id}>
                      {/* The accessible name contains the visible chip text (label in name) plus hidden context. */}
                      <button type="button" className="train-cell" onClick={() => setCell({ training: t, userId: u.id, userName: u.name, cell: c })}>
                        <span className="sr-only">
                          {u.name} — {t.name}:{' '}
                        </span>
                        <StateChip cell={c} />
                        <span className="sr-only">. רישום השתתפות</span>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cell && <RecordDialog {...cell} onClose={() => setCell(null)} />}
    </>
  );
}

function RecordDialog({ training, userId, userName, cell, onClose }: { training: Training; userId: string; userName: string; cell: TrainingCell; onClose: () => void }) {
  const { record, removeRecord } = useTrainingMutations();
  const { toast, confirm } = useFeedback();
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState('');
  const ids = { d: useId(), n: useId() };
  return (
    <Dialog
      open
      onClose={onClose}
      title={`${training.name} — ${userName}`}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            סגירה
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={record.isPending}
            onClick={() => record.mutate({ id: training.id, userIds: [userId], completedOn: date, note }, { onSuccess: () => (toast('ההשתתפות נרשמה'), onClose()), onError: (e) => toast(errorMessage(e), 'error') })}
          >
            רישום השתתפות
          </button>
        </>
      }
    >
      <div className="rule-editor">
        <p>
          מצב נוכחי: <StateChip cell={cell} />
        </p>
        <div className="rule-row">
          <div className="field">
            <label htmlFor={ids.d}>תאריך ההדרכה</label>
            <input id={ids.d} type="date" className="input" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={ids.n}>הערה (לא חובה)</label>
            <input id={ids.n} className="input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        {cell.recordId && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              if (await confirm({ title: 'מחיקת רשומה', message: `למחוק את רשומת ההשתתפות האחרונה (${formatDateHe(cell.completedOn)})?`, confirmLabel: 'מחיקה', danger: true })) {
                removeRecord.mutate(cell.recordId!, { onSuccess: () => (toast('הרשומה נמחקה'), onClose()) });
              }
            }}
          >
            מחיקת הרשומה האחרונה
          </button>
        )}
      </div>
    </Dialog>
  );
}

function CatalogPanel() {
  const q = useTrainings();
  const dir = useDirectory();
  const { create, update, remove, requirements, record } = useTrainingMutations();
  const { toast, confirm } = useFeedback();
  const [name, setName] = useState('');
  const [months, setMonths] = useState(12);
  const [allUsers, setAllUsers] = useState(false);
  const [editing, setEditing] = useState<Training | null>(null);
  const [bulk, setBulk] = useState<Training | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate({ name: name.trim(), validityMonths: months, allUsers }, { onSuccess: () => (setName(''), toast('ההדרכה נוספה')), onError: (err) => toast(errorMessage(err), 'error') });
  };
  return (
    <>
      <form className="card" onSubmit={submit} aria-labelledby="new-tr">
        <h2 id="new-tr">הדרכה חדשה</h2>
        <div className="toolbar">
          <label htmlFor="tr-name" className="sr-only">
            שם ההדרכה
          </label>
          <input id="tr-name" className="input" placeholder="שם ההדרכה" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          <label htmlFor="tr-months" className="label">
            תוקף (חודשים, 0 = ללא)
          </label>
          <input id="tr-months" type="number" className="input" style={{ maxInlineSize: '6rem' }} min={0} max={120} value={months} onChange={(e) => setMonths(Math.max(0, Math.min(120, Math.trunc(Number(e.target.value) || 0))))} />
          <label className="check">
            <input type="checkbox" checked={allUsers} onChange={(e) => setAllUsers(e.target.checked)} /> חובה לכל המשתמשים
          </label>
          <button type="submit" className="btn btn-primary" disabled={create.isPending || !name.trim()}>
            <Icon name="plus" /> הוספה
          </button>
        </div>
      </form>
      {q.isPending && <LoadingState />}
      <ul className="list-plain automation-list" style={{ marginTop: 'var(--space-4)' }}>
        {q.data?.map((t) => (
          <li key={t.id} className="automation-card">
            <div className="automation-card-head">
              <h3>{t.name}</h3>
              <span className="badge">{t.validityMonths ? `תוקף ${t.validityMonths} חודשים` : 'חד-פעמית'}</span>
            </div>
            <p className="rule-sentence">{t.allUsers ? 'חובה לכל המשתמשים' : `חובה ל-${t.requiredUserIds.length} עובדים`}</p>
            <div className="actions">
              <button type="button" className="btn btn-sm" onClick={() => setBulk(t)}>
                רישום השתתפות קבוצתי<span className="sr-only"> ל{t.name}</span>
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setEditing(t)}>
                מי חייב<span className="sr-only"> ב{t.name}</span>
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={async () => {
                  if (await confirm({ title: 'מחיקת הדרכה', message: `למחוק את "${t.name}" וכל רשומות ההשתתפות בה?`, confirmLabel: 'מחיקה', danger: true })) remove.mutate(t.id);
                }}
              >
                מחיקה<span className="sr-only"> של {t.name}</span>
              </button>
              <label className="check">
                <input type="checkbox" checked={t.allUsers} onChange={(e) => update.mutate({ id: t.id, patch: { allUsers: e.target.checked } })} /> חובה לכולם
              </label>
            </div>
          </li>
        ))}
      </ul>
      {editing && (
        <UsersDialog
          title={`מי חייב בהדרכה "${editing.name}"`}
          users={dir.data ?? []}
          initial={editing.requiredUserIds}
          saveLabel="שמירה"
          onClose={() => setEditing(null)}
          onSave={(userIds) => requirements.mutate({ id: editing.id, userIds }, { onSuccess: () => (toast('הדרישות נשמרו'), setEditing(null)), onError: (e) => toast(errorMessage(e), 'error') })}
        />
      )}
      {bulk && (
        <UsersDialog
          title={`רישום השתתפות: ${bulk.name}`}
          users={dir.data ?? []}
          initial={[]}
          withDate
          saveLabel="רישום"
          onClose={() => setBulk(null)}
          onSave={(userIds, date) =>
            record.mutate({ id: bulk.id, userIds, completedOn: date! }, { onSuccess: (r) => (toast(`נרשמו ${r.added} משתתפים`), setBulk(null)), onError: (e) => toast(errorMessage(e), 'error') })
          }
        />
      )}
    </>
  );
}

function UsersDialog({ title, users, initial, withDate, saveLabel, onSave, onClose }: { title: string; users: { id: string; name: string }[]; initial: string[]; withDate?: boolean; saveLabel: string; onSave: (ids: string[], date?: string) => void; onClose: () => void }) {
  const [sel, setSel] = useState<string[]>(initial);
  const [filter, setFilter] = useState('');
  const [date, setDate] = useState(todayIso());
  const ids = { f: useId(), d: useId() };
  const shown = users.filter((u) => u.name.includes(filter.trim()));
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            ביטול
          </button>
          <button type="button" className="btn btn-primary" disabled={withDate && !sel.length} onClick={() => onSave(sel, date)}>
            {saveLabel} ({sel.length})
          </button>
        </>
      }
    >
      <div className="rule-editor">
        {withDate && (
          <div className="field">
            <label htmlFor={ids.d}>תאריך ההדרכה</label>
            <input id={ids.d} type="date" className="input" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
          </div>
        )}
        <div className="field">
          <label htmlFor={ids.f}>סינון לפי שם</label>
          <input id={ids.f} className="input" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <fieldset className="check-list">
          <legend className="label">עובדים</legend>
          {shown.map((u) => (
            <label key={u.id} className="check">
              <input type="checkbox" checked={sel.includes(u.id)} onChange={(e) => setSel(e.target.checked ? [...sel, u.id] : sel.filter((x) => x !== u.id))} /> {u.name}
            </label>
          ))}
        </fieldset>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- everyone
export function MyTrainingsPage() {
  usePageTitle('ההדרכות שלי');
  const q = useMyTrainings();
  return (
    <>
      <div className="page-header">
        <div>
          <h1>ההדרכות שלי</h1>
          <p className="muted" style={{ margin: 'var(--space-1) 0 0' }}>
            הדרכות שנדרשות ממך ותוקפן. תזכורת תישלח 30 יום לפני פקיעה.
          </p>
        </div>
      </div>
      {q.isPending && <LoadingState />}
      {q.isError && <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {q.data?.length === 0 && <p className="muted">אין הדרכות שנדרשות ממך כרגע.</p>}
      <ul className="list-plain automation-list">
        {q.data?.map((t) => (
          <li key={t.training.id} className={`automation-card train-card-${t.cell.state}`}>
            <div className="automation-card-head">
              <h2 style={{ margin: 0, fontSize: '1rem' }}>{t.training.name}</h2>
              <StateChip cell={t.cell} />
            </div>
            {t.history.length > 0 && <p className="muted automation-meta">השתתפות: {t.history.map((h) => formatDateHe(h.completedOn)).join(' · ')}</p>}
            {t.cell.state === 'missing' && <p className="automation-meta">טרם נרשמה השתתפות. פנו לרכז/ת ההדרכות.</p>}
          </li>
        ))}
      </ul>
    </>
  );
}
