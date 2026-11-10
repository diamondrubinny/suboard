import type { GlobalRole, SessionUser } from '@suboard/shared';
import type { AppConfig } from '../config.js';
import { nowIso, type DB } from '../db/index.js';
import { getDummyHash, hashPassword, newSessionToken, sha256, verifyPassword } from '../lib/crypto.js';
import { AppError, badRequest, forbidden } from '../lib/errors.js';
import type { AuditService } from './audit.js';
import type { MfaService } from './mfa.js';

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: GlobalRole;
  is_active: number;
  must_change_password: number;
  failed_logins: number;
  locked_until: string | null;
  mfa_enabled: number;
  email_notifications: number;
  monthly_report: number;
}

export interface ResolvedSession {
  sessionId: string;
  user: SessionUser;
}

export type LoginResult = { kind: 'session'; token: string; user: SessionUser } | { kind: 'mfa'; challengeToken: string };

/** Single generic message: does not reveal whether the account exists, is locked or disabled. */
const INVALID_CREDENTIALS = 'אימייל או סיסמה שגויים, או שהחשבון ננעל זמנית. נסו שוב מאוחר יותר.';

export class AuthService {
  constructor(
    private readonly db: DB,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly mfa: MfaService,
  ) {}

  async login(email: string, password: string, meta: { ip: string; userAgent?: string }): Promise<LoginResult> {
    const row = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;

    if (!row) {
      await verifyPassword(password, await getDummyHash()); // equalize response timing
      this.audit.log('login_failed', { ip: meta.ip, meta: { reason: 'unknown_account' } });
      throw new AppError(401, 'INVALID_CREDENTIALS', INVALID_CREDENTIALS);
    }

    if (row.locked_until && Date.parse(row.locked_until) > Date.now()) {
      await verifyPassword(password, await getDummyHash());
      this.audit.log('login_failed', { userId: row.id, ip: meta.ip, meta: { reason: 'locked' } });
      throw new AppError(401, 'INVALID_CREDENTIALS', INVALID_CREDENTIALS);
    }

    const ok = await verifyPassword(password, row.password_hash);
    if (!ok || !row.is_active) {
      if (!ok) this.registerFailure(row, meta.ip);
      else this.audit.log('login_failed', { userId: row.id, ip: meta.ip, meta: { reason: 'inactive' } });
      throw new AppError(401, 'INVALID_CREDENTIALS', INVALID_CREDENTIALS);
    }

    // Password is correct. With MFA enrolled, a second factor is required before any session exists.
    if (row.mfa_enabled) {
      this.db.prepare('UPDATE users SET failed_logins = 0 WHERE id = ?').run(row.id);
      return { kind: 'mfa', challengeToken: this.mfa.createChallenge(row.id) };
    }
    return this.startSession(row, meta);
  }

  async completeMfaLogin(challengeToken: string, code: string, meta: { ip: string; userAgent?: string }): Promise<LoginResult> {
    const userId = this.mfa.completeChallenge(challengeToken, code, meta.ip);
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined;
    if (!row || !row.is_active) throw new AppError(401, 'INVALID_CREDENTIALS', INVALID_CREDENTIALS);
    return this.startSession(row, meta);
  }

