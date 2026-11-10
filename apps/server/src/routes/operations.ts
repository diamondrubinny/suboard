import { idSchema, markNotificationsReadSchema } from '@suboard/shared';
import { createReadStream } from 'node:fs';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import { AppError, badRequest, forbidden } from '../lib/errors.js';
import { contentDisposition } from '../lib/filetype.js';
import { actorOf } from '../plugins/auth.js';
import type { Services } from '../services/index.js';

const param = (req: FastifyRequest, name: string): string => idSchema.parse((req.params as Record<string, string>)[name]);

/** Phase 2 routes: notifications, attachments, export, MFA reset. */
export async function operationsRoutes(app: FastifyInstance, { services, config }: { services: Services; config: AppConfig }) {
  // ---- notifications (always scoped to the requesting user)
  app.get('/notifications', async (req) => services.notifications.list(actorOf(req).id));

  app.post('/notifications/read', async (req) => {
    services.notifications.markRead(actorOf(req).id, markNotificationsReadSchema.parse(req.body));
    return { ok: true };
  });

  // ---- attachments
  app.get('/items/:id/attachments', async (req) => ({
    attachments: services.attachments.list(actorOf(req), param(req, 'id')),
    scanner: services.attachments.scannerName,
    maxBytes: config.maxUploadBytes,
  }));

  app.post(
    '/items/:id/attachments',
    { config: { rateLimit: { max: 30, timeWindow: 10 * 60_000 } } },
    async (req, reply) => {
      const actor = actorOf(req);
      const itemId = param(req, 'id');
      if (!req.isMultipart()) throw badRequest('יש לשלוח קובץ');
      const file = await req.file();
      if (!file) throw badRequest('יש לשלוח קובץ');
      let data: Buffer;
      try {
        data = await file.toBuffer(); // bounded by multipart `fileSize` limit
      } catch (err) {
        if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') throw new AppError(413, 'FILE_TOO_LARGE', 'הקובץ גדול מהמותר');
        throw err;
      }
      const attachment = await services.attachments.upload(actor, itemId, { filename: file.filename, data }, req.ip);
      return reply.code(201).send({ attachment });
    },
  );

  app.get('/attachments/:id/download', async (req, reply) => {
    const file = services.attachments.resolveDownload(actorOf(req), param(req, 'id'));
    reply
      .header('Content-Type', file.mime)
      .header('Content-Length', String(file.size))
      .header('Content-Disposition', contentDisposition(file.name))
      // Never render user-supplied files in the app's origin.
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, no-store');
    return reply.send(createReadStream(file.path));
  });

  app.delete('/attachments/:id', async (req) => {
    await services.attachments.remove(actorOf(req), param(req, 'id'));
    return { ok: true };
  });

  // ---- export
  app.get('/boards/:id/export.csv', { config: { rateLimit: { max: 20, timeWindow: 10 * 60_000 } } }, async (req, reply) => {
    const { filename, csv } = services.exports.boardCsv(actorOf(req), param(req, 'id'), req.ip);
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', contentDisposition(filename))
      .header('X-Content-Type-Options', 'nosniff')
      .send(csv);
  });

  // ---- admin: reset MFA for a user who lost their device
  app.post('/users/:id/reset-mfa', async (req) => {
    const actor = actorOf(req);
    if (actor.role !== 'admin') throw forbidden();
    return { user: services.users.resetMfa(actor, param(req, 'id'), services.mfa) };
  });
}
