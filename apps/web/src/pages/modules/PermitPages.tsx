import { PERMIT_PRECAUTIONS, PERMIT_TYPE_LABELS, PERMIT_TYPES, type Permit, type PermitConflict, type PermitStatus, type PermitType } from '@suboard/shared';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, errorMessage } from '../../api/client';
import { useDirectory, usePermit, usePermitMutations, usePermits } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { ErrorState, LoadingState, useFeedback } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { usePageTitle } from '../../components/Layout';

const fmt = (iso: string) => new Intl.DateTimeFormat('he-IL', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Jerusalem' }).format(new Date(iso));
export const STATUS_TEXT: Record<PermitStatus, string> = { pending: 'ממתין לאישור', approved: 'מאושר', rejected: 'נדחה', cancelled: 'בוטל', closed: 'נסגר', expired: 'פג תוקף' };
const ACTION_TEXT: Record<string, string> = { requested: 'הגיש/ה בקשה', approved: 'אישר/ה', rejected: 'דחה/תה', closed: 'סגר/ה (העבודה הסתיימה)', cancelled: 'ביטל/ה', expired: 'פג תוקף (אוטומטי)' };

export function PermitStatusBadge({ p }: { p: Pick<Permit, 'status' | 'active'> }) {
  if (p.active) return <span className="badge permit-active">פעיל עכשיו</span>;
  const cls = p.status === 'approved' ? 'badge success' : p.status === 'rejected' || p.status === 'expired' ? 'badge danger' : 'badge';
  return <span className={cls}>{STATUS_TEXT[p.status]}</span>;
}

// ---------------------------------------------------------------- list
export function PermitsPage() {
  usePageTitle('היתרי עבודה');
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const scope = (params.get('scope') as 'mine' | 'approvals' | 'all' | null) ?? 'all';
  const q = usePermits(scope);
  const tabs: ['mine' | 'approvals' | 'all', string][] = [
    ['all', user?.role === 'member' ? 'כל ההיתרים שלי' : 'כל ההיתרים'],
    ['approvals', 'ממתינים לאישורי'],
    ['mine', 'שביקשתי'],
  ];
  return (
    <>
      <div className="page-header">
        <div>
          <h1>היתרי עבודה</h1>
          <p className="muted" style={{ margin: 'var(--space-1) 0 0' }}>
            עבודה בחום, מקום מוקף, גובה, חשמל, חפירה וחומרים מסוכנים — עם אישור רב-שלבי וזיהוי התנגשויות.
          </p>
        </div>
        <div className="actions">
          <Link to="/permits/new" className="btn btn-primary">
            <Icon name="plus" /> בקשת היתר
          </Link>
        </div>
      </div>
      <div role="tablist" aria-label="סינון היתרים" className="tabs">
        {tabs.map(([k, label]) => (
          <button key={k} type="button" role="tab" id={`ptab-${k}`} aria-selected={scope === k} aria-controls="ppanel" tabIndex={scope === k ? 0 : -1} onClick={() => setParams({ scope: k }, { replace: true })}>
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="ppanel" aria-labelledby={`ptab-${scope}`}>
        {q.isPending && <LoadingState />}
        {q.isError && <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
        {q.data?.length === 0 && <p className="muted">אין היתרים להצגה.</p>}
        <ul className="list-plain automation-list">
          {q.data?.map((p) => (
            <li key={p.id} className={`automation-card permit-card permit-${p.active ? 'active' : p.status}`}>
              <div className="automation-card-head">
                <h2 style={{ margin: 0, fontSize: '1rem' }}>
                  <Link to={`/permits/${p.id}`}>
                    <span className="num">{p.number}</span> · {p.title}
                  </Link>
                </h2>
                <PermitStatusBadge p={p} />
              </div>
              <p className="rule-sentence">
                <strong>{PERMIT_TYPE_LABELS[p.type]}</strong> · {p.location} · {fmt(p.startsAt)} – {fmt(p.endsAt)}
              </p>
              <p className="muted automation-meta">
                מבקש/ת: {p.requesterName}
                {p.nextApproverId && ` · ממתין ל: ${p.approvals.find((a) => a.userId === p.nextApproverId)?.userName ?? ''}`}
                {p.conflicts.length > 0 && <span className="badge danger"> {p.conflicts.length} התנגשויות</span>}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- request
const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export function PermitNewPage() {
  usePageTitle('בקשת היתר עבודה');
  const { user } = useAuth();
  const dir = useDirectory();
  const { create, check } = usePermitMutations();
  const navigate = useNavigate();
  const [type, setType] = useState<PermitType>('hot_work');
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [contractor, setContractor] = useState('');
  const now = new Date(Date.now() + 3600_000);
  now.setMinutes(0, 0, 0);
  const [start, setStart] = useState(toLocalInput(now));
  const [end, setEnd] = useState(toLocalInput(new Date(now.getTime() + 4 * 3600_000)));
  const [approvers, setApprovers] = useState<string[]>([]);
  const [precautions, setPrecautions] = useState<string[]>([]);
  const [conflictNote, setConflictNote] = useState('');
  const [conflicts, setConflicts] = useState<PermitConflict[]>([]);
  const [error, setError] = useState<string | null>(null);
  const ids = { type: useId(), title: useId(), loc: useId(), desc: useId(), con: useId(), s: useId(), e: useId(), note: useId(), appr: useId() };
  const candidates = (dir.data ?? []).filter((u) => u.id !== user?.id && !approvers.includes(u.id));

  // Live conflict preview whenever the place or window changes.
  useEffect(() => {
    if (!location.trim() || !start || !end) return setConflicts([]);
    const t = setTimeout(() => {
      check.mutate(
        { location, type, startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString() },
        { onSuccess: setConflicts, onError: () => setConflicts([]) },
      );
    }, 400);
    return () => clearTimeout(t);
  }, [location, type, start, end]); // eslint-disable-line react-hooks/exhaustive-deps

  const blocking = conflicts.some((c) => c.severity === 'block');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!title.trim() || !location.trim()) return setError('יש למלא כותרת ומיקום');
    if (!approvers.length) return setError('יש לבחור לפחות מאשר/ת אחד/ת');
    if (precautions.length !== PERMIT_PRECAUTIONS[type].length) return setError('יש לאשר את כל אמצעי הזהירות');
    if (blocking && !conflictNote.trim()) return setError('קיימת התנגשות חוסמת — יש לנמק');
    create.mutate(
      { type, title: title.trim(), location: location.trim(), description, contractor, startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(), approverIds: approvers, precautions, conflictNote: conflictNote.trim() },
      { onSuccess: (p) => navigate(`/permits/${p.id}`), onError: (err) => setError(errorMessage(err)) },
    );
  };

  return (
    <div className="form-page">
      <form className="card" onSubmit={submit} noValidate>
        <h1>בקשת היתר עבודה</h1>
        <div className="rule-row">
          <div className="field">
            <label htmlFor={ids.type}>סוג העבודה</label>
            <select id={ids.type} className="select" value={type} onChange={(e) => (setType(e.target.value as PermitType), setPrecautions([]))}>
              {PERMIT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {PERMIT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={ids.con}>קבלן / צוות מבצע (לא חובה)</label>
            <input id={ids.con} className="input" maxLength={120} value={contractor} onChange={(e) => setContractor(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor={ids.title}>
            מה העבודה? <span aria-hidden="true">*</span>
          </label>
          <input id={ids.title} className="input" required maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={ids.loc}>
            מיקום מדויק <span aria-hidden="true">*</span>
          </label>
          <input id={ids.loc} className="input" required maxLength={160} placeholder="בניין, קומה, חדר" value={location} onChange={(e) => setLocation(e.target.value)} aria-describedby={`${ids.loc}-h`} />
          <span id={`${ids.loc}-h`} className="hint">
            התנגשויות מזוהות לפי אותו מיקום — כתבו אותו באותו אופן בכל ההיתרים.
          </span>
        </div>
        <div className="rule-row">
          <div className="field">
            <label htmlFor={ids.s}>התחלה</label>
            <input id={ids.s} type="datetime-local" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={ids.e}>סיום (עד 14 יום)</label>
            <input id={ids.e} type="datetime-local" className="input" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <div aria-live="polite">
          {conflicts.length > 0 && (
            <div className={blocking ? 'form-error' : 'conflict-warn'} role={blocking ? 'alert' : 'status'}>
              <strong>{blocking ? 'התנגשות חוסמת' : 'שימו לב: היתרים נוספים באותו מיקום וזמן'}</strong>
              <ul>
                {conflicts.map((c) => (
                  <li key={c.permitId}>
                    {c.number} · {PERMIT_TYPE_LABELS[c.type]}
                    {c.title ? ` · ${c.title}` : ''} · {fmt(c.startsAt)} – {fmt(c.endsAt)} {c.severity === 'block' ? '(לא ניתן לבצע במקביל)' : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        {blocking && (
          <div className="field">
            <label htmlFor={ids.note}>
              נימוק לביצוע למרות ההתנגשות <span aria-hidden="true">*</span>
            </label>
            <textarea id={ids.note} className="textarea" rows={2} maxLength={500} value={conflictNote} onChange={(e) => setConflictNote(e.target.value)} />
          </div>
        )}
        <div className="field">
          <label htmlFor={ids.desc}>תיאור ושיטת עבודה</label>
          <textarea id={ids.desc} className="textarea" rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <fieldset className="rule-block">
          <legend>
            <span className="rule-kw">אמצעי זהירות</span> <span className="muted">(חובה לאשר את כולם)</span>
          </legend>
          {PERMIT_PRECAUTIONS[type].map((p) => (
            <label key={p.id} className="check">
              <input type="checkbox" checked={precautions.includes(p.id)} onChange={(e) => setPrecautions(e.target.checked ? [...precautions, p.id] : precautions.filter((x) => x !== p.id))} /> {p.label}
            </label>
          ))}
        </fieldset>
        <fieldset className="rule-block">
          <legend>
            <span className="rule-kw">מאשרים</span> <span className="muted">(לפי הסדר, עד 5; לא את עצמך)</span>
          </legend>
          <ol className="approver-list">
            {approvers.map((id, i) => (
              <li key={id}>
                <span>{dir.data?.find((u) => u.id === id)?.name}</span>
                <button type="button" className="icon-btn" aria-label={`הסרת ${dir.data?.find((u) => u.id === id)?.name ?? ''} מהמאשרים`} onClick={() => setApprovers(approvers.filter((_, j) => j !== i))}>
                  <Icon name="x" size={16} />
                </button>
              </li>
            ))}
          </ol>
          {approvers.length < 5 && (
            <div className="rule-add">
              <label htmlFor={ids.appr} className="sr-only">
                הוספת מאשר/ת
              </label>
              <select id={ids.appr} className="select" value="" onChange={(e) => e.target.value && setApprovers([...approvers, e.target.value])}>
                <option value="">— הוספת מאשר/ת —</option>
                {candidates.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </fieldset>
        <p className="hint">אישור בהיתר נרשם כפעולה של משתמש מחובר (שם, שעה, הערה). זו אינה חתימה אלקטרונית מאושרת.</p>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <button type="submit" className="btn btn-primary" disabled={create.isPending}>
          {create.isPending ? 'שולח…' : 'שליחה לאישור'}
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- detail
export function PermitDetailPage() {
  const { permitId = '' } = useParams();
  const q = usePermit(permitId);
  const { user } = useAuth();
  const m = usePermitMutations();
  const { toast, confirm } = useFeedback();
  const [comment, setComment] = useState('');
  const cid = useId();
  usePageTitle(q.data ? `היתר ${q.data.number}` : 'היתר עבודה');
  if (q.isPending) return <LoadingState />;
  if (q.isError)
    return q.error instanceof ApiError && q.error.status === 404 ? (
      <div className="state" role="alert">
        <h1>ההיתר לא נמצא</h1>
        <Link to="/permits" className="btn">
          להיתרים
        </Link>
      </div>
    ) : (
      <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
    );
  const p = q.data;
  const myTurn = p.nextApproverId === user?.id;
  const canFinish = p.requesterId === user?.id || p.approvals.some((a) => a.userId === user?.id) || user?.role !== 'member';
  const run = (action: 'approve' | 'reject' | 'close' | 'cancel', msg: string) =>
    m[action].mutate({ id: p.id, comment }, { onSuccess: () => (setComment(''), toast(msg)), onError: (e) => toast(errorMessage(e), 'error') });

  return (
    <article className="permit-doc">
      <div className="page-header">
        <div>
          <h1>
            היתר עבודה <span className="num">{p.number}</span>
          </h1>
          <p className="muted" style={{ margin: 'var(--space-1) 0 0' }}>
            {PERMIT_TYPE_LABELS[p.type]} · <PermitStatusBadge p={p} />
          </p>
        </div>
        <div className="actions no-print">
          <button type="button" className="btn" onClick={() => window.print()}>
            <Icon name="printer" /> הדפסה לתלייה באתר
          </button>
          <Link to="/permits" className="btn">
            לכל ההיתרים
          </Link>
        </div>
      </div>
      <section className="card">
        <h2 style={{ marginTop: 0 }}>{p.title}</h2>
        <dl className="qr-fields">
          <div className="qr-field">
            <dt>מיקום</dt>
            <dd>{p.location}</dd>
          </div>
          <div className="qr-field">
            <dt>חלון זמן</dt>
            <dd>
              {fmt(p.startsAt)} – {fmt(p.endsAt)}
            </dd>
          </div>
          <div className="qr-field">
            <dt>מבקש/ת</dt>
            <dd>{p.requesterName}</dd>
          </div>
          {p.contractor && (
            <div className="qr-field">
              <dt>מבצע</dt>
              <dd>{p.contractor}</dd>
            </div>
          )}
          {p.description && (
            <div className="qr-field">
              <dt>שיטת עבודה</dt>
              <dd className="form-desc">{p.description}</dd>
            </div>
          )}
        </dl>
        <h3>אמצעי זהירות שאושרו</h3>
        <ul className="precautions">
          {PERMIT_PRECAUTIONS[p.type]
            .filter((x) => p.precautions.includes(x.id))
            .map((x) => (
              <li key={x.id}>
                <Icon name="checks" /> {x.label}
              </li>
            ))}
        </ul>
        {p.conflictNote && (
          <p className="conflict-warn">
            <strong>נימוק התנגשות:</strong> {p.conflictNote}
          </p>
        )}
        {p.conflicts.length > 0 && (
          <div className="conflict-warn" role="status">
            <strong>היתרים חופפים באותו מיקום:</strong>
            <ul>
              {p.conflicts.map((c) => (
                <li key={c.permitId}>
                  {c.number} · {PERMIT_TYPE_LABELS[c.type]} · {fmt(c.startsAt)} – {fmt(c.endsAt)} · {STATUS_TEXT[c.status]}
                  {c.severity === 'block' ? ' (חוסם)' : ''}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="appr-h" style={{ marginTop: 'var(--space-4)' }}>
        <h2 id="appr-h">אישורים</h2>
        <ol className="approval-steps">
          {p.approvals.map((a) => (
            <li key={a.order} className={`approval-step ${a.decision ?? (a.userId === p.nextApproverId ? 'current' : 'waiting')}`}>
              <span className="num">{a.order}.</span> <strong>{a.userName}</strong> —{' '}
              {a.decision === 'approved' ? `אישר/ה ${fmt(a.decidedAt!)}` : a.decision === 'rejected' ? `דחה/תה ${fmt(a.decidedAt!)}` : a.userId === p.nextApproverId ? 'ממתין לאישור' : 'בתור'}
              {a.comment && <span className="muted"> · "{a.comment}"</span>}
            </li>
          ))}
        </ol>
        {(myTurn || (canFinish && (p.status === 'pending' || p.status === 'approved'))) && (
          <div className="no-print rule-editor" style={{ marginTop: 'var(--space-3)' }}>
            <div className="field">
              <label htmlFor={cid}>הערה {myTurn ? '(חובה בדחייה)' : '(לא חובה)'}</label>
              <input id={cid} className="input" maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} />
            </div>
            <div className="toolbar">
              {myTurn && (
                <>
                  <button type="button" className="btn btn-primary" onClick={() => run('approve', 'ההיתר אושר')}>
                    אישור
                  </button>
                  <button type="button" className="btn btn-danger" onClick={() => (comment.trim() ? run('reject', 'ההיתר נדחה') : toast('יש לנמק דחייה', 'error'))}>
                    דחייה
                  </button>
                </>
              )}
              {canFinish && p.status === 'approved' && Date.parse(p.startsAt) <= Date.now() && (
                <button type="button" className="btn" onClick={() => run('close', 'ההיתר נסגר')}>
                  סגירה — העבודה הסתיימה
                </button>
              )}
              {canFinish && (p.status === 'pending' || p.status === 'approved') && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={async () => {
                    if (await confirm({ title: 'ביטול היתר', message: `לבטל את היתר ${p.number}?`, confirmLabel: 'ביטול ההיתר', danger: true })) run('cancel', 'ההיתר בוטל');
                  }}
                >
                  ביטול ההיתר
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="log-h" style={{ marginTop: 'var(--space-4)' }}>
        <h2 id="log-h">יומן פעולות</h2>
        <ol className="report-items">
          {p.events.map((e, i) => (
            <li key={i}>
              <span className="muted">{fmt(e.at)}</span> · <strong>{e.userName ?? 'מערכת'}</strong> {ACTION_TEXT[e.action] ?? e.action}
              {e.comment && <span className="muted"> · "{e.comment}"</span>}
            </li>
          ))}
        </ol>
        <p className="hint">היומן אינו ניתן לעריכה. אישור הוא פעולה של משתמש מחובר — לא חתימה אלקטרונית מאושרת.</p>
      </section>
    </article>
  );
}
