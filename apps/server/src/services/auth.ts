import type { ActiveSession, GlobalRole, SessionUser } from '@suboard/shared';
import { describeUserAgent } from '../lib/userAgent.js';
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
  auth_source: 'local' | 'sso' | 'scim';
  sso_subject: string | null;
  monthly_report: number;
  is_guest: number;
  guest_expires_at: string | null;
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
    if (!ok || !row.is_active || this.guestBlocked(row)) {
      if (!ok) this.registerFailure(row, meta.ip);
      else this.audit.log('login_failed', { userId: row.id, ip: meta.ip, meta: { reason: 'inactive' } });
      throw new AppError(401, 'INVALID_CREDENTIALS', INVALID_CREDENTIALS);
    }

    // Password is correct. Organisational policy may restrict password sign-in once SSO exists
    // (checked only after a correct password, so the message reveals nothing to a guesser).
    if (this.config.localLogin === 'disabled' || (this.config.localLogin === 'admins_only' && row.role !== 'admin')) {
      this.audit.log('login_failed', { userId: row.id, ip: meta.ip, meta: { reason: 'local_login_disabled' } });
      throw new AppError(403, 'USE_SSO', `התחברות בסיסמה אינה זמינה — יש להשתמש ב"${this.config.sso?.label ?? 'התחברות ארגונית'}"`);
    }
    // With MFA enrolled, a second factor is required before any session exists.
    if (row.mfa_enabled) {
      this.db.prepare('UPDATE users SET failed_logins = 0 WHERE id = ?').run(row.id);
      return { kind: 'mfa', challengeToken: this.mfa.createChallenge(row.id) };
    }
    return this.startSession(row, meta);
  }

  async completeMfaLogin(challengeToken: string, code: string, meta: { ip: string; userAgent?: string }): Promise<LoginResult> {
    const userId = this.mfa.completeChallenge(challengeToken, code, meta.ip);
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined;
    if (!row || !row.is_active || this.guestBlocked(row)) throw new AppError(401, 'INVALID_CREDENTIALS', INVALID_CREDENTIALS);
    return this.startSession(row, meta);
  }

  /**
   * After a successful OIDC login. `idpMfa`: the IdP reported (or is trusted to enforce) MFA. Without
   * it, a user who enrolled local TOTP still has to enter a code.
   */
  ssoLogin(userId: string, idpMfa: boolean, meta: { ip: string; userAgent?: string }): LoginResult {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined;
    if (!row || !row.is_active || this.guestBlocked(row)) throw new AppError(401, 'INVALID_CREDENTIALS', INVALID_CREDENTIALS);
    if (row.mfa_enabled && !idpMfa) return { kind: 'mfa', challengeToken: this.mfa.createChallenge(row.id) };
    return this.startSession(row, meta, { sso: true, idpMfa });
  }

  /**
   * After a verified passkey assertion (user verification required, so it is a multi-factor login by
   * itself: no TOTP step). The same sign-in policy as passwords applies when SSO is enforced.
   */
  passkeyLogin(userId: string, meta: { ip: string; userAgent?: string }): LoginResult {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined;
    if (!row || !row.is_active || this.guestBlocked(row)) {
      this.audit.log('login_failed', { userId: row?.id, ip: meta.ip, meta: { reason: 'inactive', method: 'passkey' } });
      throw new AppError(401, 'INVALID_CREDENTIALS', 'הכניסה עם מפתח הגישה נכשלה');
    }
    if (this.config.localLogin === 'disabled' || (this.config.localLogin === 'admins_only' && row.role !== 'admin')) {
      this.audit.log('login_failed', { userId: row.id, ip: meta.ip, meta: { reason: 'local_login_disabled', method: 'passkey' } });
      throw new AppError(403, 'USE_SSO', `כניסה עם מפתח גישה אינה זמינה — יש להשתמש ב"${this.config.sso?.label ?? 'התחברות ארגונית'}"`);
    }
    return this.startSession(row, meta, { sso: false, idpMfa: false, passkey: true });
  }

  private startSession(row: UserRow, meta: { ip: string; userAgent?: string }, via: { sso: boolean; idpMfa: boolean; passkey?: boolean } = { sso: false, idpMfa: false }): LoginResult {
    const token = newSessionToken();
    const ts = nowIso();
    this.db.transaction(() => {
      this.db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?').run(ts, row.id);
      this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at < ?').run(row.id, ts);
      this.db
        .prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, user_agent, via_sso, idp_mfa, via_passkey) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(sha256(token), row.id, ts, new Date(Date.now() + this.config.sessionTtlMs).toISOString(), ts, meta.userAgent?.slice(0, 200) ?? null, via.sso ? 1 : 0, via.idpMfa ? 1 : 0, via.passkey ? 1 : 0);
    })();
    const strong = via.idpMfa || via.passkey === true;
    this.audit.log(via.sso ? 'sso_login_success' : 'login_success', { userId: row.id, ip: meta.ip, meta: { mfa: row.mfa_enabled === 1 || strong, idpMfa: via.idpMfa, ...(via.passkey ? { method: 'passkey' } : {}) } });
    return { kind: 'session', token, user: this.toSessionUser(row, strong) };
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
        `SELECT s.id AS session_id, s.expires_at, s.last_seen_at, s.idp_mfa, s.via_passkey, u.*
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
      )
      .get(id) as (UserRow & { session_id: string; expires_at: string; last_seen_at: string; idp_mfa: number; via_passkey: number }) | undefined;
    if (!row) return null;

    const now = Date.now();
    const expired = Date.parse(row.expires_at) <= now || Date.parse(row.last_seen_at) + this.config.sessionIdleMs <= now;
    if (expired || !row.is_active || this.guestBlocked(row)) {
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
      return null;
    }
    // Throttle writes: refresh last_seen at most once a minute.
    if (now - Date.parse(row.last_seen_at) > 60_000) {
      this.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(new Date(now).toISOString(), id);
    }
    return { sessionId: id, user: this.toSessionUser(row, row.idp_mfa === 1 || row.via_passkey === 1) };
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

  /** `sessionId`: keeps the "signed in with MFA at the IdP / with a passkey" state of that session. */
  getSessionUser(userId: string, sessionId?: string | null): SessionUser {
    const s = sessionId ? (this.db.prepare('SELECT idp_mfa, via_passkey FROM sessions WHERE id = ?').get(sessionId) as { idp_mfa: number; via_passkey: number } | undefined) : undefined;
    return this.toSessionUser(this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow, s ? s.idp_mfa === 1 || s.via_passkey === 1 : false);
  }

  /** Re-authentication for sensitive changes. */
  async checkPassword(userId: string, password: string): Promise<boolean> {
    const row = this.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as { password_hash: string } | undefined;
    return Boolean(row) && (await verifyPassword(password, row!.password_hash));
  }

  revokeAllSessions(userId: string): void {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }

  /** One-way, stable handle for a session in the UI (never the cookie token or the stored hash itself). */
  private static handle(sessionId: string): string {
    return sha256(`session-handle:${sessionId}`).slice(0, 32);
  }

  /** The user's own live sessions, newest activity first. */
  listSessions(userId: string, currentSessionId: string): ActiveSession[] {
    const idleCutoff = Date.now() - this.config.sessionIdleMs;
    const rows = this.db
      .prepare('SELECT id, created_at, last_seen_at, expires_at, user_agent, via_sso, via_passkey FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC')
      .all(userId) as { id: string; created_at: string; last_seen_at: string; expires_at: string; user_agent: string | null; via_sso: number; via_passkey: number }[];
    return rows
      .filter((r) => Date.parse(r.expires_at) > Date.now() && Date.parse(r.last_seen_at) > idleCutoff)
      .map((r) => ({
        handle: AuthService.handle(r.id),
        device: describeUserAgent(r.user_agent),
        createdAt: r.created_at,
        lastSeenAt: r.last_seen_at,
        current: r.id === currentSessionId,
        viaSso: r.via_sso === 1,
        viaPasskey: r.via_passkey === 1,
      }));
  }

  /** Ends one of the user's own sessions by handle. Ending the current one is a logout (done by the route). */
  revokeSession(userId: string, handle: string, ip: string): boolean {
    const ids = (this.db.prepare('SELECT id FROM sessions WHERE user_id = ?').all(userId) as { id: string }[]).map((r) => r.id);
    const id = ids.find((x) => AuthService.handle(x) === handle);
    if (!id) return false;
    this.db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(id, userId);
    this.audit.log('session_revoked', { userId, ip });
    return true;
  }

  isCurrentHandle(sessionId: string, handle: string): boolean {
    return AuthService.handle(sessionId) === handle;
  }

  /** Revoke every session of a user except the given one (e.g. after enabling MFA). */
  revokeOtherSessions(userId: string, keepSessionId: string): void {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(userId, keepSessionId);
  }

  purgeExpiredSessions(): number {
    const idleCutoff = new Date(Date.now() - this.config.sessionIdleMs).toISOString();
    this.db.prepare('DELETE FROM mfa_challenges WHERE expires_at < ?').run(nowIso());
    this.db.prepare('DELETE FROM webauthn_challenges WHERE expires_at < ?').run(nowIso());
    return this.db.prepare('DELETE FROM sessions WHERE expires_at < ? OR last_seen_at < ?').run(nowIso(), idleCutoff).changes;
  }

  /** Wired after construction: is the guest-accounts module switched on? */
  guestsEnabled: () => boolean = () => false;

  /** A guest account that may not be used right now: the module is off, or the account has expired. */
  guestBlocked(row: { is_guest: number; guest_expires_at: string | null }): boolean {
    if (row.is_guest !== 1) return false;
    return !this.guestsEnabled() || !row.guest_expires_at || Date.parse(row.guest_expires_at) <= Date.now();
  }

  private toSessionUser(row: UserRow, idpMfa = false): SessionUser {
    const mfaEnabled = row.mfa_enabled === 1;
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      mustChangePassword: row.must_change_password === 1,
      mfaEnabled,
      // MFA done at the identity provider satisfies the requirement for this session.
      // Guests always need MFA: the account is used from outside the organisation.
      mfaSetupRequired: !mfaEnabled && !idpMfa && (row.is_guest === 1 || this.config.mfaRequiredRoles.includes(row.role)),
      authSource: row.auth_source,
      emailNotifications: row.email_notifications === 1,
      monthlyReport: row.monthly_report === 1,
      guest: row.is_guest === 1,
      guestExpiresAt: row.is_guest === 1 ? row.guest_expires_at : null,
    };
  }
}
