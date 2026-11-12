import { lookup as dnsLookup } from 'node:dns';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';

/**
 * Outbound HTTP for user-supplied addresses (webhooks). Defends against server-side request forgery:
 * - https only, port 443 only, no credentials in the URL
 * - the host is resolved once and EVERY resolved address must be public; the connection is made to
 *   that same resolved address (no second lookup an attacker could answer differently)
 * - redirects are not followed, the response body is not read, and there is a hard timeout
 *
 * `allowInsecureTargets` (never in production) lifts the https / port / private-address rules so the
 * delivery code can be tested against a local server.
 */
export class UnsafeTargetError extends Error {}

/** Addresses that must never be reached from the server on behalf of a user. */
export function isPublicAddress(address: string): boolean {
  const v = isIP(address);
  if (v === 4) {
    const p = address.split('.').map(Number) as [number, number, number, number];
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return false;
    if (p[0] === 169 && p[1] === 254) return false; // link-local, cloud metadata
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return false;
    if (p[0] === 192 && p[1] === 168) return false;
    if (p[0] === 192 && p[1] === 0 && p[2] === 0) return false;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return false; // carrier-grade NAT
    if (p[0] === 198 && (p[1] === 18 || p[1] === 19)) return false;
    if (p[0] >= 224) return false; // multicast, reserved, broadcast
    return true;
  }
  if (v === 6) {
    const a = address.toLowerCase();
    if (a === '::' || a === '::1') return false;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
    if (mapped) return isPublicAddress(mapped[1]!);
    if (a.startsWith('::ffff:')) return false; // hex form of a mapped IPv4 address: refuse rather than parse
    if (/^f[cd]/.test(a)) return false; // unique local
    if (/^fe[89ab]/.test(a)) return false; // link-local
    if (a.startsWith('ff')) return false; // multicast
    if (a.startsWith('64:ff9b:') || a.startsWith('2001:db8:')) return false; // NAT64, documentation
    return true;
  }
  return false;
}

/** Shape rules for a webhook address. Returns the parsed URL or throws `UnsafeTargetError`. */
export function checkTargetUrl(raw: string, allowInsecureTargets = false): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeTargetError('כתובת לא תקינה');
  }
  if (url.username || url.password) throw new UnsafeTargetError('אין לכלול שם משתמש או סיסמה בכתובת');
  if (allowInsecureTargets) {
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new UnsafeTargetError('הכתובת חייבת להתחיל ב-https://');
    return url;
  }
  if (url.protocol !== 'https:') throw new UnsafeTargetError('הכתובת חייבת להתחיל ב-https://');
  if (url.port && url.port !== '443') throw new UnsafeTargetError('מותרת רק יציאת ברירת המחדל של HTTPS (443)');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && !isPublicAddress(host)) throw new UnsafeTargetError('כתובת פנימית אינה מותרת');
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) throw new UnsafeTargetError('כתובת פנימית אינה מותרת');
  return url;
}

export interface PostResult {
  ok: boolean;
  status: number | null;
  error: string | null;
}

/** POSTs a small JSON body. Never throws: failures come back as `{ ok: false, error }`. */
export function safePost(raw: string, body: string, headers: Record<string, string>, opts: { timeoutMs?: number; allowInsecureTargets?: boolean } = {}): Promise<PostResult> {
  const allow = opts.allowInsecureTargets === true;
  let url: URL;
  try {
    url = checkTargetUrl(raw, allow);
  } catch (e) {
    return Promise.resolve({ ok: false, status: null, error: e instanceof Error ? e.message : 'כתובת לא תקינה' });
  }
  // Every address the name resolves to is checked, and the socket connects to one of exactly those.
  const guardedLookup: LookupFunction = (hostname, options, callback) => {
    dnsLookup(hostname, { ...(typeof options === 'object' ? options : {}), all: true }, (err, addresses) => {
      if (err) return callback(err, '', 4);
      const list = addresses as unknown as { address: string; family: number }[];
      if (!list.length) return callback(new Error('no address'), '', 4);
      if (!allow && list.some((a) => !isPublicAddress(a.address))) return callback(new UnsafeTargetError('כתובת פנימית אינה מותרת'), '', 4);
      // net.connect calls lookup with `all: true` when it wants the list (Node 20+), otherwise one address.
      if (typeof options === 'object' && options.all) return (callback as unknown as (e: null, a: typeof list) => void)(null, list);
      return callback(null, list[0]!.address, list[0]!.family);
    });
  };
  return new Promise((resolve) => {
    const done = (r: PostResult) => resolve(r);
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      {
        method: 'POST',
        lookup: guardedLookup,
        timeout: opts.timeoutMs ?? 5000,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'User-Agent': 'SUBoard-Webhook/1', ...headers },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        res.resume(); // the body is never read or stored
        done({ ok: status >= 200 && status < 300, status, error: status >= 300 && status < 400 ? 'הכתובת מפנה לכתובת אחרת (הפניות אינן נתמכות)' : status >= 200 && status < 300 ? null : `השרת ענה ${status}` });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => done({ ok: false, status: null, error: e instanceof UnsafeTargetError ? e.message : e.message === 'timeout' ? 'אין תשובה (פסק זמן)' : 'החיבור נכשל' }));
    req.end(body);
  });
}
