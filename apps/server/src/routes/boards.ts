import {
  createBoardSchema,
  createColumnSchema,
  createGroupSchema,
  createItemSchema,
  createUpdateSchema,
  idSchema,
  setMemberSchema,
  updateBoardSchema,
  updateColumnSchema,
  updateGroupSchema,
  updateItemSchema,
} from '@suboard/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { actorOf } from '../plugins/auth.js';
import type { Services } from '../services/index.js';
import { listTemplates } from '../services/templates.js';

const param = (req: FastifyRequest, name: string): string => idSchema.parse((req.params as Record<string, string>)[name]);

export async function boardRoutes(app: FastifyInstance, { services }: { services: Services }) {
  const { boards, items, activity, access, dashboard } = services;

  app.get('/templates', async () => ({ templates: listTemplates() }));
  app.get('/dashboard', async (req) => ({ dashboard: dashboard.build(actorOf(req)) }));

  // ---- boards
  app.get('/boards', async (req) => ({ boards: boards.list(actorOf(req)) }));

  app.post('/boards', async (req, reply) => {
    const board = boards.create(actorOf(req), createBoardSchema.parse(req.body));
    return reply.code(201).send({ board });
  });

  app.get('/boards/:id', async (req) => ({ board: boards.get(actorOf(req), param(req, 'id')) }));

  app.patch('/boards/:id', async (req) => ({
    board: boards.update(actorOf(req), param(req, 'id'), updateBoardSchema.parse(req.body)),
  }));

  app.delete('/boards/:id', async (req) => {
    boards.archive(actorOf(req), param(req, 'id'));
    return { ok: true };
  });

  app.get('/boards/:id/activity', async (req) => {
    const boardId = param(req, 'id');
    access.requireBoard(actorOf(req), boardId, 'viewer');
    return { activity: activity.forBoard(boardId) };
  });

  // ---- members
  app.put('/boards/:id/members', async (req) => {
    const input = setMemberSchema.parse(req.body);
    return { members: boards.setMember(actorOf(req), param(req, 'id'), input.userId, input.role) };
  });

  app.delete('/boards/:id/members/:userId', async (req) => ({
    members: boards.removeMember(actorOf(req), param(req, 'id'), param(req, 'userId')),
  }));

  // ---- groups
  app.post('/boards/:id/groups', async (req, reply) => {
    const group = boards.createGroup(actorOf(req), param(req, 'id'), createGroupSchema.parse(req.body));
    return reply.code(201).send({ group });
  });
  app.patch('/groups/:id', async (req) => ({
    group: boards.updateGroup(actorOf(req), param(req, 'id'), updateGroupSchema.parse(req.body)),
  }));
  app.delete('/groups/:id', async (req) => {
    boards.deleteGroup(actorOf(req), param(req, 'id'));
    return { ok: true };
  });

  // ---- columns
  app.post('/boards/:id/columns', async (req, reply) => {
    const column = boards.createColumn(actorOf(req), param(req, 'id'), createColumnSchema.parse(req.body));
    return reply.code(201).send({ column });
  });
  app.patch('/columns/:id', async (req) => ({
    column: boards.updateColumn(actorOf(req), param(req, 'id'), updateColumnSchema.parse(req.body)),
  }));
  app.delete('/columns/:id', async (req) => {
    boards.deleteColumn(actorOf(req), param(req, 'id'));
    return { ok: true };
  });

  // ---- items
  app.post('/boards/:id/items', async (req, reply) => {
    const item = items.create(actorOf(req), param(req, 'id'), createItemSchema.parse(req.body));
    return reply.code(201).send({ item });
  });
  app.patch('/items/:id', async (req) => ({
    item: items.update(actorOf(req), param(req, 'id'), updateItemSchema.parse(req.body)),
  }));
  app.delete('/items/:id', async (req) => {
    items.delete(actorOf(req), param(req, 'id'));
    return { ok: true };
  });
  app.get('/items/:id/activity', async (req) => {
    const itemId = param(req, 'id');
    access.requireBoard(actorOf(req), access.boardIdForItem(itemId), 'viewer');
    return { activity: activity.forItem(itemId) };
  });

  // ---- updates (comments)
  app.get('/items/:id/updates', async (req) => ({ updates: items.listUpdates(actorOf(req), param(req, 'id')) }));
  app.post('/items/:id/updates', async (req, reply) => {
    const input = createUpdateSchema.parse(req.body);
    const update = items.addUpdate(actorOf(req), param(req, 'id'), input.body, input.mentions);
    return reply.code(201).send({ update });
  });
  app.delete('/updates/:id', async (req) => {
    items.deleteUpdate(actorOf(req), param(req, 'id'));
    return { ok: true };
  });
}
