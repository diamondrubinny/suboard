import { randomBytes } from 'node:crypto';
import type { AppConfig } from '../config.js';
import { nowIso, type DB } from '../db/index.js';
import { hashPassword, sha256 } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';
import { escapeHtml, type Mailer } from '../lib/mailer.js';
import type { AuditService } from './audit.js';
import type { AuthService } from './auth.js';

const TTL_MS = 30 * 60_000;
const MIN_INTERVAL_MS = 2 * 60_000;
const MAX_PER_DAY = 5;
const INVALID_LINK = 'הקישור לאיפוס הסיסמה אינו תקף או שפג תוקפו. בקשו קישור חדש.';

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  is_active: number;
  auth_source: string;
}

/**
 * Self-service password reset by e-mail. The response to a request never reveals whether the account
 * exists; the token is random (256 bits), stored only as a hash, valid 30 minutes and used once.
 * A reset ends every open session and keeps two-step verification as it was.
 */
export class PasswordResetService {
  constructor(
    private readonly db: DB,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly mailer: Mailer | null,
  ) {}

  /** Shown on the login page only when e-mail is configured and password sign-in exists at all. */
  get available(): boolean {
    return this.mailer !== null && this.config.localLogin !== 'disabled';
  }

  private eligible(u: UserRow): boolean {
    if (!u.is_active) return false;
    if (this.config.localLogin === 'disabled') return false;
    if (this.config.localLogin === 'admins_only' && u.role !== 'admin') return false;
    // Accounts that sign in through the organisation (SSO / SCIM) reset their password there.
    if (this.config.sso && u.auth_source !== 'local') return false;
    return true;
  }

  /** Always resolves the same way (no account enumeration); sends a link only to an eligible account. */
  async request(email: string, meta: { ip: string }): Promise<void> {
    if (!this.available) return;
    const u = this.db.prepare('SELECT id, email, name, role, is_active, auth_source FROM users WHERE email = ?').get(email) as UserRow | undefined;
    if (!u || !this.eligible(u)) {
      this.audit.log('password_reset_requested', { ip: meta.ip, meta: { sent: false } });
      return;
    }
    const now = Date.now();
    const recent = this.db
      .prepare('SELECT created_at FROM password_resets WHERE user_id = ? AND created_at > ? ORDER BY created_at DESC')
      .all(u.id, new Date(now - 86_400_000).toISOString()) as { created_at: string }[];
    if (recent.length >= MAX_PER_DAY || (recent[0] && now - Date.parse(recent[0].created_at) < MIN_INTERVAL_MS)) {
      this.audit.log('password_reset_requested', { userId: u.id, ip: meta.ip, meta: { sent: false, reason: 'throttled' } });
      return;
    }
    const token = randomBytes(32).toString('base64url');
    const ts = new Date(now).toISOString();
    this.db.transaction(() => {
      // A new link replaces any earlier unused one.
      this.db.prepare('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL').run(u.id);
      this.db
        .prepare('INSERT INTO password_resets (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
        .run(sha256(token), u.id, ts, new Date(now + TTL_MS).toISOString());
    })();
    this.audit.log('password_reset_requested', { userId: u.id, ip: meta.ip, meta: { sent: true } });
    // The token travels in the fragment: never sent to the server on page load, not in proxy logs or Referer.
    const link = `${this.config.publicUrl}/reset-password#token=${token}`;
    const text = [
      `שלום ${u.name},`,
      '',
      'התקבלה בקשה לאיפוס הסיסמה שלך ב-SUBoard. לבחירת סיסמה חדשה:',
      link,
      '',
      'הקישור תקף ל-30 דקות ולשימוש אחד בלבד.',
      'אם לא ביקשת איפוס — אפשר להתעלם מההודעה; הסיסמה הנוכחית לא שונתה.',
    ].join('\n');
    const html =
      `<div dir="rtl" lang="he" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6">` +
      `<p>שלום ${escapeHtml(u.name)},</p><p>התקבלה בקשה לאיפוס הסיסמה שלך ב-SUBoard.</p>` +
      `<p><a href="${escapeHtml(link)}">בחירת סיסמה חדשה</a></p>` +
      `<p>הקישור תקף ל-30 דקות ולשימוש אחד בלבד.<br>אם לא ביקשת איפוס — אפשר להתעלם מההודעה; הסיסמה הנוכחית לא שונתה.</p></div>`;
    // Not awaited by the caller's response timing: failures are logged by the mailer, never shown.
    void this.mailer!.send({ to: u.email, subject: 'SUBoard: איפוס סיסמה', text, html }).catch(() => undefined);
  }

  async reset(token: string, newPassword: string, meta: { ip: string }): Promise<void> {
    const id = sha256(token);
    const row = this.db
      .prepare('SELECT r.user_id, r.expires_at, r.used_at, u.email, u.name, u.role, u.is_active, u.auth_source, u.id FROM password_resets r JOIN users u ON u.id = r.user_id WHERE r.id = ?')
      .get(id) as (UserRow & { user_id: string; expires_at: string; used_at: string | null }) | undefined;
    if (!row || row.used_at || Date.parse(row.expires_at) <= Date.now() || !this.eligible(row)) {
      this.audit.log('password_reset_failed', { userId: row?.user_id ?? null, ip: meta.ip, meta: { reason: !row ? 'unknown' : row.used_at ? 'used' : 'expired_or_ineligible' } });
      throw new AppError(400, 'INVALID_RESET_LINK', INVALID_LINK);
    }
    const hash = await hashPassword(newPassword);
    const ts = nowIso();
    this.db.transaction(() => {
      // Mark used first (one use even under concurrent requests).
      const used = this.db.prepare('UPDATE password_resets SET used_at = ? WHERE id = ? AND used_at IS NULL').run(ts, id).changes;
      if (!used) throw new AppError(400, 'INVALID_RESET_LINK', INVALID_LINK);
      this.db
        .prepare('UPDATE users SET password_hash = ?, must_change_password = 0, failed_logins = 0, locked_until = NULL, updated_at = ? WHERE id = ?')
        .run(hash, ts, row.user_id);
      this.db.prepare('DELETE FROM password_resets WHERE user_id = ? AND id <> ?').run(row.user_id, id);
    })();
    this.auth.revokeAllSessions(row.user_id);
    this.audit.log('password_reset', { userId: row.user_id, ip: meta.ip });
    if (this.mailer) {
      const text = `שלום ${row.name},\n\nהסיסמה שלך ב-SUBoard שונתה עכשיו, וכל החיבורים הפתוחים נותקו.\nאם לא אתה ביצעת את השינוי — פנה מיד למנהל המערכת.`;
      const html = `<div dir="rtl" lang="he" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6"><p>שלום ${escapeHtml(row.name)},</p><p>הסיסמה שלך ב-SUBoard שונתה עכשיו, וכל החיבורים הפתוחים נותקו.</p><p><strong>אם לא אתה ביצעת את השינוי — פנה מיד למנהל המערכת.</strong></p></div>`;
      void this.mailer.send({ to: row.email, subject: 'SUBoard: הסיסמה שונתה', text, html }).catch(() => undefined);
    }
  }

  purgeExpired(): number {
    return this.db.prepare('DELETE FROM password_resets WHERE expires_at < ?').run(new Date(Date.now() - 86_400_000).toISOString()).changes;
  }
}
