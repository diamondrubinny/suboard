import type { BoardMember, BoardRole, Team } from '@suboard/shared';
import { nowIso, type DB } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import type { AccessService, Actor } from './access.js';
import type { AuditService } from './audit.js';
import type { BoardService } from './boards.js';

export const MAX_TEAMS = 100;
export const MAX_TEAM_MEMBERS = 200;

/**
 * Teams: named groups of users ("צוות גזים"). A team grants nothing by itself. It is used to
 * (1) add all its people to a board in one step and (2) fill a "team" column. Guests are never
 * team members, and never see teams.
 */
export class TeamService {
  constructor(
    private readonly db: DB,
    private readonly access: AccessService,
    private readonly boards: BoardService,
    private readonly audit: AuditService,
  ) {}

  private static canManage(actor: Actor): boolean {
    return !actor.guest && (actor.role === 'admin' || actor.role === 'manager');
  }

  list(): Team[] {
    const rows = this.db.prepare('SELECT id, name FROM teams ORDER BY name').all() as { id: string; name: string }[];
    const members = this.db
      .prepare('SELECT tm.team_id, tm.user_id FROM team_members tm JOIN users u ON u.id = tm.user_id AND u.is_active = 1 AND u.is_guest = 0 ORDER BY u.name')
      .all() as { team_id: string; user_id: string }[];
    return rows.map((r) => ({ id: r.id, name: r.name, memberIds: members.filter((m) => m.team_id === r.id).map((m) => m.user_id) }));
  }

  private get(id: string): Team {
    const t = this.list().find((x) => x.id === id);
    if (!t) throw notFound('הצוות לא נמצא');
    return t;
  }

  /** Which of the given ids are existing teams (used to validate "team" cells). */
  existing(ids: string[]): Set<string> {
    if (!ids.length) return new Set();
    return new Set((this.db.prepare(`SELECT id FROM teams WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) as { id: string }[]).map((r) => r.id));
  }

  create(actor: Actor, name: string): Team {
    if (!TeamService.canManage(actor)) throw forbidden('רק מנהלים יכולים ליצור צוותים');
    if ((this.db.prepare('SELECT COUNT(*) AS n FROM teams').get() as { n: number }).n >= MAX_TEAMS) throw badRequest(`אפשר ליצור עד ${MAX_TEAMS} צוותים`);
    if (this.db.prepare('SELECT 1 FROM teams WHERE name = ? COLLATE NOCASE').get(name)) throw badRequest('כבר קיים צוות בשם הזה', { name: 'השם תפוס' });
    const id = newId();
    this.db.prepare('INSERT INTO teams (id, name, created_by, created_at) VALUES (?, ?, ?, ?)').run(id, name, actor.id, nowIso());
    this.audit.log('team_changed', { userId: actor.id, meta: { action: 'created', teamId: id } });
    return { id, name, memberIds: [] };
  }

  update(actor: Actor, id: string, input: { name?: string; memberIds?: string[] }): Team {
    if (!TeamService.canManage(actor)) throw forbidden('רק מנהלים יכולים לשנות צוותים');
    this.get(id);
    this.db.transaction(() => {
      if (input.name !== undefined) {
        if (this.db.prepare('SELECT 1 FROM teams WHERE name = ? COLLATE NOCASE AND id <> ?').get(input.name, id)) throw badRequest('כבר קיים צוות בשם הזה', { name: 'השם תפוס' });
        this.db.prepare('UPDATE teams SET name = ? WHERE id = ?').run(input.name, id);
      }
      if (input.memberIds !== undefined) {
        const ids = [...new Set(input.memberIds)];
        if (ids.length > MAX_TEAM_MEMBERS) throw badRequest(`עד ${MAX_TEAM_MEMBERS} חברים בצוות`);
        const ok = ids.length
          ? (this.db.prepare(`SELECT COUNT(*) AS n FROM users WHERE is_active = 1 AND is_guest = 0 AND id IN (${ids.map(() => '?').join(',')})`).get(...ids) as { n: number }).n
          : 0;
        if (ok !== ids.length) throw badRequest('אפשר לצרף לצוות רק משתמשים פעילים שאינם אורחים', { memberIds: 'משתמש לא תקין' });
        this.db.prepare('DELETE FROM team_members WHERE team_id = ?').run(id);
        const ins = this.db.prepare('INSERT INTO team_members (team_id, user_id) VALUES (?, ?)');
        for (const u of ids) ins.run(id, u);
      }
    })();
    this.audit.log('team_changed', { userId: actor.id, meta: { action: 'updated', teamId: id, changed: Object.keys(input) } });
    return this.get(id);
  }

  /** Deleting a team removes nobody from any board; "team" cells simply stop showing it. */
  remove(actor: Actor, id: string): void {
    if (!TeamService.canManage(actor)) throw forbidden('רק מנהלים יכולים למחוק צוותים');
    if (!this.db.prepare('DELETE FROM teams WHERE id = ?').run(id).changes) throw notFound('הצוות לא נמצא');
    this.audit.log('team_changed', { userId: actor.id, meta: { action: 'deleted', teamId: id } });
  }

  /**
   * Adds the team's current people to a board with the given role — a one-time step by the board's
   * owner. People who are already members keep their role; later changes to the team do not change the board.
   */
  addToBoard(actor: Actor, boardId: string, teamId: string, role: BoardRole): { added: number; members: BoardMember[] } {
    this.access.requireBoard(actor, boardId, 'owner');
    const team = this.get(teamId);
    const current = new Set(this.boards.members(boardId).map((m) => m.userId));
    let added = 0;
    for (const userId of team.memberIds) {
      if (current.has(userId)) continue;
      this.boards.setMember(actor, boardId, userId, role);
      added++;
    }
    return { added, members: this.boards.members(boardId) };
  }
}
