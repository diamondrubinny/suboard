import { addDaysIso, createUserSchema, formatDateHe, GLOBAL_ROLE_LABELS, GLOBAL_ROLES, GUEST_DEFAULT_DAYS, LIMITS, todayIso, type AdminUser, type GlobalRole } from '@suboard/shared';
import { useRef, useState, type FormEvent } from 'react';
import { ApiError, errorMessage } from '../api/client';
import { useModules, useRevokeUserSessions, useUserMutations, useUsers } from '../api/hooks';
import { DateField } from '../components/DateField';
import { useAuth } from '../auth/AuthContext';
import { Dialog } from '../components/Dialog';
import { ErrorState, LoadingState, useFeedback } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { usePageTitle } from '../components/Layout';
import { formatDateTime } from './board/activityText';

/** Generates a strong temporary password in the browser (crypto RNG). */
function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_!';
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

function UserFormDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { create } = useUserMutations();
  const { toast } = useFeedback();
  const [form, setForm] = useState({ email: '', name: '', role: 'member' as GlobalRole, password: generatePassword() });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const guestsOn = useModules().data?.guests === true;
  const [guest, setGuest] = useState(false);
  const [guestUntil, setGuestUntil] = useState(() => addDaysIso(todayIso(), GUEST_DEFAULT_DAYS));
  const [guestOrg, setGuestOrg] = useState('');
  const firstRef = useRef<HTMLInputElement>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const asGuest = guest && guestsOn;
    const parsed = createUserSchema.safeParse(asGuest ? { ...form, role: 'member', guest: { expiresAt: guestUntil, org: guestOrg.trim() || undefined } } : form);
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const i of parsed.error.issues) fe[i.path[0] === 'guest' ? 'guestExpiresAt' : String(i.path[0])] ??= i.message;
      return setErrors(fe);
    }
    try {
      await create.mutateAsync(parsed.data);
      toast(`המשתמש ${parsed.data.name} נוצר. מסרו לו את הסיסמה הזמנית בערוץ מאובטח.`);
      setForm({ email: '', name: '', role: 'member', password: generatePassword() });
      setGuest(false);
      setGuestOrg('');
      setErrors({});
      onClose();
    } catch (err) {
      setErrors(err instanceof ApiError && err.fields ? err.fields : { _: errorMessage(err) });
    }
  };

  const input = (key: 'email' | 'name' | 'password', label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="field">
      <label htmlFor={`u-${key}`}>{label}</label>
      <input
        id={`u-${key}`}
        ref={key === 'email' ? firstRef : undefined}
        className="input"
        value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        aria-invalid={Boolean(errors[key])}
        aria-describedby={errors[key] ? `u-${key}-err` : undefined}
        {...extra}
      />
      {errors[key] && (
        <span id={`u-${key}-err`} className="error">
          {errors[key]}
        </span>
      )}
    </div>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="משתמש חדש"
      initialFocusRef={firstRef}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            ביטול
          </button>
          <button type="submit" form="user-form" className="btn btn-primary" disabled={create.isPending}>
            יצירה
          </button>
        </>
      }
    >
      <form id="user-form" onSubmit={submit} noValidate>
        {errors._ && (
          <div className="form-error" role="alert">
            {errors._}
          </div>
        )}
        {input('email', 'דוא"ל', { type: 'email', dir: 'ltr', autoComplete: 'off' })}
        {input('name', 'שם מלא', { maxLength: 80 })}
        <div className="field">
          <label htmlFor="u-role">תפקיד במערכת</label>
          <select id="u-role" className="select" value={guest && guestsOn ? 'member' : form.role} disabled={guest && guestsOn} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as GlobalRole }))}>
            {GLOBAL_ROLES.map((r) => (
              <option key={r} value={r}>
                {GLOBAL_ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <span className="hint">מנהל — יכול ליצור לוחות. מנהל מערכת — גישה מלאה לכל הלוחות, למשתמשים וליומן האבטחה.</span>
        </div>
        {guestsOn && (
          <fieldset className="formula-editor">
            <legend>חשבון אורח</legend>
            <label className="check">
              <input type="checkbox" checked={guest} onChange={(e) => setGuest(e.target.checked)} aria-describedby="u-guest-hint" /> זהו גורם חיצוני (קבלן, ספק)
            </label>
            <span id="u-guest-hint" className="hint">
              אורח רואה רק לוחות שהוזמן אליהם, אינו רואה כתובות דוא"ל או משתמשים אחרים, אינו יכול להיות בעלים של לוח או לייצא נתונים, וחייב אימות דו-שלבי. החשבון פג בתאריך שנקבע.
            </span>
            {guest && (
              <>
                <div className="field">
                  <label htmlFor="u-guest-until">תוקף עד</label>
                  <DateField id="u-guest-until" value={guestUntil} min={todayIso()} onChange={setGuestUntil} aria-invalid={Boolean(errors.guestExpiresAt)} />
                  {errors.guestExpiresAt && (
                    <span className="error" role="alert">
                      {errors.guestExpiresAt}
                    </span>
                  )}
                </div>
                <div className="field">
                  <label htmlFor="u-guest-org">ארגון (לא חובה)</label>
                  <input id="u-guest-org" className="input" maxLength={80} value={guestOrg} onChange={(e) => setGuestOrg(e.target.value)} />
                </div>
              </>
            )}
          </fieldset>
        )}
        {input('password', 'סיסמה זמנית', { dir: 'ltr', autoComplete: 'new-password', minLength: LIMITS.passwordMin })}
        <p className="hint muted">המשתמש יידרש להחליף את הסיסמה בכניסה הראשונה.</p>
      </form>
    </Dialog>
  );
}

function IssuedPasswordDialog({ issued, onClose }: { issued: { name: string; password: string } | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open={issued !== null}
      onClose={() => (setCopied(false), onClose())}
      title="סיסמה זמנית חדשה"
      initialFocusRef={closeRef}
      footer={
        <button type="button" ref={closeRef} className="btn btn-primary" onClick={() => (setCopied(false), onClose())}>
          סיום
        </button>
      }
    >
      <p>
        הסיסמה הזמנית של <strong>{issued?.name}</strong> מוצגת פעם אחת בלבד. מסרו אותה בערוץ מאובטח; המשתמש יידרש להחליף אותה בכניסה הבאה.
      </p>
      <div className="field">
        <label htmlFor="issued-pw">סיסמה זמנית</label>
        <input id="issued-pw" className="input" dir="ltr" readOnly value={issued?.password ?? ''} onFocus={(e) => e.target.select()} />
      </div>
      <button
        type="button"
        className="btn"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(issued?.password ?? '');
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        העתקה ללוח
      </button>
      <span role="status" aria-live="polite" className="muted" style={{ marginInlineStart: '0.75rem' }}>
        {copied ? 'הועתק' : ''}
      </span>
    </Dialog>
  );
}

function UserRow({ u, isSelf, onIssued }: { u: AdminUser; isSelf: boolean; onIssued: (v: { name: string; password: string }) => void }) {
  const { update, resetMfa } = useUserMutations();
  const revokeSessions = useRevokeUserSessions();
  const { toast, confirm } = useFeedback();
  const onErr = (e: unknown) => toast(errorMessage(e), 'error');

  const resetPassword = async () => {
    const password = generatePassword();
    if (!(await confirm({ title: 'איפוס סיסמה', message: `לאפס את הסיסמה של ${u.name}? כל החיבורים הפעילים שלו ינותקו.`, confirmLabel: 'איפוס' }))) return;
    update.mutate(
      { id: u.id, patch: { password } },
      { onSuccess: () => onIssued({ name: u.name, password }), onError: onErr },
    );
  };

  return (
    <tr>
      <td>
        {u.name}
        {isSelf && <span className="badge" style={{ marginInlineStart: '0.4rem' }}>את/ה</span>}
        {u.guest && (
          <span className="badge warning" style={{ marginInlineStart: '0.4rem' }}>
            אורח{u.guestOrg ? ` · ${u.guestOrg}` : ''}
          </span>
        )}
        {u.authSource !== 'local' && (
          <span className="badge" style={{ marginInlineStart: '0.4rem' }} title={u.authSource === 'scim' ? 'נוצר ומנוהל ע"י סנכרון SCIM מספק הזהות' : 'מקושר לחשבון הארגוני (SSO)'}>
            {u.authSource === 'scim' ? 'SCIM' : 'SSO'}
          </span>
        )}
      </td>
      <td dir="ltr" style={{ textAlign: 'end' }}>
        {u.email}
      </td>
      <td>
        <select className="select" value={u.role} disabled={isSelf || u.guest} title={u.guest ? 'חשבון אורח הוא תמיד בתפקיד "חבר"' : undefined} aria-label={`תפקיד עבור ${u.name}`}
          onChange={(e) => update.mutate({ id: u.id, patch: { role: e.target.value as GlobalRole } }, { onSuccess: () => toast('התפקיד עודכן'), onError: onErr })}>
          {GLOBAL_ROLES.map((r) => (
            <option key={r} value={r}>
              {GLOBAL_ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </td>
      <td>
        {u.isActive ? <span className="badge success">פעיל</span> : <span className="badge">מושבת</span>}
        {u.lockedUntil && (
          <span className="badge danger" style={{ marginInlineStart: '0.3rem' }}>
            <Icon name="lock" size={12} /> נעול
          </span>
        )}
        {u.mustChangePassword && <span className="badge" style={{ marginInlineStart: '0.3rem' }}>סיסמה זמנית</span>}
        {u.guest && u.guestExpiresAt && (
          <span className={Date.parse(u.guestExpiresAt) <= Date.now() ? 'badge danger' : 'badge'} style={{ marginInlineStart: '0.3rem' }}>
            {Date.parse(u.guestExpiresAt) <= Date.now() ? 'פג תוקף' : 'בתוקף עד'} <span className="num">{formatDateHe(u.guestExpiresAt.slice(0, 10))}</span>
          </span>
        )}
        {u.mfaEnabled && <span className="badge success" style={{ marginInlineStart: '0.3rem' }}>MFA</span>}
      </td>
      <td className="muted nowrap">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'מעולם לא'}</td>
      <td>
        <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
          {u.guest && (
            <button
              type="button"
              className="btn btn-sm"
              aria-label={`הארכה ב-${GUEST_DEFAULT_DAYS} יום מהיום: התוקף של ${u.name}`}
              onClick={() => update.mutate({ id: u.id, patch: { guestExpiresAt: addDaysIso(todayIso(), GUEST_DEFAULT_DAYS) } }, { onSuccess: () => toast('התוקף הוארך'), onError: onErr })}
            >
              הארכה ב-{GUEST_DEFAULT_DAYS} יום
            </button>
          )}
          {u.lockedUntil && (
            <button type="button" className="btn btn-sm" onClick={() => update.mutate({ id: u.id, patch: { unlock: true } }, { onSuccess: () => toast('החשבון שוחרר'), onError: onErr })}>
              שחרור נעילה
            </button>
          )}
          <button type="button" className="btn btn-sm" onClick={resetPassword}>
            איפוס סיסמה
          </button>
          {u.mfaEnabled && !isSelf && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={async () => {
                if (!(await confirm({ title: 'איפוס אימות דו-שלבי', message: `לאפס את האימות הדו-שלבי של ${u.name}? יש לוודא את זהות המבקש/ת לפני כן. המשתמש ינותק ויידרש להגדיר מחדש.`, confirmLabel: 'איפוס', danger: true }))) return;
                resetMfa.mutate(u.id, { onSuccess: () => toast('האימות הדו-שלבי אופס'), onError: onErr });
              }}
            >
              איפוס MFA
            </button>
          )}
          {u.isActive && (
            <button
              type="button"
              className="btn btn-sm"
              disabled={revokeSessions.isPending}
              onClick={async () => {
                const message = isSelf ? 'כל המכשירים האחרים שלך ינותקו; במכשיר הזה תישאר/י מחובר/ת.' : `${u.name} ינותק/תנותק בכל המכשירים ויידרש/תידרש להתחבר מחדש (למשל אחרי אובדן טלפון). גם מפתחות הגישה (Passkeys) ואסימוני ה-API של המשתמש יימחקו.`;
                if (!(await confirm({ title: 'ניתוק כל המכשירים', message, confirmLabel: 'ניתוק', danger: true }))) return;
                revokeSessions.mutate(u.id, { onSuccess: () => toast('המכשירים נותקו'), onError: onErr });
              }}
            >
              ניתוק מכשירים
            </button>
          )}
          {!isSelf && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={async () => {
                if (u.isActive && !(await confirm({ title: 'השבתת משתמש', message: `להשבית את ${u.name}? הוא ינותק מיד ולא יוכל להתחבר.`, confirmLabel: 'השבתה', danger: true }))) return;
                update.mutate({ id: u.id, patch: { isActive: !u.isActive } }, { onSuccess: () => toast(u.isActive ? 'המשתמש הושבת' : 'המשתמש הופעל'), onError: onErr });
              }}
            >
              {u.isActive ? 'השבתה' : 'הפעלה'}
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

export function AdminUsersPage() {
  usePageTitle('ניהול משתמשים');
  const { user } = useAuth();
  const users = useUsers();
  const [creating, setCreating] = useState(false);
  const [issued, setIssued] = useState<{ name: string; password: string } | null>(null);

  return (
    <>
      <div className="page-header">
        <h1>ניהול משתמשים</h1>
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <Icon name="plus" /> משתמש חדש
          </button>
        </div>
      </div>
      {users.isPending && <LoadingState />}
      {users.isError && <ErrorState message={errorMessage(users.error)} onRetry={() => users.refetch()} />}
      {users.data && (
        <div className="table-wrap">
          <table className="data-table">
            <caption className="sr-only">רשימת משתמשים</caption>
            <thead>
              <tr>
                <th scope="col">שם</th>
                <th scope="col">דוא"ל</th>
                <th scope="col">תפקיד</th>
                <th scope="col">מצב</th>
                <th scope="col">כניסה אחרונה</th>
                <th scope="col">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {users.data.map((u) => (
                <UserRow key={u.id} u={u} isSelf={u.id === user?.id} onIssued={setIssued} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <UserFormDialog open={creating} onClose={() => setCreating(false)} />
      <IssuedPasswordDialog issued={issued} onClose={() => setIssued(null)} />
    </>
  );
}
