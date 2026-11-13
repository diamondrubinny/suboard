import type { AuditEntry } from '@suboard/shared';
import { nowIso, parseJson, type DB } from '../db/index.js';
import { hmac, newId } from '../lib/crypto.js';

export type AuditEvent =
  | 'login_success'
  | 'login_failed'
  | 'account_locked'
  | 'logout'
  | 'password_changed'
  | 'password_change_failed'
  | 'password_reset_requested'
  | 'password_reset'
  | 'password_reset_failed'
  | 'passkey_added'
  | 'passkey_add_failed'
  | 'passkey_removed'
  | 'user_created'
  | 'user_updated'
  | 'board_created'
  | 'board_duplicated'
  | 'modules_changed'
  | 'workspace_changed'
  | 'board_opened'
  | 'webhook_changed'
  | 'api_token_changed'
  | 'template_created'
  | 'template_deleted'
  | 'board_archived'
  | 'member_set'
  | 'member_removed'
  | 'access_denied'
  | 'mfa_enabled'
  | 'mfa_disabled'
  | 'mfa_disable_failed'
  | 'mfa_failed'
  | 'mfa_recovery_code_used'
  | 'mfa_reset'
  | 'upload_rejected'
  | 'malware_detected'
  | 'data_export'
  | 'sso_login_success'
  | 'sso_login_failed'
  | 'scim_user_created'
  | 'scim_user_updated'
  | 'scim_user_deactivated'
  | 'scim_auth_failed'
  | 'session_revoked'
  | 'sessions_revoked_others'
  | 'sessions_revoked_by_admin';

/**
 * Security audit trail. Stores an HMAC of the client IP (never the raw IP) and only
 * non-sensitive metadata: never passwords, tokens or free-text content.
 */
export class AuditService {
  constructor(
    private readonly db: DB,
    private readonly ipSecret: string,
  ) {}

  log(event: AuditEvent, opts: { userId?: string | null; ip?: string; meta?: Record<string, unknown> } = {}): void {
    this.db
      .prepare('INSERT INTO audit_log (id, user_id, event, ip_hash, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(
        newId(),
        opts.userId ?? null,
        event,
        opts.ip ? hmac(this.ipSecret, opts.ip).slice(0, 32) : null,
        JSON.stringify(opts.meta ?? {}),
        nowIso(),
      );
  }

  list(opts: { event?: string; before?: string; limit?: number } = {}): AuditEntry[] {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts.event) {
      where.push('a.event = ?');
      params.push(opts.event);
    }
    if (opts.before) {
      where.push('a.created_at < ?');
      params.push(opts.before);
    }
    const sql = `SELECT a.id, a.user_id, u.name AS user_name, a.event, a.meta, a.created_at
      FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY a.created_at DESC LIMIT ?`;
    const rows = this.db.prepare(sql).all(...params, limit) as {
      id: string;
      user_id: string | null;
      user_name: string | null;
      event: string;
      meta: string;
      created_at: string;
    }[];
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      userName: r.user_name,
      event: r.event,
      meta: parseJson(r.meta, {}),
      createdAt: r.created_at,
    }));
  }

  /** Retention: delete audit entries older than `days`. */
  purgeOlderThan(days: number): number {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    return this.db.prepare('DELETE FROM audit_log WHERE created_at < ?').run(cutoff).changes;
  }
}
