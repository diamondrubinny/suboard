import {
  createAutomationSchema,
  createRecurrenceSchema,
  createReportSchema,
  icsQuerySchema,
  idSchema,
  updateAutomationSchema,
  updateRecurrenceSchema,
  updateReportSchema,
} from '@suboard/shared';
import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { contentDisposition } from '../lib/filetype.js';
import { actorOf } from '../plugins/auth.js';
import type { Services } from '../services/index.js';

const param = (req: FastifyRequest, name: string): string => idSchema.parse((req.params as Record<string, string>)[name]);
const summaryQuery = z.object({ periodDays: z.coerce.number().int().min(1).max(365).default(7) });

const sendIcs = (reply: FastifyReply, out: { filename: string; ics: string }) =>
  reply
    .header('Content-Type', 'text/calendar; charset=utf-8')
    .header('Content-Disposition', contentDisposition(out.filename))
    .header('X-Content-Type-Options', 'nosniff')
    .send(out.ics);

/** Wave B routes: automations, recurring items, scheduled reports, calendar (ICS) export. */
export async function automationRoutes(app: FastifyInstance, { services }: { services: Services }) {
  const { automations, recurrences, reports, calendar } = services;

  // Automations — list/log: editor; changes: owner (enforced in the service).
  app.get('/boards/:id/automations', async (req) => ({ automations: automations.list(actorOf(req), param(req, 'id')) }));
  app.post('/boards/:id/automations', { config: { rateLimit: { max: 60, timeWindow: 60_000 } } }, async (req, reply) =>
    reply.code(201).send({ automation: automations.create(actorOf(req), param(req, 'id'), createAutomationSchema.parse(req.body)) }),
  );
  app.patch('/automations/:id', async (req) => ({ automation: automations.update(actorOf(req), param(req, 'id'), updateAutomationSchema.parse(req.body)) }));
  app.delete('/automations/:id', async (req) => {
    automations.remove(actorOf(req), param(req, 'id'));
    return { ok: true };
  });
  app.get('/boards/:id/automation-runs', async (req) => ({ runs: automations.runs(actorOf(req), param(req, 'id')) }));

  // Recurring items — editor.
  app.get('/boards/:id/recurrences', async (req) => ({ recurrences: recurrences.list(actorOf(req), param(req, 'id')) }));
  app.post('/boards/:id/recurrences', { config: { rateLimit: { max: 60, timeWindow: 60_000 } } }, async (req, reply) =>
    reply.code(201).send({ recurrence: recurrences.create(actorOf(req), param(req, 'id'), createRecurrenceSchema.parse(req.body)) }),
  );
  app.patch('/recurrences/:id', async (req) => ({ recurrence: recurrences.update(actorOf(req), param(req, 'id'), updateRecurrenceSchema.parse(req.body)) }));
  app.delete('/recurrences/:id', async (req) => {
    recurrences.remove(actorOf(req), param(req, 'id'));
    return { ok: true };
  });

  // Scheduled reports — list: editor; changes: owner. Summary: viewer.
  app.get('/boards/:id/reports', async (req) => ({ reports: reports.list(actorOf(req), param(req, 'id')) }));
  app.post('/boards/:id/reports', { config: { rateLimit: { max: 30, timeWindow: 60_000 } } }, async (req, reply) =>
    reply.code(201).send({ report: reports.create(actorOf(req), param(req, 'id'), createReportSchema.parse(req.body)) }),
  );
  app.patch('/reports/:id', async (req) => ({ report: reports.update(actorOf(req), param(req, 'id'), updateReportSchema.parse(req.body)) }));
  app.delete('/reports/:id', async (req) => {
    reports.remove(actorOf(req), param(req, 'id'));
    return { ok: true };
  });
  app.get('/boards/:id/report-summary', async (req) => ({
    summary: reports.summary(actorOf(req), param(req, 'id'), summaryQuery.parse(req.query).periodDays),
  }));

  // Calendar export (download only — no unauthenticated subscription URL).
  const icsLimit = { config: { rateLimit: { max: 30, timeWindow: 10 * 60_000 } } };
  app.get('/boards/:id/calendar.ics', icsLimit, async (req, reply) =>
    sendIcs(reply, calendar.board(actorOf(req), param(req, 'id'), icsQuerySchema.parse(req.query).columnId, req.ip)),
  );
  app.get('/me/calendar.ics', icsLimit, async (req, reply) => sendIcs(reply, calendar.mine(actorOf(req), req.ip)));
}
