import type { GlobalRole, SessionUser } from '@suboard/shared';
import type { AppConfig } from '../config.js';
import { nowIso, type DB } from '../db/index.js';
import { getDummyHash, hashPassword, newSessionToken, sha256, verifyPassword } from '../lib/crypto.js';
import { AppError, badRequest } from '../lib/errors.js';
import type { AuditService } from './audit.js';

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
}

export interface ResolvedSession {
  sessionId: string;
  user: SessionUser;
}

/** Single generic message: does not reveal whether the account exists, is locked or disabled. */
const INVALID_CREDENTIALS = 'אימייל או סיסמה שגויים, או שהחשבון ננעל זמנית. נסו שוב מאוחר יותר.';

export class AuthService {
  constructor(
    private readonly db: DB,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
  ) {}

  async login(email: string, password: string, meta: { ip: string; userAgent?: string }): Promise<{ token: string; user: SessionUser }> {
    const row = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;

    if (!row) {
      await verifyPassword(password, await getDummyHash()); // equalize response timing
      this.audit.log('login_failed', { ip: meta.ip, meta: { reason: 'unknown_account' } });
      throw new AppError(401, 'INVALID_CREDENTIALS', INVALID_CREDENTIALS);
    }

    const now = Date.now();
    if (row.locked_until && Date.parse(row.locked_until) > now) {
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

    const token = newSessionToken();
    const ts = nowIso();
    this.db.transaction(() => {
      this.db
        .prepare('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?')
        .run(ts, row.id);
      this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at < ?').run(row.id, ts);
      this.db
        .prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)')
        .run(sha256(token), row.id, ts, new Date(now + this.config.sessionTtlMs).toISOString(), ts, meta.userAgent?.slice(0, 200) ?? null);
    })();
    this.audit.log('login_success', { userId: row.id, ip: meta.ip });

    return { token, user: toSessionUser(row) };
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
    return { sessionId: id, user: toSessionUser(row) };
  }

  logout(sessionId: string, userId: string, ip: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    this.audit.log('logout', { userId, ip });
  }

  async changePassword(userId: string, sessionId: string, current: string, next: string, ip: string): Promise<void> {
    const row = this.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as
      | { password_hash: string }
      | undefined;
    if (!row || !(await verifyPassword(current, row.password_hash))) {
      this.audit.log('password_change_failed', { userId, ip });
      throw badRequest('הסיסמה הנוכחית שגויה', { currentPassword: 'הסיסמה הנוכחית שגויה' });
    }
    const hash = await hashPassword(next);
    this.db.transaction(() => {
      this.db
        .prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?')
        .run(hash, nowIso(), userId);
      // Revoke every other session of this user.
      this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(userId, sessionId);
    })();
    this.audit.log('password_changed', { userId, ip });
  }

  revokeAllSessions(userId: string): void {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }

  purgeExpiredSessions(): number {
    const idleCutoff = new Date(Date.now() - this.config.sessionIdleMs).toISOString();
    return this.db.prepare('DELETE FROM sessions WHERE expires_at < ? OR last_seen_at < ?').run(nowIso(), idleCutoff).changes;
  }
}

function toSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    mustChangePassword: row.must_change_password === 1,
  };
}
