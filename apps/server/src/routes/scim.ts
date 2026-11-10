import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ScimError, type ScimService } from '../services/scim.js';

const listQuery = z.object({
  filter: z.string().max(400).optional(),
  startIndex: z.coerce.number().int().min(1).default(1),
  count: z.coerce.number().int().min(0).max(200).default(100),
});

/**
 * SCIM 2.0 endpoints at /scim/v2 — outside /api: no cookies, no CSRF, bearer token only.
 * Errors use the SCIM error schema; responses are application/scim+json.
 */
export async function scimRoutes(app: FastifyInstance, { scim }: { scim: ScimService }) {
  for (const type of ['application/scim+json', 'application/json']) {
    app.removeContentTypeParser(type);
    app.addContentTypeParser(type, { parseAs: 'string', bodyLimit: 64 * 1024 }, (_req, body, done) => {
      try {
        done(null, body ? JSON.parse(body as string) : {});
      } catch {
        done(new ScimError(400, 'Invalid JSON', 'invalidSyntax'), undefined);
      }
    });
  }
  app.addHook('onRequest', async (req) => scim.authorize(req.headers.authorization, req.ip));
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('Content-Type', 'application/scim+json; charset=utf-8').header('Cache-Control', 'no-store');
    return payload;
  });
  app.setErrorHandler((err, req, reply: FastifyReply) => {
    if (err instanceof ScimError) return reply.code(err.status).send(err.body());
    if (err instanceof z.ZodError) return reply.code(400).send(new ScimError(400, 'Invalid query', 'invalidValue').body());
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) return reply.code(429).send(new ScimError(429, 'Too many requests').body());
    req.log.error({ err }, 'SCIM error');
    return reply.code(500).send(new ScimError(500, 'Internal error').body());
  });
  const limit = { config: { rateLimit: { max: 600, timeWindow: 60_000 } } };
  const id = (req: FastifyRequest) => (req.params as { id: string }).id;

  app.get('/ServiceProviderConfig', limit, async () => scim.serviceProviderConfig());
  app.get('/ResourceTypes', limit, async () => scim.resourceTypes());
  app.get('/Schemas', limit, async () => scim.schemas());
  app.get('/Users', limit, async (req) => {
    const q = listQuery.parse(req.query);
    return scim.list(q.filter, q.startIndex, q.count);
  });
  app.get('/Users/:id', limit, async (req) => scim.get(id(req)));
  app.post('/Users', limit, async (req, reply) => reply.code(201).send(await scim.create((req.body ?? {}) as never, req.ip)));
  app.put('/Users/:id', limit, async (req) => scim.replace(id(req), (req.body ?? {}) as never, req.ip));
  app.patch('/Users/:id', limit, async (req) => scim.patch(id(req), (req.body ?? {}) as never, req.ip));
  app.delete('/Users/:id', limit, async (req, reply) => {
    scim.deactivate(id(req), req.ip);
    return reply.code(204).send();
  });
  app.get('/Groups', limit, async () => ({ schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'], totalResults: 0, startIndex: 1, itemsPerPage: 0, Resources: [] }));
}
