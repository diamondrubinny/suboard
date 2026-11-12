import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../lib/errors.js';

export const CSRF_HEADER = 'x-requested-with';
export const CSRF_HEADER_VALUE = 'suboard';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defense in depth (on top of SameSite=Strict session cookies):
 * 1. State-changing requests must carry a custom header. Browsers cannot attach it
 *    cross-origin without a CORS preflight, and this API never answers CORS preflights.
 * 2. When the browser sends an Origin header, it must be in the allow-list.
 */
export const csrfPlugin = fp(async (app: FastifyInstance, opts: { allowedOrigins: string[] }) => {
  const allowed = new Set(opts.allowedOrigins);
  app.addHook('onRequest', async (req) => {
    if (SAFE.has(req.method) || !req.url.startsWith('/api/')) return;
    // A request that carries a bearer token and no session cookie has no ambient credentials a
    // foreign page could ride on, so the browser-oriented checks do not apply to it.
    if (/^Bearer sbp_/.test(req.headers.authorization ?? '') && !req.cookies?.sb_session) return;
    if (req.headers[CSRF_HEADER] !== CSRF_HEADER_VALUE) {
      throw new AppError(403, 'CSRF', 'הבקשה נחסמה (בדיקת אבטחה)');
    }
    const origin = req.headers.origin;
    if (origin && !allowed.has(origin)) {
      throw new AppError(403, 'CSRF', 'הבקשה נחסמה (מקור לא מורשה)');
    }
    if (!origin && req.headers['sec-fetch-site'] === 'cross-site') {
      throw new AppError(403, 'CSRF', 'הבקשה נחסמה (מקור לא מורשה)');
    }
  });
});
