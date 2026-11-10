import { changePasswordSchema, loginSchema, mfaDisableSchema, mfaEnableSchema, mfaVerifySchema, preferencesSchema } from '@suboard/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppConfig } from '../config.js';
import { actorOf, clearSessionCookie, setSessionCookie } from '../plugins/auth.js';
import type { LoginResult } from '../services/auth.js';
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

  app.patch('/auth/preferences', async (req) => {
    const input = preferencesSchema.parse(req.body);
    const actor = actorOf(req);
    services.auth.setPreferences(actor.id, input);
    return { user: services.auth.getSessionUser(actor.id) };
  });
}
