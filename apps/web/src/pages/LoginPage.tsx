import { loginSchema } from '@suboard/shared';
import { useRef, useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { errorMessage, safeNextPath } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Footer, Logo, usePageTitle } from '../components/Layout';

export function LoginPage() {
  usePageTitle('התחברות');
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const next = safeNextPath(params.get('next'));

  if (user) return <Navigate to={user.mustChangePassword ? '/profile' : next} replace />;

  const onSubmit = async (e: FormEvent) => {
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
      const u = await login(parsed.data.email, parsed.data.password);
      navigate(u.mustChangePassword ? '/profile' : next, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setPassword('');
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <main className="auth-page" id="main">
        <div className="card auth-card">
          <div className="brand">
            <Logo />
            <span>SUBoard · יחידת הבטיחות</span>
          </div>
          <h1>התחברות למערכת</h1>
          <p className="muted">מערכת פנימית. הגישה למורשים בלבד.</p>
          {error && (
            <div className="form-error" role="alert" tabIndex={-1} ref={errorRef}>
              {error}
            </div>
          )}
          <form onSubmit={onSubmit} noValidate>
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
          <p className="muted" style={{ marginTop: '1rem', fontSize: '0.875rem' }}>
            שכחת סיסמה? פנו למנהל המערכת לאיפוס.
          </p>
        </div>
      </main>
      <Footer />
    </>
  );
}
