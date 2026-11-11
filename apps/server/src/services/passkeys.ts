import type { PasskeyInfo } from '@suboard/shared';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { AppConfig } from '../config.js';
import { randomUUID } from 'node:crypto';
import { nowIso, type DB } from '../db/index.js';
import { newSessionToken, sha256 } from '../lib/crypto.js';
import { AppError, badRequest, notFound } from '../lib/errors.js';
import { describeUserAgent } from '../lib/userAgent.js';
import type { AuditService } from './audit.js';
import type { AuthService } from './auth.js';

const CHALLENGE_TTL_MS = 5 * 60_000;
export const MAX_PASSKEYS_PER_USER = 10;
/** One generic answer for every failed sign-in: reveals nothing about which step failed. */
const LOGIN_FAILED = 'הכניסה עם מפתח הגישה נכשלה. נסו שוב או התחברו בסיסמה.';

interface PasskeyRow {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: Buffer;
  counter: number;
  transports: string;
  backed_up: number;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

const safeTransports = (json: string): string[] => {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
};

/**
 * Passkeys (WebAuthn / FIDO2) as a sign-in method. Discoverable credentials with user verification
 * required: the device checks a biometric or PIN locally and proves possession of a private key that
 * never leaves it. The server keeps only the public key.
 */
export class PasskeyService {
  /** The domain the passkeys are bound to, and the only origins a ceremony is accepted from. */
  readonly rpId: string;
  private readonly origins: string[];

