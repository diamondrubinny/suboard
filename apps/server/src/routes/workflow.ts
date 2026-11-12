import {
  bulkSchema,
  createViewSchema,
  idSchema,
  importSchema,
  moveItemSchema,
  personalNoteSchema,
  reminderSchema,
  saveItemTemplateSchema,
  searchQuerySchema,
  updateViewSchema,
  useItemTemplateSchema,
} from '@suboard/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { contentDisposition } from '../lib/filetype.js';
import { actorOf } from '../plugins/auth.js';
import type { Services } from '../services/index.js';

const param = (req: FastifyRequest, name: string): string => idSchema.parse((req.params as Record<string, string>)[name]);

/** Wave A routes: duplicate / move, bulk, trash, import / xlsx export, saved views, global search. */
export async function workflowRoutes(app: FastifyInstance, { services }: { services: Services }) {
  const { items, views, search, exports } = services;

  // ---- personal: reminders and a private note (only ever the caller's own)
  app.get('/items/:id/personal', async (req) => ({ personal: services.personal.personal(actorOf(req), param(req, 'id')) }));
  app.post('/items/:id/reminders', { config: { rateLimit: { max: 60, timeWindow: 10 * 60_000 } } }, async (req, reply) =>
    reply.code(201).send({ reminder: services.personal.addReminder(actorOf(req), param(req, 'id'), reminderSchema.parse(req.body)) }),
  );
  app.delete('/reminders/:id', async (req) => {
    services.personal.removeReminder(actorOf(req), param(req, 'id'));
    return { ok: true };
  });
  app.put('/items/:id/note', async (req) => services.personal.setNote(actorOf(req), param(req, 'id'), personalNoteSchema.parse(req.body).body));

  // ---- item templates
  app.get('/boards/:id/item-templates', async (req) => ({ templates: services.personal.listTemplates(actorOf(req), param(req, 'id')) }));
  app.post('/items/:id/save-as-template', async (req, reply) =>
    reply.code(201).send({ template: services.personal.saveTemplate(actorOf(req), param(req, 'id'), saveItemTemplateSchema.parse(req.body).name) }),
  );
  app.post('/item-templates/:id/use', async (req, reply) =>
    reply.code(201).send({ item: services.personal.useTemplate(actorOf(req), param(req, 'id'), useItemTemplateSchema.parse(req.body).groupId) }),
  );
  app.delete('/item-templates/:id', async (req) => {
    services.personal.removeTemplate(actorOf(req), param(req, 'id'));
    return { ok: true };
  });

  app.post('/items/:id/promote', async (req) => ({ item: items.promote(actorOf(req), param(req, 'id')) }));
  app.post('/items/:id/vote/:columnId', { config: { rateLimit: { max: 300, timeWindow: 15 * 60_000 } } }, async (req) => items.toggleVote(actorOf(req), param(req, 'id'), param(req, 'columnId')));

  app.post('/items/:id/duplicate', async (req, reply) => reply.code(201).send({ item: items.duplicate(actorOf(req), param(req, 'id')) }));

  app.post('/items/:id/move', async (req) => items.moveToBoard(actorOf(req), param(req, 'id'), moveItemSchema.parse(req.body)));

  app.post('/boards/:id/items/bulk', { config: { rateLimit: { max: 60, timeWindow: 60_000 } } }, async (req) =>
    items.bulk(actorOf(req), param(req, 'id'), bulkSchema.parse(req.body)),
  );

  app.get('/boards/:id/trash', async (req) => ({ items: items.trash(actorOf(req), param(req, 'id')) }));
  app.post('/items/:id/restore', async (req) => ({ item: items.restore(actorOf(req), param(req, 'id')) }));

  // Import receives rows already parsed in the browser (the server never parses the uploaded file).
  app.post('/boards/:id/import', { bodyLimit: 2 * 1024 * 1024, config: { rateLimit: { max: 10, timeWindow: 10 * 60_000 } } }, async (req) =>
    items.importRows(actorOf(req), param(req, 'id'), importSchema.parse(req.body)),
  );

  app.get('/boards/:id/export.xlsx', { config: { rateLimit: { max: 20, timeWindow: 10 * 60_000 } } }, async (req, reply) => {
    const { filename, data } = await exports.boardXlsx(actorOf(req), param(req, 'id'), req.ip);
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', contentDisposition(filename))
      .header('X-Content-Type-Options', 'nosniff')
      .send(data);
  });

  app.get('/boards/:id/views', async (req) => ({ views: views.list(actorOf(req), param(req, 'id')) }));
  app.post('/boards/:id/views', async (req, reply) =>
    reply.code(201).send({ view: views.create(actorOf(req), param(req, 'id'), createViewSchema.parse(req.body)) }),
  );
  app.patch('/views/:id', async (req) => ({ view: views.update(actorOf(req), param(req, 'id'), updateViewSchema.parse(req.body)) }));
  app.delete('/views/:id', async (req) => {
    views.remove(actorOf(req), param(req, 'id'));
    return { ok: true };
  });

  app.get('/search', { config: { rateLimit: { max: 120, timeWindow: 60_000 } } }, async (req) => {
    const { q } = searchQuerySchema.parse(req.query);
    return { hits: search.search(actorOf(req), q) };
  });
}
