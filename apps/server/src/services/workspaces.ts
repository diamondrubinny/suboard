import type { BoardFolder, Workspace } from '@suboard/shared';
import { nowIso, type DB } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import type { AccessService, Actor } from './access.js';
import type { AuditService } from './audit.js';

export const MAX_WORKSPACES = 50;
export const MAX_FOLDERS_PER_WORKSPACE = 30;

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
    const folders = this.db.prepare('SELECT id, workspace_id, name FROM board_folders ORDER BY position, name').all() as { id: string; workspace_id: string; name: string }[];
    const withFolders = (keep: (folderId: string) => boolean): Workspace[] =>
      rows.map((r) => ({ ...r, folders: folders.filter((f) => f.workspace_id === r.id && keep(f.id)).map((f) => ({ id: f.id, name: f.name })) }));
    if (WorkspaceService.canManage(actor)) return withFolders(() => true);
    // Everyone else learns the name of a workspace or a folder only when one of their boards is in it.
    const mine = this.db
      .prepare(
        `SELECT DISTINCT b.workspace_id AS w, b.folder_id AS f FROM boards b LEFT JOIN board_members m ON m.board_id = b.id AND m.user_id = ?
         WHERE b.archived_at IS NULL AND b.workspace_id IS NOT NULL AND (m.user_id IS NOT NULL OR (b.open_role IS NOT NULL AND ? = 0))`,
      )
      .all(actor.id, actor.guest ? 1 : 0) as { w: string; f: string | null }[];
    const ws = new Set(mine.map((r) => r.w));
    const fs = new Set(mine.map((r) => r.f));
    return withFolders((id) => fs.has(id)).filter((r) => ws.has(r.id));
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
    return { id, name, position, folders: [] };
  }

  rename(actor: Actor, id: string, name: string): Workspace {
    if (!WorkspaceService.canManage(actor)) throw forbidden('רק מנהלים יכולים לשנות סביבות עבודה');
    const row = this.db.prepare('SELECT id, position FROM workspaces WHERE id = ?').get(id) as { id: string; position: number } | undefined;
    if (!row) throw notFound('סביבת העבודה לא נמצאה');
    if (this.db.prepare('SELECT 1 FROM workspaces WHERE name = ? COLLATE NOCASE AND id <> ?').get(name, id)) throw badRequest('כבר קיימת סביבת עבודה בשם הזה', { name: 'השם תפוס' });
    this.db.prepare('UPDATE workspaces SET name = ? WHERE id = ?').run(name, id);
    this.audit.log('workspace_changed', { userId: actor.id, meta: { action: 'renamed', workspaceId: id } });
    return this.list(actor).find((w) => w.id === id)!;
  }

  /** Deleting a workspace never deletes boards: they simply stop belonging to one. */
  remove(actor: Actor, id: string): void {
    if (!WorkspaceService.canManage(actor)) throw forbidden('רק מנהלים יכולים למחוק סביבות עבודה');
    const res = this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
    if (!res.changes) throw notFound('סביבת העבודה לא נמצאה');
    this.audit.log('workspace_changed', { userId: actor.id, meta: { action: 'deleted', workspaceId: id } });
  }

  /** Puts a board in a workspace (or takes it out with `null`). The board's owner decides. */
  moveBoard(actor: Actor, boardId: string, workspaceId: string | null, folderId: string | null = null): void {
    this.access.requireBoard(actor, boardId, 'owner');
    if (workspaceId !== null && !this.exists(workspaceId)) throw badRequest('סביבת העבודה אינה קיימת', { workspaceId: 'לא קיימת' });
    // A folder always belongs to the board's workspace; moving to another workspace leaves the folder.
    if (folderId !== null && (workspaceId === null || !this.db.prepare('SELECT 1 FROM board_folders WHERE id = ? AND workspace_id = ?').get(folderId, workspaceId)))
      throw badRequest('התיקייה אינה שייכת לסביבת העבודה', { folderId: 'לא קיימת' });
    this.db.prepare('UPDATE boards SET workspace_id = ?, folder_id = ?, updated_at = ? WHERE id = ?').run(workspaceId, folderId, nowIso(), boardId);
  }

  // ---------------------------------------------------------------- folders
  createFolder(actor: Actor, workspaceId: string, name: string): BoardFolder {
    if (!WorkspaceService.canManage(actor)) throw forbidden('רק מנהלים יכולים ליצור תיקיות');
    if (!this.exists(workspaceId)) throw notFound('סביבת העבודה לא נמצאה');
    const count = (this.db.prepare('SELECT COUNT(*) AS n FROM board_folders WHERE workspace_id = ?').get(workspaceId) as { n: number }).n;
    if (count >= MAX_FOLDERS_PER_WORKSPACE) throw badRequest(`אפשר ליצור עד ${MAX_FOLDERS_PER_WORKSPACE} תיקיות בסביבת עבודה`);
    if (this.db.prepare('SELECT 1 FROM board_folders WHERE workspace_id = ? AND name = ? COLLATE NOCASE').get(workspaceId, name)) throw badRequest('כבר קיימת תיקייה בשם הזה', { name: 'השם תפוס' });
    const id = newId();
    const position = (this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM board_folders WHERE workspace_id = ?').get(workspaceId) as { p: number }).p;
    this.db.prepare('INSERT INTO board_folders (id, workspace_id, name, position, created_at) VALUES (?, ?, ?, ?, ?)').run(id, workspaceId, name, position, nowIso());
    this.audit.log('workspace_changed', { userId: actor.id, meta: { action: 'folder_created', workspaceId, folderId: id } });
    return { id, name };
  }

  renameFolder(actor: Actor, id: string, name: string): BoardFolder {
    if (!WorkspaceService.canManage(actor)) throw forbidden('רק מנהלים יכולים לשנות תיקיות');
    const row = this.db.prepare('SELECT workspace_id FROM board_folders WHERE id = ?').get(id) as { workspace_id: string } | undefined;
    if (!row) throw notFound('התיקייה לא נמצאה');
    if (this.db.prepare('SELECT 1 FROM board_folders WHERE workspace_id = ? AND name = ? COLLATE NOCASE AND id <> ?').get(row.workspace_id, name, id)) throw badRequest('כבר קיימת תיקייה בשם הזה', { name: 'השם תפוס' });
    this.db.prepare('UPDATE board_folders SET name = ? WHERE id = ?').run(name, id);
    this.audit.log('workspace_changed', { userId: actor.id, meta: { action: 'folder_renamed', workspaceId: row.workspace_id, folderId: id } });
    return { id, name };
  }

  /** Deleting a folder never deletes boards: they stay in the workspace, outside any folder. */
  removeFolder(actor: Actor, id: string): void {
    if (!WorkspaceService.canManage(actor)) throw forbidden('רק מנהלים יכולים למחוק תיקיות');
    const row = this.db.prepare('SELECT workspace_id FROM board_folders WHERE id = ?').get(id) as { workspace_id: string } | undefined;
    if (!row) throw notFound('התיקייה לא נמצאה');
    this.db.prepare('DELETE FROM board_folders WHERE id = ?').run(id);
    this.audit.log('workspace_changed', { userId: actor.id, meta: { action: 'folder_deleted', workspaceId: row.workspace_id, folderId: id } });
  }
}
