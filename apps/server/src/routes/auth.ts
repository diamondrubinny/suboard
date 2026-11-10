import { changePasswordSchema, loginSchema } from '@suboard/shared';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import { actorOf, clearSessionCookie, setSessionCookie } from '../plugins/auth.js';
import type { Services } from '../services/index.js';

export async function authRoutes(app: FastifyInstance, { services, config }: { services: Services; config: AppConfig }) {
  app.post(
    '/auth/login',
    {
      config: {
        public: true,
        rateLimit: { max: config.loginMaxPerWindow, timeWindow: config.loginWindowMs },
      },
    },
    async (req, reply) => {
      const input = loginSchema.parse(req.body);
      const { token, user } = await services.auth.login(input.email, input.password, {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
      setSessionCookie(reply, token, config);
      return { user };
    },
  );

  app.post('/auth/logout', { config: { allowPendingPasswordChange: true } }, async (req, reply) => {
    services.auth.logout(req.sessionId!, req.user!.id, req.ip);
    clearSessionCookie(reply, config);
    return { ok: true };
  });

  app.get('/auth/me', { config: { allowPendingPasswordChange: true } }, async (req) => ({ user: req.user }));

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
}
