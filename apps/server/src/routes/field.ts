import {
  addLinkSchema,
  manualTimeSchema,
  setRelationSchema,
  complianceSettingsSchema,
  createFormSchema,
  quickFormSchema,
  idSchema,
  investigationSchema,
  linkedActionSchema,
  submitFormSchema,
  updateFormSchema,
} from '@suboard/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError, badRequest } from '../lib/errors.js';
import { actorOf } from '../plugins/auth.js';
import type { Services } from '../services/index.js';

const param = (req: FastifyRequest, name: string): string => idSchema.parse((req.params as Record<string, string>)[name]);

/** Reads one multipart file (bounded by the multipart `fileSize` limit). */
async function readFile(req: FastifyRequest): Promise<{ filename: string; data: Buffer }> {
  if (!req.isMultipart()) throw badRequest('יש לשלוח קובץ');
  const file = await req.file();
  if (!file) throw badRequest('יש לשלוח קובץ');
  try {
    return { filename: file.filename, data: await file.toBuffer() };
  } catch (err) {
    if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') throw new AppError(413, 'FILE_TOO_LARGE', 'הקובץ גדול מהמותר');
    throw err;
  }
}

/** Wave C routes: QR card, item links, investigations, compliance, internal forms. */
export async function fieldRoutes(app: FastifyInstance, { services }: { services: Services }) {
  const { links, investigations, compliance, forms } = services;

  app.get('/items/:id/card', async (req) => ({ card: links.card(actorOf(req), param(req, 'id')) }));
  app.get('/items/:id/links', async (req) => ({ links: links.list(actorOf(req), param(req, 'id')) }));
  app.post('/items/:id/links', { config: { rateLimit: { max: 120, timeWindow: 15 * 60_000 } } }, async (req, reply) =>
    reply.code(201).send({ links: links.add(actorOf(req), param(req, 'id'), addLinkSchema.parse(req.body).toItemId) }),
  );
  app.put('/items/:id/relations/:columnId', { config: { rateLimit: { max: 300, timeWindow: 15 * 60_000 } } }, async (req) => ({
    related: links.setRelation(actorOf(req), param(req, 'id'), param(req, 'columnId'), setRelationSchema.parse(req.body).itemIds),
  }));
  app.get('/boards/:id/item-names', async (req) => ({
    items: links.itemNames(actorOf(req), param(req, 'id'), String((req.query as { q?: string }).q ?? '')),
  }));
  // ---- time tracking (module off by default)
  app.get('/items/:id/time', async (req) => ({ time: services.time.item(actorOf(req), param(req, 'id')) }));
  app.post('/items/:id/time/start', async (req) => ({ time: services.time.start(actorOf(req), param(req, 'id')) }));
  app.post('/items/:id/time/stop', async (req) => ({ time: services.time.stop(actorOf(req), param(req, 'id')) }));
  app.post('/items/:id/time', async (req) => ({ time: services.time.addManual(actorOf(req), param(req, 'id'), manualTimeSchema.parse(req.body)) }));
  app.patch('/time/:id', async (req) => ({ time: services.time.update(actorOf(req), param(req, 'id'), manualTimeSchema.parse(req.body)) }));
  app.delete('/time/:id', async (req) => {
    services.time.remove(actorOf(req), param(req, 'id'));
    return { ok: true };
  });

  app.delete('/links/:id', async (req) => {
    links.remove(actorOf(req), param(req, 'id'));
    return { ok: true };
  });

  app.get('/items/:id/investigation', async (req) => ({ investigation: investigations.get(actorOf(req), param(req, 'id')) }));
  app.put('/items/:id/investigation', async (req) => ({
    investigation: investigations.save(actorOf(req), param(req, 'id'), investigationSchema.parse(req.body)),
  }));
  app.post('/items/:id/investigation/action', { config: { rateLimit: { max: 30, timeWindow: 60_000 } } }, async (req, reply) =>
    reply.code(201).send({ item: investigations.createAction(actorOf(req), param(req, 'id'), linkedActionSchema.parse(req.body)) }),
  );

  app.get('/compliance', async (req) => ({ boards: compliance.overview(actorOf(req)) }));
  app.get('/boards/:id/compliance', async (req) => ({ compliance: compliance.forBoard(actorOf(req), param(req, 'id')) }));
  app.put('/boards/:id/compliance', async (req) => ({
    compliance: compliance.configure(actorOf(req), param(req, 'id'), complianceSettingsSchema.parse((req.body as { settings?: unknown } | null)?.settings ?? null)),
  }));

  // Forms — management: board owner.
  app.get('/boards/:id/forms', async (req) => ({ forms: forms.listForBoard(actorOf(req), param(req, 'id')) }));
  app.post('/boards/:id/forms', async (req, reply) => reply.code(201).send({ form: forms.create(actorOf(req), param(req, 'id'), createFormSchema.parse(req.body)) }));
  app.patch('/forms/:id', async (req) => ({ form: forms.update(actorOf(req), param(req, 'id'), updateFormSchema.parse(req.body)) }));
  app.delete('/forms/:id', async (req) => {
    forms.remove(actorOf(req), param(req, 'id'));
    return { ok: true };
  });

  // Forms — filling (audience checked in the service). `/forms/mine` must be registered before `/forms/:id`.
  app.post('/forms/quick', { config: { rateLimit: { max: 20, timeWindow: 10 * 60_000 } } }, async (req, reply) =>
    reply.code(201).send(forms.createQuick(actorOf(req), quickFormSchema.parse(req.body))),
  );
  app.get('/forms', async (req) => ({ forms: forms.available(actorOf(req)) }));
  app.get('/forms/managed', async (req) => ({ forms: forms.managed(actorOf(req)) }));
  app.post('/forms/:id/duplicate', async (req, reply) => reply.code(201).send({ form: forms.duplicate(actorOf(req), param(req, 'id')) }));
  app.get('/forms/mine', async (req) => ({ submissions: forms.mine(actorOf(req)) }));
  app.get('/forms/:id', async (req) => ({ form: forms.forFill(actorOf(req), param(req, 'id')) }));
  app.post('/forms/:id/submit', { config: { rateLimit: { max: 20, timeWindow: 10 * 60_000 } } }, async (req, reply) =>
    reply.code(201).send(forms.submit(actorOf(req), param(req, 'id'), submitFormSchema.parse(req.body))),
  );
  app.post('/forms/:id/items/:itemId/attachments', { config: { rateLimit: { max: 20, timeWindow: 10 * 60_000 } } }, async (req, reply) => {
    const attachment = await forms.uploadPhoto(actorOf(req), param(req, 'id'), param(req, 'itemId'), await readFile(req), req.ip);
    return reply.code(201).send({ attachment });
  });
}
