import { createDashboardSchema, dependenciesSchema, idSchema, monthQuerySchema, trendQuerySchema, updateDashboardSchema } from '@suboard/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { forbidden } from '../lib/errors.js';
import { actorOf } from '../plugins/auth.js';
import type { Services } from '../services/index.js';

const param = (req: FastifyRequest, name: string): string => idSchema.parse((req.params as Record<string, string>)[name]);

/** Wave D routes: custom dashboards, analytics (trend, workload, monthly), item dependencies. */
export async function planningRoutes(app: FastifyInstance, { services }: { services: Services }) {
  const { dashboards, analytics, dependencies } = services;
  const heavy = { config: { rateLimit: { max: 120, timeWindow: 60_000 } } };

  app.get('/dashboards', async (req) => ({ dashboards: dashboards.list(actorOf(req)) }));
  app.post('/dashboards', async (req, reply) => reply.code(201).send({ dashboard: dashboards.create(actorOf(req), createDashboardSchema.parse(req.body)) }));
  app.get('/dashboards/:id', async (req) => ({ dashboard: dashboards.get(actorOf(req), param(req, 'id')) }));
  app.patch('/dashboards/:id', async (req) => ({ dashboard: dashboards.update(actorOf(req), param(req, 'id'), updateDashboardSchema.parse(req.body)) }));
  app.delete('/dashboards/:id', async (req) => {
    dashboards.remove(actorOf(req), param(req, 'id'));
    return { ok: true };
  });
  app.get('/dashboards/:id/data', heavy, async (req) => ({ data: dashboards.data(actorOf(req), param(req, 'id')) }));

  app.get('/analytics/trend', heavy, async (req) => {
    const q = trendQuerySchema.parse(req.query);
    return { points: analytics.trend(actorOf(req), q.boards, q.period, q.count) };
  });
  app.get('/workload', heavy, async (req) => ({ rows: analytics.workload(actorOf(req)) }));
  app.get('/reports/monthly', heavy, async (req) => {
    const actor = actorOf(req);
    if (actor.role === 'member') throw forbidden('הדוח החודשי מיועד למנהלים');
    return { report: analytics.monthly(actor, monthQuerySchema.parse(req.query).month) };
  });

  app.get('/items/:id/dependencies', async (req) => ({ dependencies: dependencies.get(actorOf(req), param(req, 'id')) }));
  app.put('/items/:id/dependencies', async (req) => ({ dependencies: dependencies.set(actorOf(req), param(req, 'id'), dependenciesSchema.parse(req.body).blockedBy) }));
  app.get('/boards/:id/dependencies', async (req) => ({ dependencies: dependencies.forBoard(actorOf(req), param(req, 'id')) }));
}
