import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM authenticated encryption for small secrets at rest (TOTP seeds).
 * Format: v1.<iv b64>.<tag b64>.<ciphertext b64>. Tampering makes decryption throw.
 */
export function seal(key: Buffer, plaintext: string, aad = 'suboard'): string {
  if (key.length !== 32) throw new Error('key must be 32 bytes');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join('.');
}

export function open(key: Buffer, sealed: string, aad = 'suboard'): string {
  const [v, ivB64, tagB64, ctB64] = sealed.split('.');
  if (v !== 'v1' || !ivB64 || !tagB64 || ctB64 === undefined) throw new Error('unsupported sealed format');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}
