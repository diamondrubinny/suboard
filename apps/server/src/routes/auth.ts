import { changePasswordSchema, loginSchema, mfaDisableSchema, mfaEnableSchema, mfaVerifySchema, preferencesSchema } from '@suboard/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppConfig } from '../config.js';
import { actorOf, clearSessionCookie, setSessionCookie } from '../plugins/auth.js';
import type { LoginResult } from '../services/auth.js';
import { safeNext, SsoError } from '../services/sso.js';
import { notFound } from '../lib/errors.js';

const escapeAttr = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
import type { Services } from '../services/index.js';

export async function authRoutes(app: FastifyInstance, { services, config }: { services: Services; config: AppConfig }) {
  const respond = (reply: FastifyReply, result: LoginResult) => {
    if (result.kind === 'mfa') return { mfaRequired: true, challengeToken: result.challengeToken };
    setSessionCookie(reply, result.token, config);
    return { user: result.user };
  };
  const loginLimit = { max: config.loginMaxPerWindow, timeWindow: config.loginWindowMs };

  app.post('/auth/login', { config: { public: true, rateLimit: loginLimit } }, async (req, reply) => {
    const input = loginSchema.parse(req.body);
    return respond(reply, await services.auth.login(input.email, input.password, { ip: req.ip, userAgent: req.headers['user-agent'] }));
  });

  // ---- SSO (OpenID Connect)
  const SSO_COOKIE = 'sb_sso';
  const ssoCookieOpts = { httpOnly: true, secure: config.cookieSecure, sameSite: 'lax' as const, path: `${config.basePath}/api/auth/sso` };
  /** Same-origin hop page: the next navigation starts on our site, so the SameSite=Strict session cookie is sent. */
  const hop = (reply: FastifyReply, to: string) =>
    reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .header('Cache-Control', 'no-store')
      .header('Referrer-Policy', 'no-referrer')
      .send(`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${escapeAttr(to)}"><title>מעביר…</title></head><body><p><a href="${escapeAttr(to)}">המשך</a></p></body></html>`);

  app.get('/auth/sso/config', { config: { public: true } }, async () => services.sso.publicConfig());

  app.get('/auth/sso/start', { config: { public: true, rateLimit: loginLimit } }, async (req, reply) => {
    if (!services.sso.enabled) return hop(reply, `${config.basePath}/login?sso_error=unavailable`);
    try {
      const { url, cookie } = await services.sso.start((req.query as { next?: string }).next);
      reply.setCookie(SSO_COOKIE, cookie, { ...ssoCookieOpts, maxAge: 600 });
      return reply.redirect(url, 302);
    } catch (err) {
      return hop(reply, `${config.basePath}/login?sso_error=${err instanceof SsoError ? err.code : 'unavailable'}`);
    }
  });

  app.get('/auth/sso/callback', { config: { public: true, rateLimit: loginLimit } }, async (req, reply) => {
    const cookie = req.cookies[SSO_COOKIE];
    reply.clearCookie(SSO_COOKIE, ssoCookieOpts);
    const q = req.query as { error?: string };
    if (q.error) {
      services.audit.log('sso_login_failed', { ip: req.ip, meta: { reason: 'idp_error', detail: String(q.error).slice(0, 60) } });
      return hop(reply, `${config.basePath}/login?sso_error=exchange`);
    }
    try {
      // The redirect URI is built from PUBLIC_URL, never from the request's Host header.
      const callbackUrl = new URL(config.publicUrl + req.url); // req.url is relative to the app's folder
      const { result, next } = await services.sso.callback(cookie, callbackUrl, { ip: req.ip, userAgent: req.headers['user-agent'] });
      if (result.kind === 'mfa') return hop(reply, `${config.basePath}/login?next=${encodeURIComponent(next)}#mfa=${encodeURIComponent(result.challengeToken)}`);
      setSessionCookie(reply, result.token, config);
      return hop(reply, config.basePath + safeNext(next));
    } catch (err) {
      if (!(err instanceof SsoError)) req.log.error({ err }, 'SSO callback failed');
      return hop(reply, `${config.basePath}/login?sso_error=${err instanceof SsoError ? err.code : 'exchange'}`);
    }
  });

  app.post('/auth/mfa/verify', { config: { public: true, rateLimit: loginLimit } }, async (req, reply) => {
    const input = mfaVerifySchema.parse(req.body);
    return respond(reply, await services.auth.completeMfaLogin(input.challengeToken, input.code, { ip: req.ip, userAgent: req.headers['user-agent'] }));
  });

  app.post('/auth/logout', { config: { allowPendingPasswordChange: true } }, async (req, reply) => {
    services.auth.logout(req.sessionId!, req.user!.id, req.ip);
    clearSessionCookie(reply, config);
    return { ok: true };
  });

  app.get('/auth/me', { config: { allowPendingPasswordChange: true } }, async (req) => ({
    user: req.user,
    recoveryCodesLeft: req.user?.mfaEnabled ? services.mfa.remainingRecoveryCodes(req.user.id) : null,
    emailAvailable: services.notifications.emailEnabled,
  }));

  app.post(
    '/auth/change-password',
    { config: { allowPendingPasswordChange: true, rateLimit: { max: 10, timeWindow: 15 * 60_000 } } },
    async (req) => {
      const input = changePasswordSchema.parse(req.body);
      const actor = actorOf(req);
      await services.auth.changePassword(actor.id, req.sessionId!, input.currentPassword, input.newPassword, req.ip);
      return { ok: true };
    },
  );

  // ---- MFA enrolment (reachable while enrolment is still required)
  const mfaLimit = { max: 10, timeWindow: 15 * 60_000 };
  app.post('/auth/mfa/setup', { config: { allowPendingPasswordChange: true, rateLimit: mfaLimit } }, async (req) => services.mfa.setup(actorOf(req).id));

  app.post('/auth/mfa/enable', { config: { allowPendingPasswordChange: true, rateLimit: mfaLimit } }, async (req) => {
    const { code } = mfaEnableSchema.parse(req.body);
    const actor = actorOf(req);
    const recoveryCodes = services.mfa.enable(actor.id, code, req.ip);
    services.auth.revokeOtherSessions(actor.id, req.sessionId!);
    return { recoveryCodes, user: services.auth.getSessionUser(actor.id) };
  });

  app.post('/auth/mfa/disable', { config: { rateLimit: mfaLimit } }, async (req) => {
    const input = mfaDisableSchema.parse(req.body);
    const actor = actorOf(req);
    await services.mfa.disable(actor.id, input.password, input.code, req.ip);
    return { user: services.auth.getSessionUser(actor.id) };
  });

  // ---- active sessions (own devices)
  app.get('/auth/sessions', async (req) => ({ sessions: services.auth.listSessions(actorOf(req).id, req.sessionId!) }));

  app.post('/auth/sessions/revoke-others', { config: { rateLimit: { max: 20, timeWindow: 15 * 60_000 } } }, async (req) => {
    const actor = actorOf(req);
    services.auth.revokeOtherSessions(actor.id, req.sessionId!);
    services.audit.log('sessions_revoked_others', { userId: actor.id, ip: req.ip });
    return { sessions: services.auth.listSessions(actor.id, req.sessionId!) };
  });

  app.delete('/auth/sessions/:handle', { config: { rateLimit: { max: 30, timeWindow: 15 * 60_000 } } }, async (req, reply) => {
    const actor = actorOf(req);
    const handle = String((req.params as { handle: string }).handle);
    if (!/^[0-9a-f]{32}$/.test(handle)) throw notFound('החיבור לא נמצא');
    const current = services.auth.isCurrentHandle(req.sessionId!, handle);
    if (!services.auth.revokeSession(actor.id, handle, req.ip)) throw notFound('החיבור לא נמצא');
    if (current) clearSessionCookie(reply, config);
    return { ok: true, signedOut: current };
  });

  app.patch('/auth/preferences', async (req) => {
    const input = preferencesSchema.parse(req.body);
    const actor = actorOf(req);
    services.auth.setPreferences(actor.id, input);
    return { user: services.auth.getSessionUser(actor.id) };
  });
}
