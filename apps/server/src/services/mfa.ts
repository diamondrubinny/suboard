import type { MfaSetup } from '@suboard/shared';
import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import type { AppConfig } from '../config.js';
import { nowIso, type DB } from '../db/index.js';
import { newId, newSessionToken, sha256, verifyPassword } from '../lib/crypto.js';
import { AppError, badRequest } from '../lib/errors.js';
import { open, seal } from '../lib/secretbox.js';
import { generateTotpSecret, otpauthUri, verifyTotp } from '../lib/totp.js';
import type { AuditService } from './audit.js';

const CHALLENGE_TTL_MS = 5 * 60_000;
const CHALLENGE_MAX_ATTEMPTS = 5;
const RECOVERY_CODES = 10;
const INVALID_CODE = 'הקוד שגוי או שפג תוקפו';

interface MfaRow {
  id: string;
  email: string;
  password_hash: string;
  mfa_secret_enc: string | null;
  mfa_enabled: number;
  mfa_last_step: number | null;
}

/** Recovery code: 10 chars from an unambiguous alphabet, shown as xxxxx-xxxxx (~50 bits). */
function newRecoveryCode(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(10);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

export class MfaService {
  constructor(
    private readonly db: DB,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
  ) {}

  private row(userId: string): MfaRow {
    const r = this.db.prepare('SELECT id, email, password_hash, mfa_secret_enc, mfa_enabled, mfa_last_step FROM users WHERE id = ?').get(userId) as
      | MfaRow
      | undefined;
    if (!r) throw new AppError(404, 'NOT_FOUND', 'המשתמש לא נמצא');
    return r;
  }

  /** Starts enrolment: stores a new (not yet active) encrypted secret and returns it with a QR code. */
  async setup(userId: string): Promise<MfaSetup> {
    const r = this.row(userId);
    if (r.mfa_enabled) throw badRequest('אימות דו-שלבי כבר פעיל בחשבון');
    const secret = generateTotpSecret();
    this.db.prepare('UPDATE users SET mfa_secret_enc = ?, mfa_last_step = NULL WHERE id = ?').run(seal(this.config.mfaKey, secret, r.id), r.id);
    const uri = otpauthUri(this.config.mfaIssuer, r.email, secret);
    const qrSvg = await QRCode.toString(uri, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 });
    return { secret, otpauthUri: uri, qrSvg };
  }

  /** Confirms enrolment with a first valid code; returns one-time recovery codes. */
  enable(userId: string, code: string, ip: string): string[] {
    const r = this.row(userId);
    if (r.mfa_enabled) throw badRequest('אימות דו-שלבי כבר פעיל בחשבון');
    if (!r.mfa_secret_enc) throw badRequest('יש להתחיל את תהליך ההגדרה מחדש');
    const step = verifyTotp(open(this.config.mfaKey, r.mfa_secret_enc, r.id), code, null);
    if (step === null) throw badRequest(INVALID_CODE, { code: INVALID_CODE });

    const codes = Array.from({ length: RECOVERY_CODES }, newRecoveryCode);
    this.db.transaction(() => {
      this.db.prepare('UPDATE users SET mfa_enabled = 1, mfa_last_step = ?, updated_at = ? WHERE id = ?').run(step, nowIso(), userId);
      this.db.prepare('DELETE FROM mfa_recovery_codes WHERE user_id = ?').run(userId);
      const ins = this.db.prepare('INSERT INTO mfa_recovery_codes (id, user_id, code_hash) VALUES (?, ?, ?)');
      for (const c of codes) ins.run(newId(), userId, sha256(c));
    })();
    this.audit.log('mfa_enabled', { userId, ip });
    return codes;
  }

  /**
   * Verifies a TOTP code (with replay protection) or consumes a recovery code.
   * Returns true on success; never throws for a wrong code.
   */
  verifyCode(userId: string, code: string): boolean {
    const r = this.row(userId);
    if (!r.mfa_enabled || !r.mfa_secret_enc) return false;
    if (/^\d{6}$/.test(code)) {
      const step = verifyTotp(open(this.config.mfaKey, r.mfa_secret_enc, r.id), code, r.mfa_last_step);
      if (step === null) return false;
      this.db.prepare('UPDATE users SET mfa_last_step = ? WHERE id = ?').run(step, userId);
      return true;
    }
    const used = this.db
      .prepare('UPDATE mfa_recovery_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL')
      .run(nowIso(), userId, sha256(code));
    if (used.changes === 1) {
      this.audit.log('mfa_recovery_code_used', { userId });
      return true;
    }
    return false;
  }

  remainingRecoveryCodes(userId: string): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM mfa_recovery_codes WHERE user_id = ? AND used_at IS NULL').get(userId) as { n: number }).n;
  }

  async disable(userId: string, password: string, code: string, ip: string): Promise<void> {
    const r = this.row(userId);
    if (!r.mfa_enabled) throw badRequest('אימות דו-שלבי אינו פעיל');
    const passwordOk = await verifyPassword(password, r.password_hash);
    if (!passwordOk || !this.verifyCode(userId, code)) {
      this.audit.log('mfa_disable_failed', { userId, ip });
      throw badRequest('הסיסמה או הקוד שגויים');
    }
    this.clear(userId);
    this.audit.log('mfa_disabled', { userId, ip });
  }

  /** Admin reset (lost device). The caller is responsible for revoking sessions. */
  clear(userId: string): void {
    this.db.transaction(() => {
      this.db.prepare('UPDATE users SET mfa_enabled = 0, mfa_secret_enc = NULL, mfa_last_step = NULL, updated_at = ? WHERE id = ?').run(nowIso(), userId);
      this.db.prepare('DELETE FROM mfa_recovery_codes WHERE user_id = ?').run(userId);
      this.db.prepare('DELETE FROM mfa_challenges WHERE user_id = ?').run(userId);
    })();
  }

  // ---------------------------------------------------------------- login challenge
  createChallenge(userId: string): string {
    const token = newSessionToken();
    this.db.prepare('DELETE FROM mfa_challenges WHERE user_id = ? OR expires_at < ?').run(userId, nowIso());
    this.db
      .prepare('INSERT INTO mfa_challenges (id, user_id, expires_at, attempts) VALUES (?, ?, ?, 0)')
      .run(sha256(token), userId, new Date(Date.now() + CHALLENGE_TTL_MS).toISOString());
    return token;
  }

  /** Returns the user id when the challenge + code are valid; the challenge is single-use. */
  completeChallenge(token: string, code: string, ip: string): string {
    const id = sha256(token);
    const ch = this.db.prepare('SELECT user_id, expires_at, attempts FROM mfa_challenges WHERE id = ?').get(id) as
      | { user_id: string; expires_at: string; attempts: number }
      | undefined;
    const expired = new AppError(401, 'MFA_CHALLENGE_EXPIRED', 'פג תוקף ההתחברות. יש להזין שוב דוא"ל וסיסמה.');
    if (!ch) throw expired;
    if (Date.parse(ch.expires_at) <= Date.now() || ch.attempts >= CHALLENGE_MAX_ATTEMPTS) {
      this.db.prepare('DELETE FROM mfa_challenges WHERE id = ?').run(id);
      throw expired;
    }
    if (!this.verifyCode(ch.user_id, code)) {
      this.db.prepare('UPDATE mfa_challenges SET attempts = attempts + 1 WHERE id = ?').run(id);
      this.audit.log('mfa_failed', { userId: ch.user_id, ip });
      throw new AppError(401, 'MFA_INVALID', INVALID_CODE);
    }
    this.db.prepare('DELETE FROM mfa_challenges WHERE id = ?').run(id);
    return ch.user_id;
  }
}
