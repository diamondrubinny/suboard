import { guestMayCall } from '@suboard/shared';
import type { SessionUser } from '@suboard/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { AppConfig } from '../config.js';
import { AppError, unauthorized } from '../lib/errors.js';
import type { Actor } from '../services/access.js';
import type { AuthService } from '../services/auth.js';
import type { ApiTokenService } from '../services/apiTokens.js';

export const SESSION_COOKIE = 'sb_session';

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
    sessionId: string | null;
    /** Set when the request is authenticated by a personal API token (no browser session). */
    tokenScope: 'read' | 'write' | null;
  }
  interface FastifyContextConfig {
    /** Route is reachable without a session. */
    public?: boolean;
    /** Route is reachable while the user still has to replace a temporary password or enrol MFA. */
    allowPendingPasswordChange?: boolean;
  }
}

/**
 * Resolves the session cookie on every /api request and enforces authentication
 * for every route that is not explicitly marked `config.public`.
 */
export const authPlugin = fp(async (app: FastifyInstance, opts: { auth: AuthService; config: AppConfig; tokens: ApiTokenService }) => {
  app.decorateRequest('user', null);
  app.decorateRequest('sessionId', null);
  app.decorateRequest('tokenScope', null);

  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    const resolved = opts.auth.resolveSession(req.cookies[SESSION_COOKIE]);
    if (resolved) {
      req.user = resolved.user;
      req.sessionId = resolved.sessionId;
      return;
    }
    // No browser session: a personal API token may stand for its owner.
    const viaToken = opts.tokens.resolve(req.headers.authorization);
    if (viaToken) {
      req.user = viaToken.user;
      req.tokenScope = viaToken.scope;
    }
  });

  app.addHook('preHandler', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    const cfg = req.routeOptions.config;
    if (cfg?.public) return;
    if (!req.user) throw unauthorized();
    if (req.tokenScope) {
      // A token is for the data API only: never account security, user administration or other tokens.
      const path = req.url.slice(4).split('?')[0]!;
      if (/^\/(auth|admin|users|scim)(\/|$)/.test(path) && path !== '/auth/me' && path !== '/users/directory') {
        throw new AppError(403, 'TOKEN_NOT_ALLOWED', 'הפעולה אינה זמינה עם אסימון API');
      }
      if (req.tokenScope === 'read' && !['GET', 'HEAD'].includes(req.method)) throw new AppError(403, 'TOKEN_READ_ONLY', 'האסימון מאפשר קריאה בלבד');
    }
    // Guests: default deny. Only the listed paths are open; each of them still checks board membership.
    if (req.user.guest && !guestMayCall(req.method, req.url.slice(4).split('?')[0]!)) {
      throw new AppError(403, 'GUEST_NOT_ALLOWED', 'הפעולה אינה זמינה לחשבון אורח');
    }
    if (req.user.mustChangePassword && !cfg?.allowPendingPasswordChange) {
      throw new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'יש להחליף את הסיסמה הזמנית לפני המשך עבודה');
    }
    if (req.user.mfaSetupRequired && !cfg?.allowPendingPasswordChange) {
      throw new AppError(403, 'MFA_SETUP_REQUIRED', 'יש להגדיר אימות דו-שלבי לפני המשך עבודה');
    }
  });
});

export function setSessionCookie(reply: FastifyReply, token: string, config: AppConfig): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'strict',
    // Scoped to the app's folder, so other sites on the same domain never receive it.
    path: config.basePath || '/',
    maxAge: Math.floor(config.sessionTtlMs / 1000),
  });
}

export function clearSessionCookie(reply: FastifyReply, config: AppConfig): void {
  reply.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: config.cookieSecure, sameSite: 'strict', path: config.basePath || '/' });
}

/** The authenticated actor for a request (routes are already guarded by the preHandler). */
export function actorOf(req: FastifyRequest): Actor {
  if (!req.user) throw unauthorized();
  return { id: req.user.id, name: req.user.name, role: req.user.role, ...(req.user.guest ? { guest: true } : {}) };
}
