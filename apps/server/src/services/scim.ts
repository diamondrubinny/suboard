import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { AppConfig } from '../config.js';
import { nowIso, type DB } from '../db/index.js';
import { hashPassword, newId, sha256 } from '../lib/crypto.js';
import type { AuditService } from './audit.js';
import type { AuthService } from './auth.js';

export const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';

/** A SCIM protocol error (RFC 7644 §3.12). */
export class ScimError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly scimType?: string,
  ) {
    super(message);
  }
  body() {
    return { schemas: [ERROR_SCHEMA], status: String(this.status), ...(this.scimType ? { scimType: this.scimType } : {}), detail: this.message };
  }
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  is_active: number;
  scim_external_id: string | null;
  auth_source: string;
  created_at: string;
  updated_at: string;
}

type ScimUserInput = {
  userName?: unknown;
  externalId?: unknown;
  displayName?: unknown;
  name?: { formatted?: unknown; givenName?: unknown; familyName?: unknown };
  emails?: { value?: unknown; primary?: unknown; type?: unknown }[];
  active?: unknown;
};

const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
/** SCIM clients (notably Entra ID) send booleans as "True" / "False" strings in PATCH. */
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : typeof v === 'string' ? (v.toLowerCase() === 'true' ? true : v.toLowerCase() === 'false' ? false : undefined) : undefined);
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * SCIM 2.0 user provisioning (Users only). Bearer-token auth (constant-time compare). DELETE and
 * active=false deactivate (never delete) and revoke sessions at once. New users are members with an
 * unknown random password (SSO-only); roles are managed in the app by an admin. The last active
 * admin is never deactivated through SCIM.
 */
