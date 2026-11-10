import { changePasswordSchema, GLOBAL_ROLE_LABELS, LIMITS } from '@suboard/shared';
import { useState, type FormEvent } from 'react';
import { api, ApiError, errorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useFeedback } from '../components/Feedback';
import { usePageTitle } from '../components/Layout';
import { MfaSection, NotificationPrefsSection } from './MfaSection';

export function ProfilePage() {
  usePageTitle('פרופיל');
  const { user, refresh } = useAuth();
  const { toast } = useFeedback();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (!user) return null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setFormError(null);
    const fe: Record<string, string> = {};
    const parsed = changePasswordSchema.safeParse({ currentPassword: form.currentPassword, newPassword: form.newPassword });
    if (!parsed.success) for (const i of parsed.error.issues) fe[String(i.path[0])] ??= i.message;
    if (form.newPassword !== form.confirm) fe.confirm = 'האימות אינו תואם לסיסמה החדשה';
    setErrors(fe);
    if (Object.keys(fe).length) return;

    setSaving(true);
    try {
      await api('/auth/change-password', 'POST', { currentPassword: form.currentPassword, newPassword: form.newPassword });
      setForm({ currentPassword: '', newPassword: '', confirm: '' });
      toast('הסיסמה עודכנה. התנתקת מכל שאר המכשירים.');
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const field = (key: keyof typeof form, label: string, autoComplete: string, hint?: string) => (
    <div className="field">
      <label htmlFor={key}>{label}</label>
      <input
        id={key}
        type="password"
        className="input"
        dir="ltr"
        autoComplete={autoComplete}
        value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        aria-invalid={Boolean(errors[key])}
        aria-describedby={[hint ? `${key}-hint` : '', errors[key] ? `${key}-error` : ''].filter(Boolean).join(' ') || undefined}
      />
      {hint && (
        <span id={`${key}-hint`} className="hint">
          {hint}
        </span>
      )}
      {errors[key] && (
        <span id={`${key}-error`} className="error">
          {errors[key]}
        </span>
      )}
    </div>
  );

  return (
    <>
      <div className="page-header">
        <h1>הפרופיל שלי</h1>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', alignItems: 'start' }}>
        <section className="card" aria-labelledby="details-h">
          <h2 id="details-h">פרטים</h2>
          <dl>
            <dt className="muted">שם</dt>
            <dd>{user.name}</dd>
            <dt className="muted">דוא"ל</dt>
            <dd dir="ltr" style={{ textAlign: 'end' }}>
              {user.email}
            </dd>
            <dt className="muted">תפקיד במערכת</dt>
            <dd>{GLOBAL_ROLE_LABELS[user.role]}</dd>
            <dt className="muted">התחברות</dt>
            <dd>{user.authSource === 'local' ? 'סיסמה במערכת' : user.authSource === 'scim' ? 'חשבון ארגוני (מסונכרן מספק הזהות)' : 'חשבון ארגוני (SSO)'}</dd>
          </dl>
        </section>
        <section className="card" aria-labelledby="pw-h">
          <h2 id="pw-h">החלפת סיסמה</h2>
          {user.authSource !== 'local' && <p className="hint">החשבון מחובר להתחברות הארגונית; הסיסמה כאן רלוונטית רק לכניסה בסיסמה, אם היא מותרת. סיסמת הארגון מנוהלת אצל ספק הזהות.</p>}
          {user.mustChangePassword && (
            <div className="draft-banner" role="alert">
              זוהי כניסה ראשונה עם סיסמה זמנית. יש לבחור סיסמה אישית חדשה כדי להמשיך.
            </div>
          )}
          {formError && (
            <div className="form-error" role="alert">
              {formError}
            </div>
          )}
          <form onSubmit={onSubmit} noValidate>
            {field('currentPassword', 'סיסמה נוכחית', 'current-password')}
            {field('newPassword', 'סיסמה חדשה', 'new-password', `לפחות ${LIMITS.passwordMin} תווים. מומלץ משפט סיסמה ארוך שקל לזכור.`)}
            {field('confirm', 'אימות סיסמה חדשה', 'new-password')}
            <button type="submit" className="btn btn-primary" disabled={saving} aria-busy={saving}>
              {saving ? 'שומר…' : 'עדכון סיסמה'}
            </button>
          </form>
        </section>
        {!user.mustChangePassword && <MfaSection />}
        {!user.mustChangePassword && !user.mfaSetupRequired && <NotificationPrefsSection />}
      </div>
    </>
  );
}
