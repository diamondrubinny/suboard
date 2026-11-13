import {
  createBoardSchema,
  createColumnSchema,
  createGroupSchema,
  createItemSchema,
  createUpdateSchema,
  duplicateBoardSchema,
  createWebhookSchema,
  updateWebhookSchema,
  moveBoardSchema,
  workspaceSchema,
  updateTeamSchema,
  addTeamToBoardSchema,
  idSchema,
  reactionSchema,
  saveTemplateSchema,
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
import { MAX_BULK_COPY } from '../services/items.js';
import { badRequest } from '../lib/errors.js';

const param = (req: FastifyRequest, name: string): string => idSchema.parse((req.params as Record<string, string>)[name]);

export async function boardRoutes(app: FastifyInstance, { services }: { services: Services }) {
  const { boards, items, activity, access, dashboard } = services;

  app.get('/templates', async (req) => ({ templates: listTemplates(), custom: services.boardTemplates.list(actorOf(req)) }));
  app.delete('/templates/custom/:id', async (req) => {
    services.boardTemplates.remove(actorOf(req), param(req, 'id'));
    return { ok: true };
  });
  app.post('/boards/:id/save-as-template', async (req, reply) => {
    const template = services.boardTemplates.saveFromBoard(actorOf(req), param(req, 'id'), saveTemplateSchema.parse(req.body));
    return reply.code(201).send({ template });
  });
  app.get('/dashboard', async (req) => ({ dashboard: dashboard.build(actorOf(req)) }));

  // ---- boards
  app.get('/boards', async (req) => ({ boards: boards.list(actorOf(req)) }));

  app.post('/boards', async (req, reply) => {
    const board = boards.create(actorOf(req), createBoardSchema.parse(req.body), (id) => services.boardTemplates.structure(id));
    return reply.code(201).send({ board });
  });

  // ---- outgoing webhooks (board owners; the whole module is off until an administrator enables it)
  app.get('/boards/:id/webhooks', async (req) => ({ webhooks: services.webhooks.list(actorOf(req), param(req, 'id')) }));
  app.post('/boards/:id/webhooks', { config: { rateLimit: { max: 20, timeWindow: 15 * 60_000 } } }, async (req, reply) =>
    reply.code(201).send(services.webhooks.create(actorOf(req), param(req, 'id'), createWebhookSchema.parse(req.body), req.ip)),
  );
  app.patch('/webhooks/:id', async (req) => ({ webhook: services.webhooks.update(actorOf(req), param(req, 'id'), updateWebhookSchema.parse(req.body)) }));
  app.delete('/webhooks/:id', async (req) => {
    services.webhooks.remove(actorOf(req), param(req, 'id'), req.ip);
    return { ok: true };
  });
  app.get('/webhooks/:id/deliveries', async (req) => ({ deliveries: services.webhooks.deliveries(actorOf(req), param(req, 'id')) }));
  app.post('/webhooks/:id/test', { config: { rateLimit: { max: 20, timeWindow: 15 * 60_000 } } }, async (req) => ({ delivery: await services.webhooks.test(actorOf(req), param(req, 'id')) }));

  // ---- teams (named groups of users; they grant nothing by themselves)
  app.get('/teams', async () => ({ teams: services.teams.list() }));
  app.post('/teams', { config: { rateLimit: { max: 30, timeWindow: 15 * 60_000 } } }, async (req, reply) =>
    reply.code(201).send({ team: services.teams.create(actorOf(req), workspaceSchema.parse(req.body).name) }),
  );
  app.patch('/teams/:id', async (req) => ({ team: services.teams.update(actorOf(req), param(req, 'id'), updateTeamSchema.parse(req.body)) }));
  app.delete('/teams/:id', async (req) => {
    services.teams.remove(actorOf(req), param(req, 'id'));
    return { ok: true };
  });
  app.post('/boards/:id/members/team', { config: { rateLimit: { max: 30, timeWindow: 15 * 60_000 } } }, async (req) => {
    const input = addTeamToBoardSchema.parse(req.body);
    return services.teams.addToBoard(actorOf(req), param(req, 'id'), input.teamId, input.role);
  });

  // ---- workspaces (organisation of the board list only; access stays per board)
  app.get('/workspaces', async (req) => ({ workspaces: services.workspaces.list(actorOf(req)) }));
  app.post('/workspaces', { config: { rateLimit: { max: 30, timeWindow: 15 * 60_000 } } }, async (req, reply) =>
    reply.code(201).send({ workspace: services.workspaces.create(actorOf(req), workspaceSchema.parse(req.body).name) }),
  );
  app.patch('/workspaces/:id', async (req) => ({ workspace: services.workspaces.rename(actorOf(req), param(req, 'id'), workspaceSchema.parse(req.body).name) }));
  app.delete('/workspaces/:id', async (req) => {
    services.workspaces.remove(actorOf(req), param(req, 'id'));
    return { ok: true };
  });
  app.post('/workspaces/:id/folders', { config: { rateLimit: { max: 60, timeWindow: 15 * 60_000 } } }, async (req, reply) =>
    reply.code(201).send({ folder: services.workspaces.createFolder(actorOf(req), param(req, 'id'), workspaceSchema.parse(req.body).name) }),
  );
  app.patch('/folders/:id', async (req) => ({ folder: services.workspaces.renameFolder(actorOf(req), param(req, 'id'), workspaceSchema.parse(req.body).name) }));
  app.delete('/folders/:id', async (req) => {
    services.workspaces.removeFolder(actorOf(req), param(req, 'id'));
    return { ok: true };
  });
  app.put('/boards/:id/workspace', async (req) => {
    const move = moveBoardSchema.parse(req.body);
    services.workspaces.moveBoard(actorOf(req), param(req, 'id'), move.workspaceId, move.folderId ?? null);
    return { ok: true };
  });

  /** A new board with the same groups and columns (and optionally the items). Members, automations, forms, updates and files stay behind. */
  app.post('/boards/:id/duplicate', { config: { rateLimit: { max: 20, timeWindow: 15 * 60_000 } } }, async (req, reply) => {
    const actor = actorOf(req);
    const sourceId = param(req, 'id');
    const input = duplicateBoardSchema.parse(req.body);
    services.access.requireBoard(actor, sourceId, 'owner');
    if (input.withItems && services.items.countLive(sourceId) > MAX_BULK_COPY) throw badRequest(`אפשר לשכפל עם פריטים לוח של עד ${MAX_BULK_COPY} פריטים`);
    const structure = services.boardTemplates.structureOfBoard(sourceId);
    const board = boards.create(actor, { name: input.name, templateKey: structure.baseKey, customTemplateId: sourceId, workspaceId: boards.get(actor, sourceId).workspaceId ?? undefined }, () => structure);
    const items = input.withItems ? services.items.copyBoardItems(actor, sourceId, board.id) : 0;
    services.audit.log('board_duplicated', { userId: actor.id, ip: req.ip, meta: { fromBoardId: sourceId, boardId: board.id, items } });
    return reply.code(201).send({ board: boards.get(actor, board.id), items });
  });

  app.get('/boards/:id', async (req) => {
    const actor = actorOf(req);
    const board = boards.get(actor, param(req, 'id'));
    services.favorites.recordVisit(actor.id, board.id);
    return { board };
  });
  app.put('/boards/:id/favorite', async (req) => {
    services.favorites.setFavorite(actorOf(req), param(req, 'id'), true);
    return { favorite: true };
  });
  app.delete('/boards/:id/favorite', async (req) => {
    services.favorites.setFavorite(actorOf(req), param(req, 'id'), false);
    return { favorite: false };
  });
  app.get('/me/work', async (req) => ({ items: dashboard.myWork(actorOf(req)) }));
  app.get('/me/recent-boards', async (req) => ({ boards: services.favorites.recent(actorOf(req)) }));
  app.get('/boards/:id/files', async (req) => ({ files: services.attachments.listForBoard(actorOf(req), param(req, 'id')) }));

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
  app.post('/groups/:id/duplicate', { config: { rateLimit: { max: 30, timeWindow: 15 * 60_000 } } }, async (req, reply) =>
    reply.code(201).send(services.items.duplicateGroup(actorOf(req), param(req, 'id'))),
  );
  app.patch('/groups/:id', async (req) => ({
    group: boards.updateGroup(actorOf(req), param(req, 'id'), updateGroupSchema.parse(req.body)),
  }));
  app.delete('/groups/:id', async (req) => {
    boards.deleteGroup(actorOf(req), param(req, 'id'));
    return { ok: true };
  });

  // ---- columns
  app.post('/boards/:id/columns', async (req, reply) => {
    const input = createColumnSchema.parse(req.body);
    if (input.type === 'time' && !services.modules.enabled('time_tracking')) throw badRequest('מודול מעקב הזמן כבוי. מנהל המערכת מפעיל אותו במסך "מודולים".', { type: 'המודול כבוי' });
    const column = boards.createColumn(actorOf(req), param(req, 'id'), input);
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
    const update = items.addUpdate(actorOf(req), param(req, 'id'), input.body, input.mentions, input.parentId);
    return reply.code(201).send({ update });
  });
  app.put('/updates/:id/reactions/:emoji', async (req) => {
    items.react(actorOf(req), param(req, 'id'), reactionSchema.parse((req.params as { emoji: string }).emoji), true);
    return { ok: true };
  });
  app.delete('/updates/:id/reactions/:emoji', async (req) => {
    items.react(actorOf(req), param(req, 'id'), reactionSchema.parse((req.params as { emoji: string }).emoji), false);
    return { ok: true };
  });

  // ---- following
  app.get('/items/:id/follow', async (req) => ({ follow: services.follow.state(actorOf(req), param(req, 'id')) }));
  app.put('/items/:id/follow', async (req) => ({ follow: services.follow.set(actorOf(req), param(req, 'id'), true) }));
  app.delete('/items/:id/follow', async (req) => ({ follow: services.follow.set(actorOf(req), param(req, 'id'), false) }));

  app.delete('/updates/:id', async (req) => {
    items.deleteUpdate(actorOf(req), param(req, 'id'));
    return { ok: true };
  });
}
