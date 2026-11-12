import type { ApiTokenInfo } from '@suboard/shared';
import { useRef, useState, type FormEvent } from 'react';
import { errorMessage } from '../api/client';
import { useApiTokenMutations, useApiTokens } from '../api/hooks';
import { Dialog } from '../components/Dialog';
import { ErrorState, LoadingState, useFeedback } from '../components/Feedback';
import { formatDateTime } from './board/activityText';

const SCOPE_LABEL: Record<ApiTokenInfo['scope'], string> = { read: 'קריאה בלבד', write: 'קריאה וכתיבה' };

/** Personal API tokens: let a script use the API as you, with your permissions. */
export function ApiTokensSection() {
  const q = useApiTokens();
  const { create, revoke } = useApiTokenMutations();
  const { toast, confirm } = useFeedback();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<ApiTokenInfo['scope']>('read');
  const [days, setDays] = useState<30 | 90 | 365>(90);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('יש לתת שם לאסימון');
    setError(null);
    create.mutate(
      { name: name.trim(), scope, days },
      {
        onSuccess: (r) => {
          setOpen(false);
          setName('');
          setToken(r.token);
        },
        onError: (err) => setError(errorMessage(err)),
      },
    );
  };

  return (
    <section className="card" aria-labelledby="tokens-h">
      <h2 id="tokens-h">אסימוני API</h2>
      <p className="muted">
        אסימון מאפשר לסקריפט או לכלי אחר לפעול בשמך דרך ה-API, <strong>בהרשאות שלך בלבד</strong>. מי שמחזיק באסימון יכול לקרוא (ואם בחרת — גם לשנות) כל מה שאת/ה רואה. אל תשתפו אותו ואל תשמרו אותו בקוד.
      </p>
      {q.isPending && <LoadingState />}
      {q.isError && <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {q.data && q.data.length === 0 && <p className="hint">אין אסימונים.</p>}
      {q.data && q.data.length > 0 && (
        <ul className="list-plain session-list" aria-label="האסימונים שלי">
          {q.data.map((t) => (
            <li key={t.id} className="session-row">
              <div>
                <strong>{t.name}</strong> <span className="badge">{SCOPE_LABEL[t.scope]}</span> <code dir="ltr">…{t.hint}</code>
                <br />
                <small className="muted">
                  בתוקף עד <time dateTime={t.expiresAt}>{formatDateTime(t.expiresAt)}</time> ·{' '}
                  {t.lastUsedAt ? (
                    <>
                      שימוש אחרון: <time dateTime={t.lastUsedAt}>{formatDateTime(t.lastUsedAt)}</time>
                    </>
                  ) : (
                    'טרם נעשה בו שימוש'
                  )}
                </small>
              </div>
              <button
                type="button"
                className="btn btn-sm"
                disabled={revoke.isPending}
                aria-label={`ביטול: האסימון ${t.name}`}
                onClick={async () => {
                  if (await confirm({ title: 'ביטול אסימון', message: `כל כלי שמשתמש באסימון "${t.name}" יפסיק לעבוד מיד.`, confirmLabel: 'ביטול האסימון', danger: true }))
                    revoke.mutate(t.id, { onSuccess: () => toast('האסימון בוטל'), onError: (e) => toast(errorMessage(e), 'error') });
                }}
              >
                ביטול
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        אסימון חדש
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="אסימון API חדש"
        initialFocusRef={nameRef}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              סגירה
            </button>
            <button type="submit" form="new-token" className="btn btn-primary" disabled={create.isPending}>
              יצירה
            </button>
          </>
        }
      >
        <form id="new-token" onSubmit={submit} noValidate>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <div className="field">
            <label htmlFor="tok-name">למה משמש האסימון?</label>
            <input id="tok-name" ref={nameRef} className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder='למשל "סנכרון מלאי"' />
          </div>
          <div className="field">
            <label htmlFor="tok-scope">הרשאה</label>
            <select id="tok-scope" className="select" value={scope} onChange={(e) => setScope(e.target.value as ApiTokenInfo['scope'])}>
              <option value="read">קריאה בלבד (מומלץ)</option>
              <option value="write">קריאה וכתיבה</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="tok-days">תוקף</label>
            <select id="tok-days" className="select" value={days} onChange={(e) => setDays(Number(e.target.value) as 30 | 90 | 365)}>
              <option value={30}>30 יום</option>
              <option value={90}>90 יום</option>
              <option value={365}>שנה</option>
            </select>
          </div>
        </form>
      </Dialog>

      <Dialog open={token !== null} onClose={() => setToken(null)} title="האסימון נוצר">
        <p>
          <strong>האסימון מוצג פעם אחת בלבד.</strong> העתיקו אותו עכשיו למקום מאובטח (מנהל סיסמאות או משתנה סביבה).
        </p>
        <div className="field">
          <label htmlFor="tok-value">האסימון</label>
          <input id="tok-value" className="input" dir="ltr" readOnly value={token ?? ''} onFocus={(e) => e.target.select()} />
        </div>
        <p className="hint">
          שימוש: כותרת <code dir="ltr">Authorization: Bearer …</code> בכל בקשה ל-API. אסימון אינו יכול לשנות סיסמה, לנהל משתמשים או ליצור אסימונים אחרים.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(token ?? '');
              toast('האסימון הועתק');
            } catch {
              toast('ההעתקה נכשלה — סמנו והעתיקו ידנית', 'error');
            }
          }}
        >
          העתקה
        </button>
      </Dialog>
    </section>
  );
}
