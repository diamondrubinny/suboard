import { useState } from 'react';
import { errorMessage } from '../api/client';
import { useAudit } from '../api/hooks';
import { EmptyState, ErrorState, LoadingState } from '../components/Feedback';
import { usePageTitle } from '../components/Layout';
import { formatDateTime } from './board/activityText';

const EVENTS: Record<string, string> = {
  login_success: 'התחברות מוצלחת',
  login_failed: 'התחברות כושלת',
  account_locked: 'נעילת חשבון',
  logout: 'התנתקות',
  password_changed: 'החלפת סיסמה',
  password_change_failed: 'החלפת סיסמה נכשלה',
  user_created: 'יצירת משתמש',
  user_updated: 'עדכון משתמש',
  board_created: 'יצירת לוח',
  board_archived: 'העברת לוח לארכיון',
  member_set: 'עדכון הרשאת לוח',
  member_removed: 'הסרת חבר מלוח',
  access_denied: 'ניסיון גישה שנדחה',
  mfa_enabled: 'הפעלת אימות דו-שלבי',
  mfa_disabled: 'ביטול אימות דו-שלבי',
  mfa_disable_failed: 'ניסיון ביטול MFA נכשל',
  mfa_failed: 'קוד אימות שגוי',
  mfa_recovery_code_used: 'שימוש בקוד שחזור',
  mfa_reset: 'איפוס MFA ע"י מנהל',
  upload_rejected: 'קובץ נדחה (סוג לא מותר)',
  malware_detected: 'זוהתה נוזקה בקובץ',
  data_export: 'ייצוא נתונים',
  sso_login_success: 'התחברות ארגונית (SSO)',
  sso_login_failed: 'התחברות ארגונית נכשלה',
  scim_user_created: 'משתמש נוצר בסנכרון (SCIM)',
  scim_user_updated: 'משתמש עודכן בסנכרון (SCIM)',
  scim_user_deactivated: 'משתמש הושבת בסנכרון (SCIM)',
  scim_auth_failed: 'ניסיון סנכרון עם אסימון שגוי',
  session_revoked: 'ניתוק מכשיר',
  sessions_revoked_others: 'ניתוק כל המכשירים האחרים',
  sessions_revoked_by_admin: 'ניתוק מכשירים ע"י מנהל',
  modules_changed: 'הפעלה / כיבוי של מודולים',
  workspace_changed: 'שינוי בסביבות העבודה',
  board_opened: 'שינוי בפתיחת לוח לכל המשתמשים',
  webhook_changed: 'הגדרת / מחיקת Webhook',
  api_token_changed: 'יצירת / ביטול אסימון API',
  board_duplicated: 'שכפול לוח',
  passkey_added: 'מפתח גישה נוסף',
  passkey_add_failed: 'הוספת מפתח גישה נכשלה',
  passkey_removed: 'מפתח גישה הוסר',
};

const DANGER = new Set(['login_failed', 'account_locked', 'access_denied', 'mfa_failed', 'mfa_disable_failed', 'malware_detected', 'upload_rejected', 'sso_login_failed', 'scim_auth_failed']);

const REASONS: Record<string, string> = {
  unknown_account: 'חשבון לא קיים',
  bad_password: 'סיסמה שגויה',
  locked: 'חשבון נעול',
  inactive: 'חשבון מושבת',
};

function describeMeta(meta: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof meta.reason === 'string') parts.push(REASONS[meta.reason] ?? meta.reason);
  if (typeof meta.role === 'string') parts.push(`תפקיד: ${meta.role}`);
  if (Array.isArray(meta.changed)) parts.push(`שדות: ${meta.changed.join(', ')}`);
  if (typeof meta.route === 'string') parts.push(`${String(meta.method ?? '')} ${meta.route}`);
  if (typeof meta.signature === 'string') parts.push(`חתימה: ${meta.signature}`);
  if (typeof meta.rows === 'number') parts.push(`${meta.rows} שורות`);
  if (meta.mfa === true) parts.push('עם MFA');
  if (typeof meta.until === 'string') parts.push(`עד ${formatDateTime(meta.until)}`);
  return parts.join(' · ');
}

export function AuditPage() {
  usePageTitle('יומן אבטחה');
  const [event, setEvent] = useState('');
  const q = useAudit(event);

  return (
    <>
      <div className="page-header">
        <h1>יומן אבטחה</h1>
      </div>
      <p className="muted">
        תיעוד אירועי אבטחה (100 האחרונים). כתובות IP נשמרות כערך מגובב (HMAC) בלבד. מדיניות שמירה: 365 ימים (ניתן להגדרה).
      </p>
      <div className="toolbar">
        <label htmlFor="audit-event">סוג אירוע</label>
        <select id="audit-event" className="select" value={event} onChange={(e) => setEvent(e.target.value)}>
          <option value="">הכל</option>
          {Object.entries(EVENTS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      {q.isPending && <LoadingState />}
      {q.isError && <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {q.data?.length === 0 && <EmptyState title="אין אירועים" />}
      {q.data && q.data.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <caption className="sr-only">אירועי אבטחה</caption>
            <thead>
              <tr>
                <th scope="col">זמן</th>
                <th scope="col">אירוע</th>
                <th scope="col">משתמש</th>
                <th scope="col">פרטים</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((e) => (
                <tr key={e.id}>
                  <td className="nowrap">{formatDateTime(e.createdAt)}</td>
                  <td>
                    <span className={DANGER.has(e.event) ? 'badge danger' : 'badge'}>
                      {EVENTS[e.event] ?? e.event}
                    </span>
                  </td>
                  <td>{e.userName ?? '—'}</td>
                  <td className="muted">{describeMeta(e.meta)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
