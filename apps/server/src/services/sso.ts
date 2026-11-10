import { randomBytes } from 'node:crypto';
import * as oidc from 'openid-client';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../config.js';
import { nowIso, type DB } from '../db/index.js';
import { hashPassword, newId, sha256 } from '../lib/crypto.js';
import type { AuditService } from './audit.js';
import type { AuthService, LoginResult } from './auth.js';

const STATE_TTL_MS = 10 * 60_000;

/** Reason codes shown on the login page (mapped to Hebrew messages in the UI). */
export type SsoErrorCode = 'state' | 'exchange' | 'no_email' | 'domain' | 'no_account' | 'inactive' | 'mismatch' | 'unavailable';
export class SsoError extends Error {
  constructor(readonly code: SsoErrorCode, readonly detail = '') {
    super(code);
  }
}

/** Same rule as the web client: an in-app path only (no scheme, no protocol-relative, no control chars). */
export function safeNext(next: string | undefined | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\') || /[\u0000-\u001f]/.test(next) || next.length > 500) return '/';
  return next;
}

/**
 * OpenID Connect sign-in (Microsoft Entra ID or any OIDC provider): Authorization Code + PKCE,
 * state + nonce kept server-side (one use, 10 minutes), ID-token signature / issuer / audience /
 * nonce validated by `openid-client`. Accounts are linked by the provider's immutable id; the first
 * login may link an existing account by e-mail, never re-link an account bound to another id.
 */
export class SsoService {
  private discovered: Promise<oidc.Configuration> | null = null;

  constructor(
    private readonly db: DB,
    private readonly config: AppConfig,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private log: Pick<FastifyBaseLogger, 'error' | 'warn'> = console,
  ) {}

  setLogger(log: Pick<FastifyBaseLogger, 'error' | 'warn'>) {
    this.log = log;
  }

  get enabled(): boolean {
    return this.config.sso !== null;
  }

  get redirectUri(): string {
    return `${this.config.publicUrl}/api/auth/sso/callback`;
  }

  publicConfig(): { enabled: boolean; label: string; localLogin: AppConfig['localLogin'] } {
    return { enabled: this.enabled, label: this.config.sso?.label ?? '', localLogin: this.config.localLogin };
  }

  private configuration(): Promise<oidc.Configuration> {
    const sso = this.config.sso;
    if (!sso) return Promise.reject(new SsoError('unavailable'));
    if (!this.discovered) {
      this.discovered = oidc
        .discovery(new URL(sso.issuer), sso.clientId, sso.clientSecret, undefined, sso.allowInsecure ? { execute: [oidc.allowInsecureRequests] } : undefined)
        .catch((err: unknown) => {
          this.discovered = null; // retry discovery on the next attempt
          this.log.error({ err: err instanceof Error ? err.message : String(err) }, 'OIDC discovery failed');
          throw new SsoError('unavailable');
        });
    }
    return this.discovered;
  }

