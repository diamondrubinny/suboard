import { createUserSchema, idSchema, setModulesSchema, updateUserSchema } from '@suboard/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { forbidden, notFound } from '../lib/errors.js';
import { actorOf } from '../plugins/auth.js';
import type { Services } from '../services/index.js';
import { APP_VERSION } from '../version.js';

function requireAdmin(req: FastifyRequest) {
  const actor = actorOf(req);
  if (actor.role !== 'admin') throw forbidden();
  return actor;
}

export async function userRoutes(app: FastifyInstance, { services }: { services: Services }) {
  app.get('/users/directory', async (req) => ({ users: services.users.directory(actorOf(req)) }));

  app.get('/users', async (req) => {
    requireAdmin(req);
    return { users: services.users.list() };
  });

  app.post('/users', async (req, reply) => {
    const actor = requireAdmin(req);
    const input = createUserSchema.parse(req.body);
    const user = await services.users.create(actor, input);
    return reply.code(201).send({ user });
  });

  app.patch('/users/:id', async (req) => {
    const actor = requireAdmin(req);
    const id = idSchema.parse((req.params as { id: string }).id);
    const input = updateUserSchema.parse(req.body);
    return { user: await services.users.update(actor, id, input) };
  });

  /** Signs a user out everywhere (lost device, suspected compromise). An admin keeps their own current session. */
  app.post('/users/:id/revoke-sessions', { config: { rateLimit: { max: 30, timeWindow: 15 * 60_000 } } }, async (req) => {
    const actor = requireAdmin(req);
    const id = idSchema.parse((req.params as { id: string }).id);
    if (!services.users.exists(id)) throw notFound('המשתמש לא נמצא');
    if (id === actor.id) services.auth.revokeOtherSessions(id, req.sessionId!);
    else services.auth.revokeAllSessions(id);
    // A lost or stolen device may hold a passkey: for another user, those go too (they can add new ones).
    const passkeysRemoved = id === actor.id ? 0 : services.passkeys.removeAllOf(id);
    const tokensRevoked = id === actor.id ? 0 : services.apiTokens.revokeAllOf(id);
    services.audit.log('sessions_revoked_by_admin', { userId: actor.id, ip: req.ip, meta: { targetUserId: id, passkeysRemoved, tokensRevoked } });
    return { ok: true, passkeysRemoved, tokensRevoked };
  });

  // ---- optional modules: every signed-in user reads the state (to build the menu); admins change it
  app.get('/modules', async () => ({ modules: services.modules.state() }));
  // What is running: for administrators only (the public health check says nothing about versions).
  app.get('/admin/system', async (req) => {
    requireAdmin(req);
    return { version: APP_VERSION, schema: services.modules.schemaVersion(), node: process.version };
  });
  app.put('/admin/modules', { config: { rateLimit: { max: 30, timeWindow: 15 * 60_000 } } }, async (req) => {
    const actor = requireAdmin(req);
    return { modules: services.modules.set(actor, setModulesSchema.parse(req.body).modules, req.ip) };
  });

  app.get('/admin/audit', async (req) => {
    requireAdmin(req);
    const q = req.query as { event?: string; before?: string };
    const event = typeof q.event === 'string' && /^[a-z_]{1,40}$/.test(q.event) ? q.event : undefined;
    const before = typeof q.before === 'string' && !Number.isNaN(Date.parse(q.before)) ? q.before : undefined;
    return { entries: services.audit.list({ event, before, limit: 100 }) };
  });
}
