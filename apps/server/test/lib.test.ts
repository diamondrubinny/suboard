import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ClamdScanner } from '../src/lib/clamav.js';
import { contentDisposition, detectType, extensionMatches, sanitizeFilename } from '../src/lib/filetype.js';
import { open, seal } from '../src/lib/secretbox.js';
import { base32Decode, base32Encode, hotp, totp, verifyTotp } from '../src/lib/totp.js';
import { csvField } from '../src/services/export.js';
import { files, startFakeClamd, TEST_MALWARE_MARKER } from './fakes.js';

describe('TOTP (RFC 6238 / 4226)', () => {
  // RFC 6238 Appendix B (SHA-1 secret "12345678901234567890"), truncated to 6 digits.
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  it('matches the RFC test vectors', () => {
    expect(totp(secret, 59_000)).toBe('287082');
    expect(totp(secret, 1111111109_000)).toBe('081804');
    expect(totp(secret, 2000000000_000)).toBe('279037');
    expect(hotp(Buffer.from('12345678901234567890'), 0)).toBe('755224'); // RFC 4226
  });

  it('round-trips base32', () => {
    const buf = randomBytes(20);
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
  });

  it('accepts ±1 step of drift and rejects replays', () => {
    const now = 1_800_000_000_000;
    const code = totp(secret, now - 30_000);
    const step = verifyTotp(secret, code, null, now);
    expect(step).not.toBeNull();
    expect(verifyTotp(secret, code, step, now)).toBeNull(); // replay
    expect(verifyTotp(secret, totp(secret, now - 90_000), null, now)).toBeNull(); // too old
    expect(verifyTotp(secret, 'abcdef', null, now)).toBeNull();
  });
});

describe('secretbox (AES-256-GCM)', () => {
  const key = randomBytes(32);
  it('round-trips and detects tampering / wrong binding', () => {
    const sealed = seal(key, 'JBSWY3DPEHPK3PXP', 'user-1');
    expect(open(key, sealed, 'user-1')).toBe('JBSWY3DPEHPK3PXP');
    expect(() => open(key, sealed, 'user-2')).toThrow();
    expect(() => open(randomBytes(32), sealed, 'user-1')).toThrow();
    const parts = sealed.split('.');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => open(key, parts.join('.'), 'user-1')).toThrow();
  });
});

describe('file type detection', () => {
  it('detects by content and requires a matching extension', () => {
    expect(detectType(files.png)?.ext).toBe('png');
    expect(detectType(files.pdf)?.ext).toBe('pdf');
    expect(detectType(files.exe)).toBeNull();
    expect(detectType(files.html)).toBeNull();
    expect(extensionMatches(detectType(files.pdf)!, 'report.PDF')).toBe(true);
    expect(extensionMatches(detectType(files.pdf)!, 'report.png')).toBe(false);
  });

  it('rejects macro-enabled OOXML', () => {
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('[Content_Types].xml word/document.xml word/vbaProject.bin')]);
    expect(detectType(zip)).toBeNull();
    const docx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('[Content_Types].xml word/document.xml')]);
    expect(detectType(docx)?.ext).toBe('docx');
  });

  it('sanitizes names and encodes Content-Disposition safely', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('a\r\nb".pdf')).toBe('a__b_.pdf');
    const cd = contentDisposition('דוח "בדיקה".pdf');
    expect(cd).not.toMatch(/[\r\n]/);
    expect(cd).toContain("filename*=UTF-8''");
  });
});

describe('CSV injection protection', () => {
  it('neutralises formulas and quotes properly', () => {
    expect(csvField('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvField('+1')).toBe("'+1");
    expect(csvField('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('שלום')).toBe('שלום');
  });
});

describe('clamd client', () => {
  it('reports clean and infected results over INSTREAM (multi-chunk)', async () => {
    const clamd = await startFakeClamd();
    const scanner = new ClamdScanner({ host: '127.0.0.1', port: clamd.port, timeoutMs: 5000 });
    expect(await scanner.scan(randomBytes(200_000))).toEqual({ status: 'clean' });
    expect(await scanner.scan(Buffer.from(`xx ${TEST_MALWARE_MARKER} yy`))).toEqual({ status: 'infected', signature: 'Test.Marker' });
    expect(clamd.scans[0]).toBe(200_000);
    clamd.server.close();
  });

  it('fails (throws) when the daemon is unreachable', async () => {
    const scanner = new ClamdScanner({ host: '127.0.0.1', port: 1, timeoutMs: 2000 });
    await expect(scanner.scan(Buffer.from('x'))).rejects.toThrow();
  });
});
