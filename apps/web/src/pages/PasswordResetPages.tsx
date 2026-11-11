import { forgotPasswordSchema, LIMITS, passwordSchema } from '@suboard/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import unitLogo from '../assets/safety-unit-logo.webp';
import { api, ApiError, errorMessage } from '../api/client';
import { A11yToolbar } from '../components/A11yToolbar';
import { Footer, Logo, usePageTitle } from '../components/Layout';

function AuthShell({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) {
  return (
    <>
      <main className="auth-page" id="main">
        <div className="card auth-card">
          <img src={unitLogo} className="unit-logo" width={720} height={315} alt="יחידת הבטיחות — Safety Unit" />
          <div className="brand">
            <Logo />
            <span>SUBoard · יחידת הבטיחות</span>
          </div>
          <h1>{title}</h1>
          <p className="muted">{intro}</p>
          {children}
          <p className="auth-aside">
            <Link to="/login">חזרה לכניסה</Link>
          </p>
        </div>
      </main>
      <Footer />
      <A11yToolbar />
    </>
  );
}

/** "Forgot password": always the same confirmation, whether or not the address is registered. */
export function ForgotPasswordPage() {
  usePageTitle('שכחתי סיסמה');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const doneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (sent) doneRef.current?.focus();
  }, [sent]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setError('יש להזין כתובת דוא"ל תקינה');
    setError(null);
    setBusy(true);
    try {
      await api('/auth/password/forgot', 'POST', forgotPasswordSchema.parse({ email }));
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? 'נשלחו יותר מדי בקשות. נסו שוב בעוד כמה דקות.' : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="שכחתי סיסמה" intro="הזינו את כתובת הדוא״ל של החשבון, ונשלח אליה קישור לבחירת סיסמה חדשה.">
      {sent ? (
        <div className="form-success" role="status" tabIndex={-1} ref={doneRef}>
          <strong>אם הכתובת רשומה במערכת ומורשית להתחבר בסיסמה — נשלח אליה קישור.</strong>
          <br />
          הקישור תקף ל-30 דקות ולשימוש אחד. לא הגיע? בדקו בדואר הזבל, או פנו למנהל המערכת.
        </div>
      ) : (
        <form onSubmit={submit} noValidate>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <div className="field">
            <label htmlFor="fp-email">דוא"ל</label>
            <input id="fp-email" className="input" type="email" autoComplete="username" dir="ltr" required value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-primary" style={{ inlineSize: '100%' }} disabled={busy} aria-busy={busy}>
            {busy ? 'שולח…' : 'שליחת קישור לאיפוס'}
          </button>
        </form>
      )}
    </AuthShell>
  );
}

/** Choose a new password from the e-mailed link (token in the URL fragment, removed from the address bar at once). */
export function ResetPasswordPage() {
  usePageTitle('בחירת סיסמה חדשה');
  const [token] = useState(() => /(?:^#|&)token=([A-Za-z0-9_-]{43})/.exec(window.location.hash)?.[1] ?? null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [errors, setErrors] = useState<{ pw?: string; pw2?: string; _?: string }>({});
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const doneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Keep the one-time token out of history, bookmarks and screen shares.
    if (window.location.hash) history.replaceState(null, '', window.location.pathname);
  }, []);
  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const p = passwordSchema.safeParse(pw);
    const next: typeof errors = {};
    if (!p.success) next.pw = p.error.issues[0]?.message;
    if (pw !== pw2) next.pw2 = 'הסיסמאות אינן זהות';
    setErrors(next);
    if (next.pw || next.pw2 || !token) return;
    setBusy(true);
    try {
      await api('/auth/password/reset', 'POST', { token, newPassword: pw });
      setDone(true);
      setPw('');
      setPw2('');
    } catch (err) {
      setErrors({ _: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  if (!token)
    return (
      <AuthShell title="בחירת סיסמה חדשה" intro="">
        <div className="form-error" role="alert">
          הקישור אינו שלם. פתחו אותו שוב מתוך הדוא״ל, או <Link to="/forgot-password">בקשו קישור חדש</Link>.
        </div>
      </AuthShell>
    );

  return (
    <AuthShell title="בחירת סיסמה חדשה" intro={`לפחות ${LIMITS.passwordMin} תווים. מומלץ משפט סיסמה ארוך שקל לזכור. אחרי השינוי כל החיבורים הפתוחים ינותקו.`}>
      {done ? (
        <div className="form-success" role="status" tabIndex={-1} ref={doneRef}>
          <strong>הסיסמה עודכנה.</strong> אפשר להתחבר עכשיו עם הסיסמה החדשה. אם הוגדר אימות דו-שלבי — הוא עדיין נדרש.
          <p style={{ margin: 'var(--space-3) 0 0' }}>
            <Link to="/login" className="btn btn-primary">
              לכניסה
            </Link>
          </p>
        </div>
      ) : (
        <form onSubmit={submit} noValidate>
          {errors._ && (
            <div className="form-error" role="alert">
              {errors._} {errors._.includes('קישור') && <Link to="/forgot-password">בקשת קישור חדש</Link>}
            </div>
          )}
          <div className="field">
            <label htmlFor="rp-pw">סיסמה חדשה</label>
            <input
              id="rp-pw"
              className="input"
              type="password"
              autoComplete="new-password"
              dir="ltr"
              required
              value={pw}
              maxLength={LIMITS.passwordMax}
              onChange={(e) => setPw(e.target.value)}
              aria-invalid={Boolean(errors.pw)}
              aria-describedby={`rp-pw-hint${errors.pw ? ' rp-pw-err' : ''}`}
            />
            <span id="rp-pw-hint" className="hint">
              לפחות {LIMITS.passwordMin} תווים.
            </span>
            {errors.pw && (
              <span id="rp-pw-err" className="error">
                {errors.pw}
              </span>
            )}
          </div>
          <div className="field">
            <label htmlFor="rp-pw2">אימות הסיסמה החדשה</label>
            <input
              id="rp-pw2"
              className="input"
              type="password"
              autoComplete="new-password"
              dir="ltr"
              required
              value={pw2}
              maxLength={LIMITS.passwordMax}
              onChange={(e) => setPw2(e.target.value)}
              aria-invalid={Boolean(errors.pw2)}
              aria-describedby={errors.pw2 ? 'rp-pw2-err' : undefined}
            />
            {errors.pw2 && (
              <span id="rp-pw2-err" className="error">
                {errors.pw2}
              </span>
            )}
          </div>
          <button type="submit" className="btn btn-primary" style={{ inlineSize: '100%' }} disabled={busy} aria-busy={busy}>
            {busy ? 'שומר…' : 'שמירת הסיסמה החדשה'}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