export class ScimService {
  constructor(
    private readonly db: DB,
    private readonly config: AppConfig,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  get enabled(): boolean {
    return this.config.scimToken !== null;
  }

  /** Constant-time check of `Authorization: Bearer <token>`. */
  authorize(header: string | undefined, ip: string): void {
    const token = this.config.scimToken;
    if (!token) throw new ScimError(404, 'SCIM is not enabled');
    const given = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const a = Buffer.from(sha256(given), 'hex');
    const b = Buffer.from(sha256(token), 'hex');
    if (!given || !timingSafeEqual(a, b)) {
      this.audit.log('scim_auth_failed', { ip });
      throw new ScimError(401, 'Invalid bearer token');
    }
  }

  private location = (id: string) => `${this.config.publicUrl}/scim/v2/Users/${id}`;

  toScim(r: UserRow) {
    const [given, ...rest] = r.name.split(' ');
    return {
      schemas: [USER_SCHEMA],
      id: r.id,
      ...(r.scim_external_id ? { externalId: r.scim_external_id } : {}),
      userName: r.email,
      displayName: r.name,
      name: { formatted: r.name, givenName: given ?? '', familyName: rest.join(' ') },
      emails: [{ value: r.email, type: 'work', primary: true }],
      active: r.is_active === 1,
      meta: { resourceType: 'User', created: r.created_at, lastModified: r.updated_at, location: this.location(r.id) },
    };
  }

  private row(id: string): UserRow {
    const r = /^[0-9a-f-]{36}$/i.test(id) ? (this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined) : undefined;
    if (!r) throw new ScimError(404, 'User not found');
    return r;
  }

  /** Extracts the fields we store from a SCIM User document. */
  private fields(u: ScimUserInput): { email?: string; name?: string; externalId?: string; active?: boolean } {
    const workEmail = u.emails?.find((e) => bool(e.primary) || e.type === 'work')?.value ?? u.emails?.[0]?.value;
    const email = (str(workEmail, 254) ?? str(u.userName, 254))?.toLowerCase();
    if (email !== undefined && !EMAIL.test(email)) throw new ScimError(400, 'userName / email must be an e-mail address', 'invalidValue');
    const fromParts = [str(u.name?.givenName, 40), str(u.name?.familyName, 40)].filter(Boolean).join(' ');
    const name = str(u.displayName, 80) ?? str(u.name?.formatted, 80) ?? (fromParts || undefined);
    return { email, name, externalId: str(u.externalId, 200), active: bool(u.active) };
  }

  list(filter: string | undefined, startIndex: number, count: number) {
    let where = '1 = 1';
    const params: unknown[] = [];
    if (filter) {
      const m = /^\s*(userName|externalId|emails\.value)\s+eq\s+"([^"]{1,254})"\s*$/i.exec(filter);
      if (!m) throw new ScimError(400, 'Only "userName eq", "externalId eq" and "emails.value eq" filters are supported', 'invalidFilter');
      const attr = m[1]!.toLowerCase();
      if (attr === 'externalid') {
        where = 'scim_external_id = ?';
        params.push(m[2]);
      } else {
        where = 'email = ?';
        params.push(m[2]!.toLowerCase());
      }
    }
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM users WHERE ${where}`).get(...params) as { n: number }).n;
    const rows = this.db.prepare(`SELECT * FROM users WHERE ${where} ORDER BY created_at LIMIT ? OFFSET ?`).all(...params, Math.min(Math.max(count, 0), 200), Math.max(startIndex - 1, 0)) as UserRow[];
    return { schemas: [LIST_SCHEMA], totalResults: total, startIndex, itemsPerPage: rows.length, Resources: rows.map((r) => this.toScim(r)) };
  }

  get(id: string) {
    return this.toScim(this.row(id));
  }

  async create(body: ScimUserInput, ip: string) {
    const f = this.fields(body);
    if (!f.email) throw new ScimError(400, 'userName is required', 'invalidValue');
    if (this.db.prepare('SELECT 1 FROM users WHERE email = ?').get(f.email)) throw new ScimError(409, 'A user with this userName already exists', 'uniqueness');
    if (f.externalId && this.db.prepare('SELECT 1 FROM users WHERE scim_external_id = ?').get(f.externalId)) throw new ScimError(409, 'externalId already in use', 'uniqueness');
    const id = newId();
    const ts = nowIso();
    this.db
      .prepare(
        `INSERT INTO users (id, email, name, password_hash, role, is_active, must_change_password, auth_source, scim_external_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'member', ?, 0, 'scim', ?, ?, ?)`,
      )
      // Unknown random password: SCIM users sign in through SSO only.
      .run(id, f.email, f.name ?? f.email.split('@')[0]!, await hashPassword(randomBytes(32).toString('base64url')), f.active === false ? 0 : 1, f.externalId ?? null, ts, ts);
    this.audit.log('scim_user_created', { ip, meta: { targetUserId: id } });
    return this.get(id);
  }

  private apply(id: string, f: { email?: string; name?: string; externalId?: string; active?: boolean }, ip: string) {
    const cur = this.row(id);
    if (f.email && f.email !== cur.email && this.db.prepare('SELECT 1 FROM users WHERE email = ? AND id <> ?').get(f.email, id)) {
      throw new ScimError(409, 'A user with this userName already exists', 'uniqueness');
    }
    if (f.active === false && cur.is_active && cur.role === 'admin') {
      const admins = (this.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1").get() as { n: number }).n;
      if (admins <= 1) throw new ScimError(400, 'Refusing to deactivate the last active administrator', 'mutability');
    }
    this.db
      .prepare('UPDATE users SET email = ?, name = ?, scim_external_id = ?, is_active = ?, updated_at = ? WHERE id = ?')
      .run(f.email ?? cur.email, f.name ?? cur.name, f.externalId ?? cur.scim_external_id, f.active === undefined ? cur.is_active : f.active ? 1 : 0, nowIso(), id);
    if (f.active === false && cur.is_active) {
      this.auth.revokeAllSessions(id);
      this.audit.log('scim_user_deactivated', { ip, meta: { targetUserId: id } });
    } else {
      this.audit.log('scim_user_updated', { ip, meta: { targetUserId: id, ...(f.active === true && !cur.is_active ? { reactivated: true } : {}) } });
    }
    return this.get(id);
  }

  replace(id: string, body: ScimUserInput, ip: string) {
    return this.apply(id, this.fields(body), ip);
  }

  /** PATCH (RFC 7644 §3.5.2) — the operation shapes Entra ID and other provisioners send. */
  patch(id: string, body: { Operations?: { op?: string; path?: string; value?: unknown }[] }, ip: string) {
    const ops = body.Operations;
    if (!Array.isArray(ops) || !ops.length) throw new ScimError(400, 'Operations are required', 'invalidSyntax');
    const doc: ScimUserInput = {};
    for (const op of ops) {
      const kind = (op.op ?? '').toLowerCase();
      if (kind === 'remove') continue; // removing optional attributes we do not store is a no-op
      if (kind !== 'replace' && kind !== 'add') throw new ScimError(400, `Unsupported op "${op.op}"`, 'invalidSyntax');
      const path = (op.path ?? '').trim();
      const v = op.value;
      if (!path) {
        if (v && typeof v === 'object') Object.assign(doc, v as ScimUserInput);
        continue;
      }
      const p = path.toLowerCase();
      if (p === 'active') doc.active = v;
      else if (p === 'username') doc.userName = v;
      else if (p === 'displayname') doc.displayName = v;
      else if (p === 'externalid') doc.externalId = v;
      else if (p === 'name.formatted') doc.name = { ...doc.name, formatted: v };
      else if (p === 'name.givenname') doc.name = { ...doc.name, givenName: v };
      else if (p === 'name.familyname') doc.name = { ...doc.name, familyName: v };
      else if (p.startsWith('emails')) doc.emails = [{ value: Array.isArray(v) ? (v[0] as { value?: unknown })?.value : v, primary: true }];
      // Other attributes (phone numbers, titles, enterprise extension…) are not stored: ignored.
    }
    const f = this.fields(doc);
    if (!('userName' in doc) && !doc.emails) delete f.email; // do not touch the e-mail unless sent
    return this.apply(id, f, ip);
  }

  deactivate(id: string, ip: string): void {
    this.apply(id, { active: false }, ip);
  }

  serviceProviderConfig() {
    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: 200 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [{ type: 'oauthbearertoken', name: 'Bearer token', description: 'Static bearer token (SCIM_TOKEN)', primary: true }],
      meta: { resourceType: 'ServiceProviderConfig', location: `${this.config.publicUrl}/scim/v2/ServiceProviderConfig` },
    };
  }

  resourceTypes() {
    return {
      schemas: [LIST_SCHEMA],
      totalResults: 1,
      Resources: [
        {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
          id: 'User',
          name: 'User',
          endpoint: '/Users',
          schema: USER_SCHEMA,
          meta: { resourceType: 'ResourceType', location: `${this.config.publicUrl}/scim/v2/ResourceTypes/User` },
        },
      ],
    };
  }

  schemas() {
    return {
      schemas: [LIST_SCHEMA],
      totalResults: 1,
      Resources: [
        {
          id: USER_SCHEMA,
          name: 'User',
          attributes: ['userName', 'displayName', 'name', 'emails', 'active', 'externalId'].map((name) => ({ name, type: name === 'active' ? 'boolean' : name === 'name' || name === 'emails' ? 'complex' : 'string', multiValued: name === 'emails', required: name === 'userName', mutability: 'readWrite', returned: 'default', uniqueness: name === 'userName' ? 'server' : 'none' })),
          meta: { resourceType: 'Schema', location: `${this.config.publicUrl}/scim/v2/Schemas/${USER_SCHEMA}` },
        },
      ],
    };
  }
}
