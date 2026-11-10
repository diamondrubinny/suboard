import type { SessionUser } from '@suboard/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { AppConfig } from '../config.js';
import { AppError, unauthorized } from '../lib/errors.js';
import type { Actor } from '../services/access.js';
import type { AuthService } from '../services/auth.js';

export const SESSION_COOKIE = 'sb_session';

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
    sessionId: string | null;
  }
  interface FastifyContextConfig {
    /** Route is reachable without a session. */
    public?: boolean;
    /** Route is reachable while the user still has to replace a temporary password. */
    allowPendingPasswordChange?: boolean;
  }
}

/**
 * Resolves the session cookie on every /api request and enforces authentication
 * for every route that is not explicitly marked `config.public`.
 */
export const authPlugin = fp(async (app: FastifyInstance, opts: { auth: AuthService; config: AppConfig }) => {
  app.decorateRequest('user', null);
  app.decorateRequest('sessionId', null);

  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    const resolved = opts.auth.resolveSession(req.cookies[SESSION_COOKIE]);
    if (resolved) {
      req.user = resolved.user;
      req.sessionId = resolved.sessionId;
    }
  });

  app.addHook('preHandler', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    const cfg = req.routeOptions.config;
    if (cfg?.public) return;
    if (!req.user) throw unauthorized();
    if (req.user.mustChangePassword && !cfg?.allowPendingPasswordChange) {
      throw new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'יש להחליף את הסיסמה הזמנית לפני המשך עבודה');
    }
  });
});

export function setSessionCookie(reply: FastifyReply, token: string, config: AppConfig): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'strict',
    path: '/',
    maxAge: Math.floor(config.sessionTtlMs / 1000),
  });
}

export function clearSessionCookie(reply: FastifyReply, config: AppConfig): void {
  reply.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: config.cookieSecure, sameSite: 'strict', path: '/' });
}

/** The authenticated actor for a request (routes are already guarded by the preHandler). */
export function actorOf(req: FastifyRequest): Actor {
  if (!req.user) throw unauthorized();
  return { id: req.user.id, name: req.user.name, role: req.user.role };
}
