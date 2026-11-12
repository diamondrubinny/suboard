import type { Workspace } from '@suboard/shared';
import { nowIso, type DB } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import type { AccessService, Actor } from './access.js';
import type { AuditService } from './audit.js';

export const MAX_WORKSPACES = 50;

/**
 * Workspaces: named containers that keep the list of boards in order ("יחידת הבטיחות", "תחזוקת גזים").
 * Organisation only — a workspace grants nothing: who sees a board is still decided by the board's
 * own members. A workspace's name is shown only to people who can see at least one board in it
 * (and to managers, who arrange them).
 */
export class WorkspaceService {
  constructor(
    private readonly db: DB,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  private static canManage(actor: Actor): boolean {
    return actor.role === 'admin' || actor.role === 'manager';
  }

  list(actor: Actor): Workspace[] {
    const rows = this.db.prepare('SELECT id, name, position FROM workspaces ORDER BY position, name').all() as { id: string; name: string; position: number }[];
    if (WorkspaceService.canManage(actor)) return rows;
    const mine = new Set(
      (
        this.db
          .prepare('SELECT DISTINCT b.workspace_id AS w FROM boards b JOIN board_members m ON m.board_id = b.id AND m.user_id = ? WHERE b.archived_at IS NULL AND b.workspace_id IS NOT NULL')
          .all(actor.id) as { w: string }[]
      ).map((r) => r.w),
    );
    return rows.filter((r) => mine.has(r.id));
  }

  exists(id: string): boolean {
    return this.db.prepare('SELECT 1 FROM workspaces WHERE id = ?').get(id) !== undefined;
  }

  create(actor: Actor, name: string): Workspace {
    if (!WorkspaceService.canManage(actor)) throw forbidden('רק מנהלים יכולים ליצור סביבות עבודה');
    const count = (this.db.prepare('SELECT COUNT(*) AS n FROM workspaces').get() as { n: number }).n;
    if (count >= MAX_WORKSPACES) throw badRequest(`אפשר ליצור עד ${MAX_WORKSPACES} סביבות עבודה`);
    if (this.db.prepare('SELECT 1 FROM workspaces WHERE name = ? COLLATE NOCASE').get(name)) throw badRequest('כבר קיימת סביבת עבודה בשם הזה', { name: 'השם תפוס' });
    const id = newId();
    const position = (this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM workspaces').get() as { p: number }).p;
    this.db.prepare('INSERT INTO workspaces (id, name, position, created_by, created_at) VALUES (?, ?, ?, ?, ?)').run(id, name, position, actor.id, nowIso());
    this.audit.log('workspace_changed', { userId: actor.id, meta: { action: 'created', workspaceId: id } });
    return { id, name, position };
  }

  rename(actor: Actor, id: string, name: string): Workspace {
    if (!WorkspaceService.canManage(actor)) throw forbidden('רק מנהלים יכולים לשנות סביבות עבודה');
    const row = this.db.prepare('SELECT id, position FROM workspaces WHERE id = ?').get(id) as { id: string; position: number } | undefined;
    if (!row) throw notFound('סביבת העבודה לא נמצאה');
    if (this.db.prepare('SELECT 1 FROM workspaces WHERE name = ? COLLATE NOCASE AND id <> ?').get(name, id)) throw badRequest('כבר קיימת סביבת עבודה בשם הזה', { name: 'השם תפוס' });
    this.db.prepare('UPDATE workspaces SET name = ? WHERE id = ?').run(name, id);
    this.audit.log('workspace_changed', { userId: actor.id, meta: { action: 'renamed', workspaceId: id } });
    return { id, name, position: row.position };
  }

  /** Deleting a workspace never deletes boards: they simply stop belonging to one. */
  remove(actor: Actor, id: string): void {
    if (!WorkspaceService.canManage(actor)) throw forbidden('רק מנהלים יכולים למחוק סביבות עבודה');
    const res = this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
    if (!res.changes) throw notFound('סביבת העבודה לא נמצאה');
    this.audit.log('workspace_changed', { userId: actor.id, meta: { action: 'deleted', workspaceId: id } });
  }

  /** Puts a board in a workspace (or takes it out with `null`). The board's owner decides. */
  moveBoard(actor: Actor, boardId: string, workspaceId: string | null): void {
    this.access.requireBoard(actor, boardId, 'owner');
    if (workspaceId !== null && !this.exists(workspaceId)) throw badRequest('סביבת העבודה אינה קיימת', { workspaceId: 'לא קיימת' });
    this.db.prepare('UPDATE boards SET workspace_id = ?, updated_at = ? WHERE id = ?').run(workspaceId, nowIso(), boardId);
  }
}
