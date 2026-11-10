import {
  createPermitSchema,
  createProcedureSchema,
  createTrainingSchema,
  idSchema,
  permitActionSchema,
  permitCheckSchema,
  pinsSchema,
  procedureVersionSchema,
  trainingRecordSchema,
  trainingRequirementsSchema,
  updateProcedureSchema,
  updateTrainingSchema,
} from '@suboard/shared';
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { contentDisposition } from '../lib/filetype.js';
import { actorOf } from '../plugins/auth.js';
import type { Services } from '../services/index.js';

const param = (req: FastifyRequest, name: string): string => idSchema.parse((req.params as Record<string, string>)[name]);
const scopeQuery = z.object({ scope: z.enum(['mine', 'approvals', 'all']).default('all') });

/** Wave E routes: trainings, work permits, procedures, floor-plan pins. */
export async function moduleRoutes(app: FastifyInstance, { services }: { services: Services }) {
  const { trainings, permits, procedures, plans } = services;
  const writes = { config: { rateLimit: { max: 60, timeWindow: 60_000 } } };

  // ---- trainings (managers; everyone: their own)
  app.get('/trainings', async (req) => ({ trainings: trainings.list(actorOf(req)) }));
  app.post('/trainings', writes, async (req, reply) => reply.code(201).send({ training: trainings.create(actorOf(req), createTrainingSchema.parse(req.body)) }));
  app.patch('/trainings/:id', async (req) => ({ training: trainings.update(actorOf(req), param(req, 'id'), updateTrainingSchema.parse(req.body)) }));
  app.delete('/trainings/:id', async (req) => {
    trainings.remove(actorOf(req), param(req, 'id'));
    return { ok: true };
  });
  app.put('/trainings/:id/requirements', async (req) => ({ training: trainings.setRequirements(actorOf(req), param(req, 'id'), trainingRequirementsSchema.parse(req.body).userIds) }));
  app.post('/trainings/:id/records', writes, async (req, reply) => reply.code(201).send({ added: trainings.addRecords(actorOf(req), param(req, 'id'), trainingRecordSchema.parse(req.body)) }));
  app.delete('/training-records/:id', async (req) => {
    trainings.removeRecord(actorOf(req), param(req, 'id'));
    return { ok: true };
  });
  app.get('/trainings/matrix', async (req) => ({ matrix: trainings.matrix(actorOf(req)) }));
  app.get('/trainings/matrix.csv', { config: { rateLimit: { max: 20, timeWindow: 10 * 60_000 } } }, async (req, reply) =>
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', contentDisposition(`training-matrix-${new Date().toISOString().slice(0, 10)}.csv`))
      .send(trainings.matrixCsv(actorOf(req), req.ip)),
  );
  app.get('/me/trainings', async (req) => ({ trainings: trainings.mine(actorOf(req)) }));

  // ---- work permits
  app.get('/permits', async (req) => ({ permits: permits.list(actorOf(req), scopeQuery.parse(req.query).scope) }));
  app.post('/permits/check', async (req) => ({ conflicts: permits.check(actorOf(req), permitCheckSchema.parse(req.body)) }));
  app.post('/permits', writes, async (req, reply) => reply.code(201).send({ permit: permits.create(actorOf(req), createPermitSchema.parse(req.body)) }));
  app.get('/permits/:id', async (req) => ({ permit: permits.get(actorOf(req), param(req, 'id')) }));
  app.post('/permits/:id/approve', writes, async (req) => ({ permit: permits.decide(actorOf(req), param(req, 'id'), 'approved', permitActionSchema.parse(req.body).comment) }));
  app.post('/permits/:id/reject', writes, async (req) => ({ permit: permits.decide(actorOf(req), param(req, 'id'), 'rejected', permitActionSchema.parse(req.body).comment) }));
  app.post('/permits/:id/close', writes, async (req) => ({ permit: permits.finish(actorOf(req), param(req, 'id'), 'closed', permitActionSchema.parse(req.body).comment) }));
  app.post('/permits/:id/cancel', writes, async (req) => ({ permit: permits.finish(actorOf(req), param(req, 'id'), 'cancelled', permitActionSchema.parse(req.body).comment) }));

  // ---- procedures
  app.get('/procedures', async (req) => ({ procedures: procedures.list(actorOf(req)) }));
  app.get('/me/procedures', async (req) => ({ procedures: procedures.pending(actorOf(req)) }));
  app.post('/procedures', writes, async (req, reply) => reply.code(201).send({ procedure: procedures.create(actorOf(req), createProcedureSchema.parse(req.body)) }));
  app.get('/procedures/:id', async (req) => ({ procedure: procedures.get(actorOf(req), param(req, 'id')) }));
  app.patch('/procedures/:id', async (req) => ({ procedure: procedures.update(actorOf(req), param(req, 'id'), updateProcedureSchema.parse(req.body)) }));
  app.post('/procedures/:id/versions', { ...writes, bodyLimit: 256 * 1024 }, async (req, reply) =>
    reply.code(201).send({ procedure: procedures.publish(actorOf(req), param(req, 'id'), procedureVersionSchema.parse(req.body)) }),
  );
  app.get('/procedures/:id/acks', async (req) => ({ report: procedures.report(actorOf(req), param(req, 'id')) }));
  app.post('/procedure-versions/:id/ack', writes, async (req) => ({ procedure: procedures.acknowledge(actorOf(req), param(req, 'id')) }));

  // ---- floor plans
  app.get('/boards/:id/plans', async (req) => ({ plans: plans.plans(actorOf(req), param(req, 'id')) }));
  app.get('/attachments/:id/pins', async (req) => ({ pins: plans.get(actorOf(req), param(req, 'id')) }));
  app.put('/attachments/:id/pins', async (req) => ({ pins: plans.set(actorOf(req), param(req, 'id'), pinsSchema.parse(req.body).pins) }));
}
