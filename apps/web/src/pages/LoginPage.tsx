import { loginSchema, mfaCodeSchema, type SessionUser } from '@suboard/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, errorMessage, safeNextPath } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import unitLogo from '../assets/safety-unit-logo.webp';
import { A11yToolbar } from '../components/A11yToolbar';
import { Footer, Logo, usePageTitle } from '../components/Layout';

export function LoginPage() {
  usePageTitle('התחברות');
  const { user, login, verifyMfa } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const next = safeNextPath(params.get('next'));

  useEffect(() => {
    if (challenge) codeRef.current?.focus();
  }, [challenge, useRecovery]);

  if (user) return <Navigate to={user.mustChangePassword || user.mfaSetupRequired ? '/profile' : next} replace />;

  const fail = (err: unknown) => {
    setError(errorMessage(err));
    requestAnimationFrame(() => errorRef.current?.focus());
  };
  const done = (u: SessionUser) => navigate(u.mustChangePassword || u.mfaSetupRequired ? '/profile' : next, { replace: true });

  const onPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const i of parsed.error.issues) fe[String(i.path[0])] ??= i.message;
      setFieldErrors(fe);
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      const res = await login(parsed.data.email, parsed.data.password);
      setPassword('');
      if ('challengeToken' in res) setChallenge(res.challengeToken);
      else done(res.user);
    } catch (err) {
      setPassword('');
      fail(err);
    } finally {
      setSubmitting(false);
    }
  };

  const onCode = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting || !challenge) return;
    setError(null);
    const parsed = mfaCodeSchema.safeParse(code);
    if (!parsed.success) {
      setFieldErrors({ code: useRecovery ? 'קוד שחזור בפורמט xxxxx-xxxxx' : 'יש להזין 6 ספרות' });
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      done(await verifyMfa(challenge, parsed.data));
    } catch (err) {
      setCode('');
      if (err instanceof ApiError && err.code === 'MFA_CHALLENGE_EXPIRED') {
        setChallenge(null);
        setUseRecovery(false);
      }
      fail(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <main className="auth-page" id="main">
        <div className="card auth-card">
          <img src={unitLogo} className="unit-logo" width={720} height={315} alt="יחידת הבטיחות — Safety Unit" />
          <div className="brand">
            <Logo />
            <span>SUBoard · יחידת הבטיחות</span>
          </div>
          <h1>{challenge ? 'אימות דו-שלבי' : 'התחברות למערכת'}</h1>
          <p className="muted">
            {challenge
              ? useRecovery
                ? 'הזינו אחד מקודי השחזור שקיבלתם בעת ההגדרה. כל קוד תקף פעם אחת.'
                : 'הזינו את הקוד בן 6 הספרות מאפליקציית האימות.'
              : 'מערכת פנימית. הגישה למורשים בלבד.'}
          </p>
          {error && (
            <div className="form-error" role="alert" tabIndex={-1} ref={errorRef}>
              {error}
            </div>
          )}

          {!challenge ? (
            <form onSubmit={onPassword} noValidate>
              <div className="field">
                <label htmlFor="email">דוא"ל</label>
                <input
                  id="email"
                  className="input"
                  type="email"
                  autoComplete="username"
                  dir="ltr"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={Boolean(fieldErrors.email)}
                  aria-describedby={fieldErrors.email ? 'email-error' : undefined}
                />
                {fieldErrors.email && (
                  <span id="email-error" className="error">
                    {fieldErrors.email}
                  </span>
                )}
              </div>
              <div className="field">
                <label htmlFor="password">סיסמה</label>
                <input
                  id="password"
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  dir="ltr"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={Boolean(fieldErrors.password)}
                  aria-describedby={fieldErrors.password ? 'password-error' : undefined}
                />
                {fieldErrors.password && (
                  <span id="password-error" className="error">
                    {fieldErrors.password}
                  </span>
                )}
              </div>
              <button type="submit" className="btn btn-primary" style={{ inlineSize: '100%' }} disabled={submitting} aria-busy={submitting}>
                {submitting ? 'מתחבר…' : 'התחברות'}
              </button>
            </form>
          ) : (
            <form onSubmit={onCode} noValidate>
              <div className="field">
                <label htmlFor="mfa-code">{useRecovery ? 'קוד שחזור' : 'קוד אימות'}</label>
                <input
                  id="mfa-code"
                  ref={codeRef}
                  className="input"
                  dir="ltr"
                  autoComplete="one-time-code"
                  inputMode={useRecovery ? 'text' : 'numeric'}
                  maxLength={useRecovery ? 11 : 6}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  aria-invalid={Boolean(fieldErrors.code)}
                  aria-describedby={fieldErrors.code ? 'code-error' : undefined}
                  style={{ letterSpacing: '0.2em', textAlign: 'center', fontSize: '1.2rem' }}
                />
                {fieldErrors.code && (
                  <span id="code-error" className="error">
                    {fieldErrors.code}
                  </span>
                )}
              </div>
              <button type="submit" className="btn btn-primary" style={{ inlineSize: '100%' }} disabled={submitting} aria-busy={submitting}>
                {submitting ? 'מאמת…' : 'אימות'}
              </button>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.75rem', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => (setUseRecovery((r) => !r), setCode(''), setFieldErrors({}))}>
                  {useRecovery ? 'שימוש בקוד מהאפליקציה' : 'אין גישה לאפליקציה? קוד שחזור'}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => (setChallenge(null), setCode(''), setError(null))}>
                  חזרה
                </button>
              </div>
            </form>
          )}
          <p className="muted" style={{ marginTop: '1rem', fontSize: '0.875rem' }}>
            שכחת סיסמה או איבדת את מכשיר האימות? פנו למנהל המערכת לאיפוס.
          </p>
        </div>
      </main>
      <Footer />
      <A11yToolbar />
    </>
  );
}
