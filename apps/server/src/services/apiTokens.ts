import type { ApiTokenInfo, SessionUser } from '@suboard/shared';
import { randomBytes } from 'node:crypto';
import { nowIso, type DB } from '../db/index.js';
import { newId, sha256 } from '../lib/crypto.js';
import { badRequest, notFound } from '../lib/errors.js';
import type { AuditService } from './audit.js';
import type { AuthService } from './auth.js';
import type { ModuleService } from './modules.js';

export const MAX_TOKENS_PER_USER = 5;
export const TOKEN_PREFIX = 'sbp_';
const TOKEN_RE = /^sbp_[A-Za-z0-9_-]{43}$/;

interface Row {
  id: string;
  user_id: string;
  name: string;
  token_hash: string;
  hint: string;
  scope: 'read' | 'write';
  created_at: string;
  last_used_at: string | null;
  expires_at: string;
}

/**
 * Personal API tokens: let a script act as its owner through the same API, with the owner's own
 * permissions — never more. Only a hash is stored; the token is shown once. Every token expires.
 */
export class ApiTokenService {
  constructor(
    private readonly db: DB,
    private readonly auth: AuthService,
    private readonly modules: ModuleService,
    private readonly audit: AuditService,
  ) {}

  private static info(r: Row): ApiTokenInfo {
    return { id: r.id, name: r.name, hint: r.hint, scope: r.scope, createdAt: r.created_at, lastUsedAt: r.last_used_at, expiresAt: r.expires_at };
  }

  list(userId: string): ApiTokenInfo[] {
    return (this.db.prepare('SELECT * FROM api_tokens WHERE user_id = ? ORDER BY created_at').all(userId) as Row[]).map((r) => ApiTokenService.info(r));
  }

  create(userId: string, input: { name: string; scope: 'read' | 'write'; days: number }, ip: string): { token: string; info: ApiTokenInfo } {
    this.db.prepare('DELETE FROM api_tokens WHERE user_id = ? AND expires_at < ?').run(userId, nowIso());
    const count = (this.db.prepare('SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ?').get(userId) as { n: number }).n;
    if (count >= MAX_TOKENS_PER_USER) throw badRequest(`אפשר להחזיק עד ${MAX_TOKENS_PER_USER} אסימונים. בטלו אסימון ישן כדי ליצור חדש.`);
    const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
    const id = newId();
    this.db
      .prepare('INSERT INTO api_tokens (id, user_id, name, token_hash, hint, scope, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, userId, input.name, sha256(token), token.slice(-4), input.scope, nowIso(), new Date(Date.now() + input.days * 86_400_000).toISOString());
    this.audit.log('api_token_changed', { userId, ip, meta: { action: 'created', tokenId: id, scope: input.scope, days: input.days } });
    return { token, info: ApiTokenService.info(this.db.prepare('SELECT * FROM api_tokens WHERE id = ?').get(id) as Row) };
  }

  revoke(userId: string, id: string, ip: string): void {
    const res = this.db.prepare('DELETE FROM api_tokens WHERE id = ? AND user_id = ?').run(id, userId);
    if (!res.changes) throw notFound('האסימון לא נמצא');
    this.audit.log('api_token_changed', { userId, ip, meta: { action: 'revoked', tokenId: id } });
  }

  /** Admin action after a lost device or a suspected compromise. */
  revokeAllOf(userId: string): number {
    return this.db.prepare('DELETE FROM api_tokens WHERE user_id = ?').run(userId).changes;
  }

  /**
   * The user a bearer token stands for, or null. Refused while the module is off, when the token is
   * unknown or expired, and for accounts that are inactive or still have to replace a temporary password.
   */
  resolve(header: string | undefined): { user: SessionUser; scope: 'read' | 'write' } | null {
    const m = /^Bearer (\S+)$/.exec(header ?? '');
    if (!m || !TOKEN_RE.test(m[1]!) || !this.modules.enabled('api_tokens')) return null;
    const r = this.db.prepare('SELECT * FROM api_tokens WHERE token_hash = ?').get(sha256(m[1]!)) as Row | undefined;
    if (!r || Date.parse(r.expires_at) <= Date.now()) return null;
    const active = this.db.prepare('SELECT is_active, must_change_password FROM users WHERE id = ?').get(r.user_id) as { is_active: number; must_change_password: number } | undefined;
    if (!active || !active.is_active || active.must_change_password) return null;
    // Throttle writes: remember the last use at most once a minute.
    if (!r.last_used_at || Date.now() - Date.parse(r.last_used_at) > 60_000) this.db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(nowIso(), r.id);
    const user = this.auth.getSessionUser(r.user_id);
    if (user.guest) return null; // guests have no API access
    // A token is created from a fully signed-in session; it does not have to enrol MFA again.
    return { user: { ...user, mfaSetupRequired: false }, scope: r.scope };
  }

  purgeExpired(): number {
    return this.db.prepare('DELETE FROM api_tokens WHERE expires_at < ?').run(nowIso()).changes;
  }
}
