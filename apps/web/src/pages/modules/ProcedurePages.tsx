import { formatDateHe, todayIso, type Procedure } from '@suboard/shared';
import { useId, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, errorMessage } from '../../api/client';
import { useDirectory, useProcedure, useProcedureAcks, useProcedureMutations, useProcedures } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { Dialog } from '../../components/Dialog';
import { ErrorState, LoadingState, useFeedback } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { usePageTitle } from '../../components/Layout';

function AckBadge({ p }: { p: Procedure }) {
  if (!p.current) return <span className="badge">טיוטה — אין גרסה</span>;
  if (!p.forMe) return null;
  return p.myAckAt ? <span className="badge success">אושרה קריאה</span> : <span className="badge danger">נדרש אישור קריאה</span>;
}

export function ProceduresPage() {
  usePageTitle('נהלים');
  const q = useProcedures();
  const { user } = useAuth();
  const isManager = user?.role !== 'member';
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState('');
  const fid = useId();
  const list = (q.data ?? []).filter((p) => `${p.code} ${p.title} ${p.category}`.includes(filter.trim()));
  const categories = [...new Set(list.map((p) => p.category))];
  const pending = (q.data ?? []).filter((p) => p.forMe && p.current && !p.myAckAt).length;
  return (
    <>
      <div className="page-header">
        <div>
          <h1>ספריית נהלים</h1>
          <p className="muted" style={{ margin: 'var(--space-1) 0 0' }}>
            {pending ? `${pending} נהלים ממתינים לאישור הקריאה שלך.` : 'כל הנהלים שלך מאושרים.'}
          </p>
        </div>
        {isManager && (
          <div className="actions">
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              <Icon name="plus" /> נוהל חדש
            </button>
          </div>
        )}
      </div>
      <div className="toolbar">
        <label htmlFor={fid} className="sr-only">
          חיפוש נוהל
        </label>
        <input id={fid} type="search" className="input" placeholder="חיפוש לפי קוד, שם או קטגוריה…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      {q.isPending && <LoadingState />}
      {q.isError && <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {q.data?.length === 0 && <p className="muted">אין נהלים להצגה.</p>}
      {categories.map((c) => (
        <section key={c} aria-labelledby={`cat-${c}`} style={{ marginBottom: 'var(--space-4)' }}>
          <h2 id={`cat-${c}`} className="section-title">
            {c}
          </h2>
          <ul className="list-plain automation-list">
            {list
              .filter((p) => p.category === c)
              .map((p) => (
                <li key={p.id} className="automation-card">
                  <div className="automation-card-head">
                    <h3>
                      <Link to={`/procedures/${p.id}`}>
                        <span className="num">{p.code}</span> · {p.title}
                      </Link>
                    </h3>
                    <AckBadge p={p} />
                  </div>
                  <p className="muted automation-meta">
                    {p.current ? `גרסה ${p.current.version} · בתוקף מ-${formatDateHe(p.current.effectiveOn)}` : 'טרם פורסמה גרסה'}
                    {p.ackStats && ` · אישרו ${p.ackStats.acked} מתוך ${p.ackStats.total}`}
                  </p>
                </li>
              ))}
          </ul>
        </section>
      ))}
      {creating && <CreateProcedureDialog onClose={() => setCreating(false)} />}
    </>
  );
}

function AudienceFields({ audience, setAudience, userIds, setUserIds }: { audience: 'all' | 'users'; setAudience: (a: 'all' | 'users') => void; userIds: string[]; setUserIds: (ids: string[]) => void }) {
  const dir = useDirectory();
  return (
    <>
      <fieldset className="check-list">
        <legend className="label">למי הנוהל מיועד</legend>
        <label className="check">
          <input type="radio" name="aud" checked={audience === 'all'} onChange={() => setAudience('all')} /> כל המשתמשים
        </label>
        <label className="check">
          <input type="radio" name="aud" checked={audience === 'users'} onChange={() => setAudience('users')} /> משתמשים נבחרים
        </label>
      </fieldset>
      {audience === 'users' && (
        <fieldset className="check-list">
          <legend className="label">משתמשים</legend>
          {(dir.data ?? []).map((u) => (
            <label key={u.id} className="check">
              <input type="checkbox" checked={userIds.includes(u.id)} onChange={(e) => setUserIds(e.target.checked ? [...userIds, u.id] : userIds.filter((x) => x !== u.id))} /> {u.name}
            </label>
          ))}
        </fieldset>
      )}
    </>
  );
}

function CreateProcedureDialog({ onClose }: { onClose: () => void }) {
  const { create } = useProcedureMutations();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('כללי');
  const [audience, setAudience] = useState<'all' | 'users'>('all');
  const [userIds, setUserIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const ids = { c: useId(), t: useId(), k: useId() };
  return (
    <Dialog
      open
      onClose={onClose}
      title="נוהל חדש"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            ביטול
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={create.isPending}
            onClick={() => create.mutate({ code: code.trim(), title: title.trim(), category: category.trim() || 'כללי', audience, userIds }, { onSuccess: (p) => navigate(`/procedures/${p.id}`), onError: (e) => setError(errorMessage(e)) })}
          >
            יצירה
          </button>
        </>
      }
    >
      <div className="rule-editor">
        <div className="rule-row">
          <div className="field">
            <label htmlFor={ids.c}>קוד</label>
            <input id={ids.c} className="input" dir="ltr" maxLength={20} placeholder="SAF-012" value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={ids.k}>קטגוריה</label>
            <input id={ids.k} className="input" maxLength={60} value={category} onChange={(e) => setCategory(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor={ids.t}>שם הנוהל</label>
          <input id={ids.t} className="input" maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <AudienceFields audience={audience} setAudience={setAudience} userIds={userIds} setUserIds={setUserIds} />
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
      </div>
    </Dialog>
  );
}

export function ProcedurePage() {
  const { procedureId = '' } = useParams();
  const q = useProcedure(procedureId);
  const { user } = useAuth();
  const isManager = user?.role !== 'member';
  const acks = useProcedureAcks(procedureId, Boolean(isManager && q.data?.current));
  const { ack } = useProcedureMutations();
  const { toast } = useFeedback();
  const [publishing, setPublishing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  usePageTitle(q.data ? `${q.data.code} ${q.data.title}` : 'נוהל');
  if (q.isPending) return <LoadingState />;
  if (q.isError)
    return q.error instanceof ApiError && q.error.status === 404 ? (
      <div className="state" role="alert">
        <h1>הנוהל לא נמצא</h1>
        <Link to="/procedures" className="btn">
          לספריית הנהלים
        </Link>
      </div>
    ) : (
      <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
    );
  const p = q.data;
  const v = p.current;
  return (
    <article className="procedure">
      <div className="page-header">
        <div>
          <h1>
            <span className="num">{p.code}</span> · {p.title}
          </h1>
          <p className="muted" style={{ margin: 'var(--space-1) 0 0' }}>
            {p.category}
            {v ? ` · גרסה ${v.version} · בתוקף מ-${formatDateHe(v.effectiveOn)}` : ' · טרם פורסמה גרסה'} <AckBadge p={p} />
          </p>
        </div>
        <div className="actions no-print">
          {isManager && (
            <button type="button" className="btn btn-primary" onClick={() => setPublishing(true)}>
              <Icon name="plus" /> פרסום גרסה
            </button>
          )}
          <button type="button" className="btn" onClick={() => window.print()}>
            <Icon name="printer" /> PDF / הדפסה
          </button>
          <Link to="/procedures" className="btn">
            לכל הנהלים
          </Link>
        </div>
      </div>
      {v ? (
        <section className="card">
          {v.summary && (
            <p className="procedure-summary">
              <strong>מה השתנה:</strong> {v.summary}
            </p>
          )}
          {v.link && (
            <p>
              <a href={v.link} target="_blank" rel="noopener noreferrer">
                המסמך המלא במערכת המסמכים <Icon name="open" size={14} />
              </a>
            </p>
          )}
          {v.body && <div className="procedure-body">{v.body}</div>}
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            פורסם ע"י {v.publishedByName ?? 'משתמש'} · {formatDateHe(v.publishedAt.slice(0, 10))}
          </p>
          {p.forMe && !p.myAckAt && (
            <div className="ack-box no-print">
              <label className="check">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> קראתי את הנוהל (גרסה {v.version}) והבנתי אותו
              </label>
              <button type="button" className="btn btn-primary" disabled={!confirmed || ack.isPending} onClick={() => ack.mutate(v.id, { onSuccess: () => toast('אישור הקריאה נשמר'), onError: (e) => toast(errorMessage(e), 'error') })}>
                קראתי ואישרתי
              </button>
            </div>
          )}
          {p.myAckAt && <p className="badge success">אישרת קריאה ב-{formatDateHe(p.myAckAt.slice(0, 10))}</p>}
        </section>
      ) : (
        <p className="muted">לנוהל זה עדיין אין גרסה מפורסמת.</p>
      )}
      {isManager && acks.data && (
        <section className="card" aria-labelledby="ack-h" style={{ marginTop: 'var(--space-4)' }}>
          <h2 id="ack-h">
            אישורי קריאה — גרסה {v?.version} ({acks.data.acked.length}/{acks.data.acked.length + acks.data.pending.length})
          </h2>
          <div className="report-columns" style={{ marginTop: 0 }}>
            <div>
              <h3>ממתינים ({acks.data.pending.length})</h3>
              <ul className="report-items">
                {acks.data.pending.map((u) => (
                  <li key={u.userId}>{u.name}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3>אישרו ({acks.data.acked.length})</h3>
              <ul className="report-items">
                {acks.data.acked.map((u) => (
                  <li key={u.userId}>
                    {u.name} <span className="muted">· {formatDateHe(u.at.slice(0, 10))}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}
      {p.versions.length > 1 && (
        <section className="card" aria-labelledby="ver-h" style={{ marginTop: 'var(--space-4)' }}>
          <h2 id="ver-h">היסטוריית גרסאות</h2>
          <ul className="report-items">
            {p.versions.map((x) => (
              <li key={x.id}>
                גרסה {x.version} · בתוקף מ-{formatDateHe(x.effectiveOn)}
                {x.id === v?.id && ' (נוכחית)'}
              </li>
            ))}
          </ul>
        </section>
      )}
      {publishing && <PublishDialog procedure={p} onClose={() => setPublishing(false)} />}
    </article>
  );
}

function PublishDialog({ procedure, onClose }: { procedure: Procedure; onClose: () => void }) {
  const { publish } = useProcedureMutations();
  const { toast } = useFeedback();
  const [version, setVersion] = useState('');
  const [effectiveOn, setEffectiveOn] = useState(todayIso());
  const [summary, setSummary] = useState('');
  const [body, setBody] = useState(procedure.current?.body ?? '');
  const [link, setLink] = useState(procedure.current?.link ?? '');
  const [error, setError] = useState<string | null>(null);
  const ids = { v: useId(), e: useId(), s: useId(), b: useId(), l: useId() };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    publish.mutate(
      { id: procedure.id, input: { version: version.trim(), effectiveOn, summary, body, link: link.trim() || null } },
      { onSuccess: () => (toast('הגרסה פורסמה — הקהל התבקש לאשר קריאה'), onClose()), onError: (err) => setError(errorMessage(err)) },
    );
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={`גרסה חדשה: ${procedure.code}`}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            ביטול
          </button>
          <button type="submit" form="publish-form" className="btn btn-primary" disabled={publish.isPending || !version.trim()}>
            פרסום
          </button>
        </>
      }
    >
      <form id="publish-form" className="rule-editor" onSubmit={submit}>
        <div className="rule-row">
          <div className="field">
            <label htmlFor={ids.v}>מספר גרסה</label>
            <input id={ids.v} className="input" maxLength={20} placeholder={procedure.current ? `אחרי ${procedure.current.version}` : '1.0'} value={version} onChange={(e) => setVersion(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={ids.e}>בתוקף מ-</label>
            <input id={ids.e} type="date" className="input" value={effectiveOn} onChange={(e) => setEffectiveOn(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor={ids.s}>מה השתנה</label>
          <textarea id={ids.s} className="textarea" rows={2} maxLength={1000} value={summary} onChange={(e) => setSummary(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={ids.l}>קישור למסמך המלא (לא חובה)</label>
          <input id={ids.l} className="input" dir="ltr" maxLength={2000} placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={ids.b}>תוכן הנוהל</label>
          <textarea id={ids.b} className="textarea" rows={10} maxLength={50000} value={body} onChange={(e) => setBody(e.target.value)} />
          <span className="hint">יש להזין תוכן או קישור. פרסום גרסה מבקש מכל הקהל לאשר קריאה מחדש.</span>
        </div>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
      </form>
    </Dialog>
  );
}
