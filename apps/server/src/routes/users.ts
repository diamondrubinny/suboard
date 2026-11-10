import { createUserSchema, idSchema, updateUserSchema } from '@suboard/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { forbidden } from '../lib/errors.js';
import { actorOf } from '../plugins/auth.js';
import type { Services } from '../services/index.js';

function requireAdmin(req: FastifyRequest) {
  const actor = actorOf(req);
  if (actor.role !== 'admin') throw forbidden();
  return actor;
}

export async function userRoutes(app: FastifyInstance, { services }: { services: Services }) {
  app.get('/users/directory', async () => ({ users: services.users.directory() }));

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

  app.get('/admin/audit', async (req) => {
    requireAdmin(req);
    const q = req.query as { event?: string; before?: string };
    const event = typeof q.event === 'string' && /^[a-z_]{1,40}$/.test(q.event) ? q.event : undefined;
    const before = typeof q.before === 'string' && !Number.isNaN(Date.parse(q.before)) ? q.before : undefined;
    return { entries: services.audit.list({ event, before, limit: 100 }) };
  });
}