  constructor(
    private readonly db: DB,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {
    const pub = new URL(config.publicUrl);
    this.rpId = pub.hostname;
    // Development only: the Vite dev server on the same host name is a second accepted origin.
    const extra = config.env === 'production' ? [] : config.allowedOrigins.filter((o) => URL.canParse(o) && new URL(o).hostname === pub.hostname);
    this.origins = [...new Set([pub.origin, ...extra])];
  }

  /** Offered on the sign-in page unless local sign-in is switched off in favour of SSO. */
  get loginAvailable(): boolean {
    return this.config.localLogin !== 'disabled';
  }

  list(userId: string): PasskeyInfo[] {
    return (this.db.prepare('SELECT * FROM passkeys WHERE user_id = ? ORDER BY created_at').all(userId) as PasskeyRow[]).map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
      synced: r.backed_up === 1,
    }));
  }

  private saveChallenge(kind: 'register' | 'login', userId: string | null, challenge: string): string {
    const handle = newSessionToken();
    const now = nowIso();
    this.db.prepare('DELETE FROM webauthn_challenges WHERE expires_at < ?').run(now);
    if (userId) this.db.prepare("DELETE FROM webauthn_challenges WHERE user_id = ? AND kind = 'register'").run(userId);
    this.db
      .prepare('INSERT INTO webauthn_challenges (id, kind, user_id, challenge, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run(sha256(handle), kind, userId, challenge, new Date(Date.now() + CHALLENGE_TTL_MS).toISOString());
    return handle;
  }

  /** Single use: the challenge is deleted as it is read, whatever the outcome of the ceremony. */
  private takeChallenge(kind: 'register' | 'login', handle: string): { challenge: string; userId: string | null } | null {
    const id = sha256(handle);
    const row = this.db.prepare('SELECT kind, user_id, challenge, expires_at FROM webauthn_challenges WHERE id = ?').get(id) as
      | { kind: string; user_id: string | null; challenge: string; expires_at: string }
      | undefined;
    this.db.prepare('DELETE FROM webauthn_challenges WHERE id = ?').run(id);
    if (!row || row.kind !== kind || Date.parse(row.expires_at) <= Date.now()) return null;
    return { challenge: row.challenge, userId: row.user_id };
  }

  // ------------------------------------------------------------------ registration (signed-in user)

  async registrationOptions(
    user: { id: string; email: string; name: string; authSource: string },
    password: string | undefined,
    ip: string,
  ): Promise<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }> {
    // Adding a sign-in method is as sensitive as changing the password: accounts that have a
    // password of their own confirm it first (a stolen open session is not enough).
    if (user.authSource === 'local' && !(password && (await this.auth.checkPassword(user.id, password)))) {
      this.audit.log('passkey_add_failed', { userId: user.id, ip, meta: { reason: 'bad_password' } });
      throw badRequest('הסיסמה שגויה', { password: 'הסיסמה שגויה' });
    }
    const existing = this.db.prepare('SELECT credential_id, transports FROM passkeys WHERE user_id = ?').all(user.id) as { credential_id: string; transports: string }[];
    if (existing.length >= MAX_PASSKEYS_PER_USER) throw badRequest(`אפשר לשמור עד ${MAX_PASSKEYS_PER_USER} מפתחות גישה. מחקו מפתח ישן כדי להוסיף חדש.`);
    const options = await generateRegistrationOptions({
      rpName: this.config.mfaIssuer,
      rpID: this.rpId,
      userName: user.email,
      userDisplayName: user.name,
      userID: new TextEncoder().encode(user.id),
      attestationType: 'none',
      excludeCredentials: existing.map((c) => ({ id: c.credential_id, transports: safeTransports(c.transports) })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      timeout: CHALLENGE_TTL_MS,
    });
    return { challengeId: this.saveChallenge('register', user.id, options.challenge), options };
  }

  async register(userId: string, challengeId: string, name: string | undefined, response: RegistrationResponseJSON, meta: { ip: string; userAgent?: string }): Promise<PasskeyInfo> {
    const ch = this.takeChallenge('register', challengeId);
    if (!ch || ch.userId !== userId) throw badRequest('פג תוקף הבקשה. נסו להוסיף את מפתח הגישה שוב.');
    let info: Awaited<ReturnType<typeof verifyRegistrationResponse>>['registrationInfo'];
    try {
      const res = await verifyRegistrationResponse({ response, expectedChallenge: ch.challenge, expectedOrigin: this.origins, expectedRPID: this.rpId, requireUserVerification: true });
      if (res.verified) info = res.registrationInfo;
    } catch {
      info = undefined;
    }
    if (!info) {
      this.audit.log('passkey_add_failed', { userId, ip: meta.ip, meta: { reason: 'verification' } });
      throw badRequest('לא ניתן היה לאמת את מפתח הגישה. נסו שוב.');
    }
    const count = (this.db.prepare('SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?').get(userId) as { n: number }).n;
    if (count >= MAX_PASSKEYS_PER_USER) throw badRequest(`אפשר לשמור עד ${MAX_PASSKEYS_PER_USER} מפתחות גישה.`);
    if (this.db.prepare('SELECT 1 FROM passkeys WHERE credential_id = ?').get(info.credential.id)) throw badRequest('מפתח הגישה הזה כבר רשום');
    const id = randomUUID();
    const label = (name?.trim() || describeUserAgent(meta.userAgent ?? null)).slice(0, 60);
    this.db
      .prepare('INSERT INTO passkeys (id, user_id, credential_id, public_key, counter, transports, backed_up, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        id,
        userId,
        info.credential.id,
        Buffer.from(info.credential.publicKey),
        info.credential.counter,
        JSON.stringify((response.response.transports ?? []).filter((t) => typeof t === 'string').slice(0, 8)),
        info.credentialBackedUp ? 1 : 0,
        label,
        nowIso(),
      );
    this.audit.log('passkey_added', { userId, ip: meta.ip, meta: { passkeyId: id, synced: info.credentialBackedUp } });
    return this.list(userId).find((p) => p.id === id)!;
  }

  remove(userId: string, passkeyId: string, ip: string): void {
    const res = this.db.prepare('DELETE FROM passkeys WHERE id = ? AND user_id = ?').run(passkeyId, userId);
    if (!res.changes) throw notFound('מפתח הגישה לא נמצא');
    this.audit.log('passkey_removed', { userId, ip, meta: { passkeyId } });
  }

  /** Admin action after a lost device or a suspected compromise. Returns how many were removed. */
  removeAllOf(userId: string): number {
    return this.db.prepare('DELETE FROM passkeys WHERE user_id = ?').run(userId).changes;
  }

  // ------------------------------------------------------------------ sign-in (public)

  /** No account is named: the device offers its own passkeys for this site, so nothing can be enumerated. */
  async loginOptions(): Promise<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }> {
    if (!this.loginAvailable) throw new AppError(403, 'USE_SSO', 'כניסה עם מפתח גישה אינה זמינה');
    const options = await generateAuthenticationOptions({ rpID: this.rpId, userVerification: 'required', timeout: CHALLENGE_TTL_MS });
    return { challengeId: this.saveChallenge('login', null, options.challenge), options };
  }

  /** Verifies the assertion and returns the id of the user it belongs to. */
  async verifyLogin(challengeId: string, response: AuthenticationResponseJSON, ip: string): Promise<string> {
    const fail = (reason: string, userId?: string): never => {
      this.audit.log('login_failed', { userId, ip, meta: { reason, method: 'passkey' } });
      throw new AppError(401, 'INVALID_CREDENTIALS', LOGIN_FAILED);
    };
    const ch = this.takeChallenge('login', challengeId);
    if (!ch) return fail('challenge');
    const row = this.db.prepare('SELECT * FROM passkeys WHERE credential_id = ?').get(String(response.id)) as PasskeyRow | undefined;
    if (!row) return fail('unknown_passkey');
    let newCounter: number | null = null;
    let backedUp = row.backed_up === 1;
    try {
      const res = await verifyAuthenticationResponse({
        response,
        expectedChallenge: ch.challenge,
        expectedOrigin: this.origins,
        expectedRPID: this.rpId,
        requireUserVerification: true,
        credential: { id: row.credential_id, publicKey: new Uint8Array(row.public_key), counter: row.counter, transports: safeTransports(row.transports) },
      });
      if (res.verified) {
        newCounter = res.authenticationInfo.newCounter;
        backedUp = res.authenticationInfo.credentialBackedUp;
      }
    } catch {
      newCounter = null; // bad signature, wrong origin, or a signature counter that went backwards (possible clone)
    }
    if (newCounter === null) return fail('verification', row.user_id);
    this.db.prepare('UPDATE passkeys SET counter = ?, backed_up = ?, last_used_at = ? WHERE id = ?').run(newCounter, backedUp ? 1 : 0, nowIso(), row.id);
    return row.user_id;
  }
}