  /** Begins a login: returns the IdP URL and the opaque cookie value that ties the callback to it. */
  async start(next: string | undefined): Promise<{ url: string; cookie: string }> {
    const cfg = await this.configuration();
    const cookie = randomBytes(32).toString('base64url');
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const verifier = oidc.randomPKCECodeVerifier();
    const challenge = await oidc.calculatePKCECodeChallenge(verifier);
    this.db.prepare('DELETE FROM sso_states WHERE expires_at < ?').run(nowIso());
    this.db
      .prepare('INSERT INTO sso_states (id, state, nonce, code_verifier, next_path, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(sha256(cookie), state, nonce, verifier, safeNext(next), new Date(Date.now() + STATE_TTL_MS).toISOString());
    const url = oidc.buildAuthorizationUrl(cfg, {
      redirect_uri: this.redirectUri,
      scope: this.config.sso!.scopes,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      nonce,
      prompt: 'select_account',
    });
    return { url: url.href, cookie };
  }

  /** Completes a login from the IdP redirect. Throws SsoError with a reason code on any failure. */
  async callback(cookie: string | undefined, callbackUrl: URL, meta: { ip: string; userAgent?: string }): Promise<{ result: LoginResult; next: string }> {
    const fail = (code: SsoErrorCode, detail = '') => {
      this.audit.log('sso_login_failed', { ip: meta.ip, meta: { reason: code, ...(detail ? { detail: detail.slice(0, 120) } : {}) } });
      return new SsoError(code, detail);
    };
    if (!cookie) throw fail('state');
    const id = sha256(cookie);
    const pending = this.db.prepare('SELECT * FROM sso_states WHERE id = ?').get(id) as
      | { state: string; nonce: string; code_verifier: string; next_path: string; expires_at: string }
      | undefined;
    this.db.prepare('DELETE FROM sso_states WHERE id = ?').run(id); // one use, whatever happens next
    if (!pending || Date.parse(pending.expires_at) < Date.now()) throw fail('state');

    const cfg = await this.configuration();
    let claims: oidc.IDToken;
    try {
      const tokens = await oidc.authorizationCodeGrant(cfg, callbackUrl, {
        pkceCodeVerifier: pending.code_verifier,
        expectedState: pending.state,
        expectedNonce: pending.nonce,
        idTokenExpected: true,
      });
      const c = tokens.claims();
      if (!c) throw new Error('no id_token');
      claims = c;
    } catch (err) {
      throw fail('exchange', err instanceof Error ? err.message : String(err));
    }

    // Entra ID: `oid` is the user's immutable id in the tenant; other IdPs: `sub`.
    const oid = typeof claims.oid === 'string' ? claims.oid : claims.sub;
    const subject = `${claims.iss}|${oid}`;
    const rawEmail = [claims.email, claims.preferred_username, claims.upn].find((v): v is string => typeof v === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v));
    if (!rawEmail) throw fail('no_email');
    const email = rawEmail.trim().toLowerCase();
    const domains = this.config.sso!.allowedDomains;
    if (domains.length && !domains.includes(email.split('@')[1]!)) throw fail('domain', email.split('@')[1]);
    const amr = Array.isArray(claims.amr) ? (claims.amr as unknown[]) : [];
    const idpMfa = this.config.sso!.trustIdpMfa || amr.includes('mfa');

    type LinkRow = { id: string; is_active: number; sso_subject: string | null };
    let user = this.db.prepare('SELECT id, is_active, sso_subject FROM users WHERE sso_subject = ?').get(subject) as LinkRow | undefined;
    if (!user) {
      const byEmail = this.db.prepare('SELECT id, is_active, sso_subject FROM users WHERE email = ?').get(email) as LinkRow | undefined;
      if (byEmail) {
        // Never move an account that is already bound to a different IdP identity (e-mail reuse).
        if (byEmail.sso_subject && byEmail.sso_subject !== subject) throw fail('mismatch');
        this.db.prepare("UPDATE users SET sso_subject = ?, auth_source = CASE WHEN auth_source = 'local' THEN 'sso' ELSE auth_source END, updated_at = ? WHERE id = ?").run(subject, nowIso(), byEmail.id);
        user = { ...byEmail, sso_subject: subject };
      } else if (this.config.sso!.jit) {
        const name = (typeof claims.name === 'string' && claims.name.trim()) || email.split('@')[0]!;
        const newIdValue = newId();
        const ts = nowIso();
        this.db
          .prepare(
            `INSERT INTO users (id, email, name, password_hash, role, is_active, must_change_password, auth_source, sso_subject, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'member', 1, 0, 'sso', ?, ?, ?)`,
          )
          // A random password nobody knows: the account can only sign in through SSO.
          .run(newIdValue, email, name.slice(0, 80), await hashPassword(randomBytes(32).toString('base64url')), subject, ts, ts);
        this.audit.log('user_created', { userId: null, ip: meta.ip, meta: { targetUserId: newIdValue, role: 'member', via: 'sso_jit' } });
        user = { id: newIdValue, is_active: 1, sso_subject: subject };
      } else {
        throw fail('no_account', email.split('@')[1]);
      }
    }
    if (!user) throw fail('no_account');
    if (!user.is_active) throw fail('inactive');
    return { result: this.auth.ssoLogin(user.id, idpMfa, meta), next: pending.next_path };
  }
}
