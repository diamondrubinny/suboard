import type { MfaSetup, SessionUser } from '@suboard/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api/client';
import { qk, useMeMeta } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { useFeedback } from '../components/Feedback';

/** Groups a base32 secret in blocks of 4 for manual entry. */
const groupSecret = (s: string) => s.match(/.{1,4}/g)?.join(' ') ?? s;

export function MfaSection() {
  const { user, setUser } = useAuth();
  const meta = useMeMeta();
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [pendingUser, setPendingUser] = useState<SessionUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);
  const codesRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (setup) codeRef.current?.focus();
  }, [setup]);
  useEffect(() => {
    if (recoveryCodes) codesRef.current?.focus();
  }, [recoveryCodes]);

  if (!user) return null;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const start = () => run(async () => setSetup(await api<MfaSetup>('/auth/mfa/setup', 'POST')));

  const enable = (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) return setError('יש להזין את 6 הספרות מהאפליקציה');
    void run(async () => {
      const res = await api<{ recoveryCodes: string[]; user: SessionUser }>('/auth/mfa/enable', 'POST', { code: code.trim() });
      setRecoveryCodes(res.recoveryCodes);
      setPendingUser(res.user);
      setSetup(null);
      setCode('');
    });
  };

  const finish = () => {
    if (pendingUser) setUser(pendingUser);
    setRecoveryCodes(null);
    void qc.invalidateQueries({ queryKey: qk.meMeta });
    toast('אימות דו-שלבי הופעל. חיבורים אחרים שלך נותקו.');
  };

  const disable = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const res = await api<{ user: SessionUser }>('/auth/mfa/disable', 'POST', { password, code });
      setUser(res.user);
      setPassword('');
      setCode('');
      toast('אימות דו-שלבי בוטל');
    });
  };

  const downloadCodes = () => {
    const blob = new Blob([`SUBoard — קודי שחזור (${user.email})\n\n${recoveryCodes?.join('\n')}\n\nכל קוד תקף פעם אחת. שמרו במקום בטוח.\n`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'suboard-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="card" aria-labelledby="mfa-h">
      <h2 id="mfa-h">אימות דו-שלבי (MFA)</h2>
      {user.mfaSetupRequired && !recoveryCodes && (
        <div className="draft-banner" role="alert">
          התפקיד שלך מחייב אימות דו-שלבי. יש להפעיל אותו כדי להמשיך לעבוד במערכת.
        </div>
      )}
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}

      {recoveryCodes ? (
        <div>
          <h3 ref={codesRef} tabIndex={-1}>
            קודי שחזור — שמרו אותם עכשיו
          </h3>
          <p>אם תאבדו את הטלפון, ניתן להתחבר עם אחד הקודים. כל קוד תקף פעם אחת, והם מוצגים <strong>רק עכשיו</strong>.</p>
          <ul className="list-plain" dir="ltr" style={{ columns: 2, fontFamily: 'monospace', fontSize: '1.05rem', marginBottom: '1rem' }} aria-label="קודי שחזור">
            {recoveryCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="toolbar">
            <button type="button" className="btn" onClick={downloadCodes}>
              הורדה כקובץ
            </button>
            <button type="button" className="btn" onClick={() => void navigator.clipboard?.writeText(recoveryCodes.join('\n')).then(() => toast('הקודים הועתקו'))}>
              העתקה
            </button>
            <button type="button" className="btn btn-primary" onClick={finish}>
              שמרתי את הקודים
            </button>
          </div>
        </div>
      ) : user.mfaEnabled ? (
        <>
          <p>
            <span className="badge success">פעיל</span>{' '}
            {meta.data?.recoveryCodesLeft !== null && meta.data?.recoveryCodesLeft !== undefined && (
              <span className={meta.data.recoveryCodesLeft <= 2 ? 'badge danger' : 'badge'}>נותרו {meta.data.recoveryCodesLeft} קודי שחזור</span>
            )}
          </p>
          <details>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>ביטול אימות דו-שלבי</summary>
            <form onSubmit={disable} noValidate style={{ marginTop: '0.75rem' }}>
              <div className="field">
                <label htmlFor="mfa-dis-pw">סיסמה</label>
                <input id="mfa-dis-pw" className="input" type="password" dir="ltr" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="mfa-dis-code">קוד אימות או קוד שחזור</label>
                <input id="mfa-dis-code" className="input" dir="ltr" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
              </div>
              <button type="submit" className="btn btn-danger" disabled={busy}>
                ביטול אימות דו-שלבי
              </button>
            </form>
          </details>
        </>
      ) : setup ? (
        <form onSubmit={enable} noValidate>
          <ol style={{ paddingInlineStart: '1.25rem' }}>
            <li>התקינו אפליקציית אימות (למשל Microsoft Authenticator, Google Authenticator או 1Password).</li>
            <li>סרקו את הקוד, או הזינו ידנית את המפתח.</li>
            <li>הזינו את הקוד בן 6 הספרות שמופיע באפליקציה.</li>
          </ol>
          <img
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(setup.qrSvg)}`}
            alt="קוד QR להגדרת אפליקציית האימות. ניתן להשתמש במפתח הידני המוצג מתחת."
            width={200}
            height={200}
            style={{ background: '#fff', borderRadius: 8, display: 'block', marginBlock: '0.75rem' }}
          />
          <p>
            מפתח ידני:{' '}
            <code dir="ltr" style={{ fontSize: '1rem', userSelect: 'all' }}>
              {groupSecret(setup.secret)}
            </code>
          </p>
          <div className="field">
            <label htmlFor="mfa-code-setup">קוד מהאפליקציה</label>
            <input
              id="mfa-code-setup"
              ref={codeRef}
              className="input"
              dir="ltr"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              style={{ maxInlineSize: '12rem', letterSpacing: '0.2em', textAlign: 'center' }}
            />
          </div>
          <div className="toolbar">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              הפעלה
            </button>
            <button type="button" className="btn" onClick={() => (setSetup(null), setCode(''))}>
              ביטול
            </button>
          </div>
        </form>
      ) : (
        <>
          <p>שכבת הגנה נוספת: בכל התחברות יידרש גם קוד מאפליקציית אימות בטלפון.</p>
          <button type="button" className="btn btn-primary" onClick={start} disabled={busy}>
            הפעלת אימות דו-שלבי
          </button>
        </>
      )}
    </section>
  );
}

export function NotificationPrefsSection() {
  const { user, setUser } = useAuth();
  const meta = useMeMeta();
  const { toast } = useFeedback();
  // Optimistic local state: the checkbox reflects the click immediately and reverts on error.
  const [checked, setChecked] = useState(user?.emailNotifications ?? true);
  useEffect(() => {
    if (user) setChecked(user.emailNotifications);
  }, [user?.emailNotifications]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!user) return null;

  const onChange = async (next: boolean) => {
    setChecked(next);
    try {
      const res = await api<{ user: SessionUser }>('/auth/preferences', 'PATCH', { emailNotifications: next });
      setUser(res.user);
      toast('ההעדפה נשמרה');
    } catch (err) {
      setChecked(!next);
      toast(errorMessage(err), 'error');
    }
  };

  return (
    <section className="card" aria-labelledby="notif-h">
      <h2 id="notif-h">התראות</h2>
      <p className="muted">התראות במערכת (פעמון בראש המסך) תמיד פעילות: שיוך לפריט, פריטים באיחור ויעד מחר.</p>
      <label className="checkbox-row">
        <input type="checkbox" checked={checked} onChange={(e) => void onChange(e.target.checked)} />
        קבלת התראות גם בדוא"ל
      </label>
      {meta.data && !meta.data.emailAvailable && <p className="hint muted" style={{ marginTop: '0.5rem' }}>שליחת דוא"ל אינה מוגדרת כרגע בשרת; ההעדפה תיכנס לתוקף כשתוגדר.</p>}
      {(user.role === 'admin' || user.role === 'manager') && <MonthlyPref />}
    </section>
  );
}

/** Managers / admins: monthly management report on the 1st (in the bell + e-mail). */
function MonthlyPref() {
  const { user, setUser } = useAuth();
  const { toast } = useFeedback();
  const [checked, setChecked] = useState(user?.monthlyReport ?? false);
  useEffect(() => {
    if (user) setChecked(user.monthlyReport);
  }, [user?.monthlyReport]); // eslint-disable-line react-hooks/exhaustive-deps
  const onChange = async (next: boolean) => {
    setChecked(next);
    try {
      const res = await api<{ user: SessionUser }>('/auth/preferences', 'PATCH', { monthlyReport: next });
      setUser(res.user);
      toast('ההעדפה נשמרה');
    } catch (err) {
      setChecked(!next);
      toast(errorMessage(err), 'error');
    }
  };
  return (
    <label className="checkbox-row" style={{ marginTop: 'var(--space-3)' }}>
      <input type="checkbox" checked={checked} onChange={(e) => void onChange(e.target.checked)} />
      דוח "מבט מנהל" חודשי ב-1 לכל חודש (ספירות בלבד, ללא שמות פריטים)
    </label>
  );
}
