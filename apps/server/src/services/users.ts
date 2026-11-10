import type { AdminUser, CreateUserInput, DirectoryUser, GlobalRole, UpdateUserInput } from '@suboard/shared';
import { nowIso, type DB } from '../db/index.js';
import { hashPassword, newId } from '../lib/crypto.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import type { Actor } from './access.js';
import type { AuditService } from './audit.js';
import type { AuthService } from './auth.js';

interface Row {
  id: string;
  email: string;
  name: string;
  role: GlobalRole;
  is_active: number;
  must_change_password: number;
  mfa_enabled: number;
  locked_until: string | null;
  last_login_at: string | null;
  created_at: string;
  auth_source: 'local' | 'sso' | 'scim';
}

const toAdminUser = (r: Row): AdminUser => ({
  id: r.id,
  email: r.email,
  name: r.name,
  role: r.role,
  isActive: r.is_active === 1,
  mustChangePassword: r.must_change_password === 1,
  mfaEnabled: r.mfa_enabled === 1,
  lockedUntil: r.locked_until && Date.parse(r.locked_until) > Date.now() ? r.locked_until : null,
  authSource: r.auth_source,
  lastLoginAt: r.last_login_at,
  createdAt: r.created_at,
});

export class UserService {
  constructor(
    private readonly db: DB,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  /** Minimal directory (id + name) for person pickers — no emails exposed to regular users. */
  directory(): DirectoryUser[] {
    return this.db.prepare('SELECT id, name FROM users WHERE is_active = 1 ORDER BY name').all() as DirectoryUser[];
  }

  list(): AdminUser[] {
    return (this.db.prepare('SELECT * FROM users ORDER BY created_at').all() as Row[]).map(toAdminUser);
  }

  async create(actor: Actor | null, input: CreateUserInput, opts: { mustChangePassword?: boolean } = {}): Promise<AdminUser> {
    if (this.db.prepare('SELECT 1 FROM users WHERE email = ?').get(input.email)) {
      throw conflict('משתמש עם כתובת דוא"ל זו כבר קיים');
    }
    const id = newId();
    const ts = nowIso();
    this.db
      .prepare(
        `INSERT INTO users (id, email, name, password_hash, role, is_active, must_change_password, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      )
      .run(id, input.email, input.name, await hashPassword(input.password), input.role, opts.mustChangePassword === false ? 0 : 1, ts, ts);
    this.audit.log('user_created', { userId: actor?.id ?? null, meta: { targetUserId: id, role: input.role } });
    return this.get(id);
  }

  get(id: string): AdminUser {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw notFound('המשתמש לא נמצא');
    return toAdminUser(row);
  }

  async update(actor: Actor, id: string, input: UpdateUserInput): Promise<AdminUser> {
    const existing = this.get(id);
    if (actor.id === id && (input.isActive === false || (input.role && input.role !== 'admin'))) {
      throw badRequest('לא ניתן להשבית או להסיר הרשאת מנהל מהחשבון שלך');
    }
    if (existing.role === 'admin' && ((input.role && input.role !== 'admin') || input.isActive === false)) {
      const admins = this.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1").get() as { n: number };
      if (admins.n <= 1) throw badRequest('חייב להישאר לפחות מנהל מערכת פעיל אחד');
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    if (input.name !== undefined) {
      sets.push('name = ?');
      params.push(input.name);
    }
    if (input.role !== undefined) {
      sets.push('role = ?');
      params.push(input.role);
    }
    if (input.isActive !== undefined) {
      sets.push('is_active = ?');
      params.push(input.isActive ? 1 : 0);
    }
    if (input.password !== undefined) {
      sets.push('password_hash = ?', 'must_change_password = 1', 'failed_logins = 0', 'locked_until = NULL');
      params.push(await hashPassword(input.password));
    }
    if (input.unlock) sets.push('failed_logins = 0', 'locked_until = NULL');
    sets.push('updated_at = ?');
    params.push(nowIso());

    this.db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);

    // Credentials reset or account disabled → kill all existing sessions.
    if (input.password !== undefined || input.isActive === false) this.auth.revokeAllSessions(id);

    this.audit.log('user_updated', {
      userId: actor.id,
      meta: {
        targetUserId: id,
        changed: Object.keys(input).filter((k) => (input as Record<string, unknown>)[k] !== undefined),
        ...(input.role ? { role: input.role } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
    return this.get(id);
  }

  /** Admin reset of a user's MFA (lost device). Signs the user out everywhere. */
  resetMfa(actor: Actor, id: string, mfa: { clear(userId: string): void }): AdminUser {
    this.get(id);
    mfa.clear(id);
    this.auth.revokeAllSessions(id);
    this.audit.log('mfa_reset', { userId: actor.id, meta: { targetUserId: id } });
    return this.get(id);
  }

  exists(id: string): boolean {
    return this.db.prepare('SELECT 1 FROM users WHERE id = ?').get(id) !== undefined;
  }

  countUsers(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  }
}
