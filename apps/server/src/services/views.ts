import { LIMITS, type SavedView, type ViewConfig } from '@suboard/shared';
import { nowIso, parseJson, type DB } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import type { AccessService, Actor } from './access.js';

interface Row {
  id: string;
  board_id: string;
  user_id: string;
  owner_name: string;
  name: string;
  config: string;
  shared: number;
}

/**
 * Saved board views: personal (only their author sees them) or shared with the whole board
 * (only board owners may share). Column ids in a config are filtered to the board's columns.
 */
export class ViewService {
  constructor(
    private readonly db: DB,
    private readonly access: AccessService,
  ) {}

  private toView(r: Row, actor: Actor): SavedView {
    return {
      id: r.id,
      boardId: r.board_id,
      userId: r.user_id,
      ownerName: r.owner_name,
      name: r.name,
      shared: r.shared === 1,
      config: parseJson<ViewConfig>(r.config, { view: 'table' }),
      mine: r.user_id === actor.id,
    };
  }

  private cleanConfig(boardId: string, config: ViewConfig): ViewConfig {
    const columns = new Set((this.db.prepare('SELECT id FROM board_columns WHERE board_id = ?').all(boardId) as { id: string }[]).map((c) => c.id));
    const keep = (id?: string) => (id && columns.has(id) ? id : undefined);
    return {
      ...config,
      hidden: config.hidden?.filter((id) => columns.has(id)),
      kanbanColumnId: keep(config.kanbanColumnId),
      calendarColumnId: keep(config.calendarColumnId),
      sort: config.sort && (config.sort.by === 'name' || config.sort.by === 'seq' || columns.has(config.sort.by)) ? config.sort : undefined,
    };
  }

  list(actor: Actor, boardId: string): SavedView[] {
    this.access.requireBoard(actor, boardId, 'viewer');
    const rows = this.db
      .prepare(
        `SELECT v.*, u.name AS owner_name FROM saved_views v JOIN users u ON u.id = v.user_id
         WHERE v.board_id = ? AND (v.user_id = ? OR v.shared = 1) ORDER BY v.shared DESC, v.name`,
      )
      .all(boardId, actor.id) as Row[];
    return rows.map((r) => this.toView(r, actor));
  }

  create(actor: Actor, boardId: string, input: { name: string; config: ViewConfig; shared: boolean }): SavedView {
    const role = this.access.requireBoard(actor, boardId, 'viewer');
    if (input.shared && role !== 'owner') throw forbidden('רק בעלי הלוח יכולים לשתף תצוגה');
    const mine = (this.db.prepare('SELECT COUNT(*) AS n FROM saved_views WHERE board_id = ? AND user_id = ?').get(boardId, actor.id) as { n: number }).n;
    if (mine >= LIMITS.savedViewsPerUser) throw badRequest(`עד ${LIMITS.savedViewsPerUser} תצוגות שמורות ללוח`);
    const id = newId();
    const ts = nowIso();
    this.db
      .prepare('INSERT INTO saved_views (id, board_id, user_id, name, config, shared, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, boardId, actor.id, input.name, JSON.stringify(this.cleanConfig(boardId, input.config)), input.shared ? 1 : 0, ts, ts);
    return this.get(actor, id);
  }

  private get(actor: Actor, id: string): SavedView {
    const r = this.db.prepare('SELECT v.*, u.name AS owner_name FROM saved_views v JOIN users u ON u.id = v.user_id WHERE v.id = ?').get(id) as
      | Row
      | undefined;
    if (!r) throw notFound('התצוגה לא נמצאה');
    return this.toView(r, actor);
  }

  /** Only the author may edit a view; sharing / unsharing needs board-owner rights. */
  update(actor: Actor, id: string, input: { name?: string; config?: ViewConfig; shared?: boolean }): SavedView {
    const r = this.db.prepare('SELECT * FROM saved_views WHERE id = ?').get(id) as Row | undefined;
    if (!r) throw notFound('התצוגה לא נמצאה');
    const role = this.access.requireBoard(actor, r.board_id, 'viewer');
    if (r.user_id !== actor.id) throw notFound('התצוגה לא נמצאה'); // others' views are invisible / immutable
    if (input.shared !== undefined && role !== 'owner') throw forbidden('רק בעלי הלוח יכולים לשתף תצוגה');
    const sets: string[] = [];
    const params: unknown[] = [];
    if (input.name !== undefined) (sets.push('name = ?'), params.push(input.name));
    if (input.config !== undefined) (sets.push('config = ?'), params.push(JSON.stringify(this.cleanConfig(r.board_id, input.config))));
    if (input.shared !== undefined) (sets.push('shared = ?'), params.push(input.shared ? 1 : 0));
    sets.push('updated_at = ?');
    params.push(nowIso());
    this.db.prepare(`UPDATE saved_views SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
    return this.get(actor, id);
  }

  /** The author deletes their view; a board owner may also remove a shared view. */
  remove(actor: Actor, id: string): void {
    const r = this.db.prepare('SELECT * FROM saved_views WHERE id = ?').get(id) as Row | undefined;
    if (!r) throw notFound('התצוגה לא נמצאה');
    const role = this.access.requireBoard(actor, r.board_id, 'viewer');
    const allowed = r.user_id === actor.id || (r.shared === 1 && role === 'owner');
    if (!allowed) throw notFound('התצוגה לא נמצאה');
    this.db.prepare('DELETE FROM saved_views WHERE id = ?').run(id);
  }
}
