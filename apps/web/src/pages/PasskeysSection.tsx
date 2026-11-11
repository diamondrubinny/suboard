import type { PasskeyInfo } from '@suboard/shared';
import { useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, errorMessage } from '../api/client';
import { qk, usePasskeys, useRemovePasskey } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { passkeyErrorMessage, passkeysSupported } from '../auth/passkeys';
import { Dialog } from '../components/Dialog';
import { ErrorState, LoadingState, useFeedback } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { formatDateTime } from './board/activityText';

/** "Passkeys": sign in with the device's fingerprint / face / PIN instead of a password. */
export function PasskeysSection() {
  const { user } = useAuth();
  const q = usePasskeys();
  const remove = useRemovePasskey();
  const qc = useQueryClient();
  const { toast, confirm } = useFeedback();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  if (!user) return null;
  const supported = passkeysSupported();
  const needsPassword = user.authSource === 'local';

  const close = () => {
    setOpen(false);
    setPassword('');
    setError(null);
  };

  const onAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (needsPassword && !password) {
      setError('יש להזין את הסיסמה הנוכחית');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const { startRegistration } = await import('@simplewebauthn/browser');
      const { challengeId, options } = await api<{ challengeId: string; options: Parameters<typeof startRegistration>[0]['optionsJSON'] }>(
        '/auth/passkeys/register/options',
        'POST',
        needsPassword ? { password } : {},
      );
      const response = await startRegistration({ optionsJSON: options });
      const { passkey } = await api<{ passkey: PasskeyInfo }>('/auth/passkeys/register/verify', 'POST', { challengeId, name: name.trim() || undefined, response });
      await qc.invalidateQueries({ queryKey: qk.passkeys });
      setName('');
      close();
      toast(`מפתח הגישה "${passkey.name}" נוסף. מעכשיו אפשר להתחבר איתו בלי סיסמה.`);
    } catch (err) {
      setError(passkeyErrorMessage(err, 'register') ?? (err instanceof ApiError ? errorMessage(err) : 'הוספת מפתח הגישה נכשלה. נסו שוב.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-labelledby="passkeys-h">
      <h2 id="passkeys-h">מפתחות גישה (Passkeys)</h2>
      <p className="muted">
        כניסה בלי סיסמה, עם טביעת אצבע, זיהוי פנים או קוד הנעילה של המכשיר. המפתח נשמר במכשיר שלך בלבד; המערכת שומרת רק מפתח ציבורי, ואינה מקבלת מידע ביומטרי.
      </p>
      {q.isPending && <LoadingState />}
      {q.isError && <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {q.data && q.data.length === 0 && <p className="hint">עדיין לא הוגדר מפתח גישה.</p>}
      {q.data && q.data.length > 0 && (
        <ul className="list-plain session-list" aria-label="מפתחות הגישה שלי">
          {q.data.map((p) => (
            <li key={p.id} className="session-row">
              <Icon name="lock" />
              <div>
                <strong>{p.name}</strong>
                {p.synced && <span className="badge">מסונכרן בין המכשירים שלך</span>}
                <br />
                <small className="muted">
                  נוסף: <time dateTime={p.createdAt}>{formatDateTime(p.createdAt)}</time> ·{' '}
                  {p.lastUsedAt ? (
                    <>
                      שימוש אחרון: <time dateTime={p.lastUsedAt}>{formatDateTime(p.lastUsedAt)}</time>
                    </>
                  ) : (
                    'טרם נעשה בו שימוש'
                  )}
                </small>
              </div>
              <button
                type="button"
                className="btn btn-sm"
                disabled={remove.isPending}
                aria-label={`מחיקה: מפתח הגישה ${p.name}`}
                onClick={async () => {
                  if (!(await confirm({ title: 'מחיקת מפתח גישה', message: `לא יהיה אפשר עוד להתחבר עם "${p.name}". כדאי למחוק אותו גם מהמכשיר עצמו.`, confirmLabel: 'מחיקה', danger: true }))) return;
                  remove.mutate(p.id, { onSuccess: () => toast('מפתח הגישה נמחק'), onError: (e) => toast(errorMessage(e), 'error') });
                }}
              >
                מחיקה
              </button>
            </li>
          ))}
        </ul>
      )}
      {supported ? (
        <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
          הוספת מפתח גישה
        </button>
      ) : (
        <p className="hint" role="note">
          הדפדפן או החיבור הנוכחי אינם תומכים במפתחות גישה (נדרש חיבור מאובטח ודפדפן עדכני).
        </p>
      )}
      <Dialog
        open={open}
        onClose={close}
        title="הוספת מפתח גישה"
        initialFocusRef={nameRef}
        footer={
          <>
            <button type="button" className="btn" onClick={close}>
              ביטול
            </button>
            <button type="submit" form="add-passkey" className="btn btn-primary" disabled={busy} aria-busy={busy}>
              {busy ? 'ממתין למכשיר…' : 'המשך'}
            </button>
          </>
        }
      >
        <form id="add-passkey" onSubmit={onAdd} noValidate>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <div className="field">
            <label htmlFor="passkey-name">שם למפתח (לא חובה)</label>
            <input id="passkey-name" ref={nameRef} className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} aria-describedby="passkey-name-hint" autoComplete="off" />
            <span id="passkey-name-hint" className="hint">
              למשל "האייפון שלי" או "המחשב במשרד". בלי שם — יירשם סוג הדפדפן והמכשיר.
            </span>
          </div>
          {needsPassword && (
            <div className="field">
              <label htmlFor="passkey-password">הסיסמה הנוכחית</label>
              <input
                id="passkey-password"
                type="password"
                className="input"
                dir="ltr"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-describedby="passkey-password-hint"
              />
              <span id="passkey-password-hint" className="hint">
                לאישור שזה באמת את/ה לפני הוספת דרך כניסה חדשה.
              </span>
            </div>
          )}
          <p className="muted">בשלב הבא המכשיר יבקש טביעת אצבע, זיהוי פנים או קוד נעילה.</p>
        </form>
      </Dialog>
    </section>
  );
}