  private startSession(row: UserRow, meta: { ip: string; userAgent?: string }): LoginResult {
    const token = newSessionToken();
    const ts = nowIso();
    this.db.transaction(() => {
      this.db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?').run(ts, row.id);
      this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at < ?').run(row.id, ts);
      this.db
        .prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)')
        .run(sha256(token), row.id, ts, new Date(Date.now() + this.config.sessionTtlMs).toISOString(), ts, meta.userAgent?.slice(0, 200) ?? null);
    })();
    this.audit.log('login_success', { userId: row.id, ip: meta.ip, meta: { mfa: row.mfa_enabled === 1 } });
    return { kind: 'session', token, user: this.toSessionUser(row) };
  }

  private registerFailure(row: UserRow, ip: string): void {
    const failures = row.failed_logins + 1;
    if (failures >= this.config.lockoutThreshold) {
      const until = new Date(Date.now() + this.config.lockoutMs).toISOString();
      this.db.prepare('UPDATE users SET failed_logins = 0, locked_until = ? WHERE id = ?').run(until, row.id);
      this.audit.log('account_locked', { userId: row.id, ip, meta: { until } });
    } else {
      this.db.prepare('UPDATE users SET failed_logins = ? WHERE id = ?').run(failures, row.id);
    }
    this.audit.log('login_failed', { userId: row.id, ip, meta: { reason: 'bad_password' } });
  }

  /** Resolves a raw cookie token to an active session, enforcing absolute and idle expiry. */
  resolveSession(token: string | undefined): ResolvedSession | null {
    if (!token || token.length > 100) return null;
    const id = sha256(token);
    const row = this.db
      .prepare(
        `SELECT s.id AS session_id, s.expires_at, s.last_seen_at, u.*
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
      )
      .get(id) as (UserRow & { session_id: string; expires_at: string; last_seen_at: string }) | undefined;
    if (!row) return null;

    const now = Date.now();
    const expired = Date.parse(row.expires_at) <= now || Date.parse(row.last_seen_at) + this.config.sessionIdleMs <= now;
    if (expired || !row.is_active) {
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
      return null;
    }
    // Throttle writes: refresh last_seen at most once a minute.
    if (now - Date.parse(row.last_seen_at) > 60_000) {
      this.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(new Date(now).toISOString(), id);
    }
    return { sessionId: id, user: this.toSessionUser(row) };
  }

  logout(sessionId: string, userId: string, ip: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    this.audit.log('logout', { userId, ip });
  }

  async changePassword(userId: string, sessionId: string, current: string, next: string, ip: string): Promise<void> {
    const row = this.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as { password_hash: string } | undefined;
    if (!row || !(await verifyPassword(current, row.password_hash))) {
      this.audit.log('password_change_failed', { userId, ip });
      throw badRequest('הסיסמה הנוכחית שגויה', { currentPassword: 'הסיסמה הנוכחית שגויה' });
    }
    const hash = await hashPassword(next);
    this.db.transaction(() => {
      this.db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?').run(hash, nowIso(), userId);
      // Revoke every other session of this user.
      this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(userId, sessionId);
    })();
    this.audit.log('password_changed', { userId, ip });
  }

  setPreferences(userId: string, prefs: { emailNotifications?: boolean; monthlyReport?: boolean }): void {
    if (prefs.emailNotifications !== undefined) {
      this.db.prepare('UPDATE users SET email_notifications = ?, updated_at = ? WHERE id = ?').run(prefs.emailNotifications ? 1 : 0, nowIso(), userId);
    }
    if (prefs.monthlyReport !== undefined) {
      const role = (this.db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as { role: string } | undefined)?.role;
      if (prefs.monthlyReport && role !== 'admin' && role !== 'manager') throw forbidden('הדוח החודשי מיועד למנהלים');
      this.db.prepare('UPDATE users SET monthly_report = ?, updated_at = ? WHERE id = ?').run(prefs.monthlyReport ? 1 : 0, nowIso(), userId);
    }
  }

  getSessionUser(userId: string): SessionUser {
    return this.toSessionUser(this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow);
  }

  revokeAllSessions(userId: string): void {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }

  /** Revoke every session of a user except the given one (e.g. after enabling MFA). */
  revokeOtherSessions(userId: string, keepSessionId: string): void {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(userId, keepSessionId);
  }

  purgeExpiredSessions(): number {
    const idleCutoff = new Date(Date.now() - this.config.sessionIdleMs).toISOString();
    this.db.prepare('DELETE FROM mfa_challenges WHERE expires_at < ?').run(nowIso());
    return this.db.prepare('DELETE FROM sessions WHERE expires_at < ? OR last_seen_at < ?').run(nowIso(), idleCutoff).changes;
  }

  private toSessionUser(row: UserRow): SessionUser {
    const mfaEnabled = row.mfa_enabled === 1;
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      mustChangePassword: row.must_change_password === 1,
      mfaEnabled,
      mfaSetupRequired: !mfaEnabled && this.config.mfaRequiredRoles.includes(row.role),
      emailNotifications: row.email_notifications === 1,
      monthlyReport: row.monthly_report === 1,
    };
  }
}
