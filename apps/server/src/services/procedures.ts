import type { PlanPin, Procedure, ProcedureAckReport, ProcedureVersion } from '@suboard/shared';
import { nowIso, type DB } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import type { AccessService, Actor } from './access.js';
import type { NotificationService } from './notifications.js';

interface ProcRow {
  id: string;
  code: string;
  title: string;
  category: string;
  audience: 'all' | 'users';
  current_version_id: string | null;
}
interface VersionRow {
  id: string;
  version: string;
  effective_on: string;
  summary: string;
  body: string;
  link: string | null;
  published_at: string;
  published_by_name: string | null;
}

/**
 * Procedure library with versions and "read and acknowledged" (קראתי ואישרתי). Each version needs its
 * own acknowledgement; publishing a new version asks the whole audience to acknowledge again.
 */
export class ProcedureService {
  constructor(
    private readonly db: DB,
    private readonly notifications: NotificationService,
  ) {}

  private isManager = (a: Actor) => a.role !== 'member';

  private audienceIds(p: ProcRow): string[] {
    const rows =
      p.audience === 'all'
        ? this.db.prepare('SELECT id AS user_id FROM users WHERE is_active = 1').all()
        : this.db.prepare('SELECT a.user_id FROM procedure_audience a JOIN users u ON u.id = a.user_id WHERE a.procedure_id = ? AND u.is_active = 1').all(p.id);
    return (rows as { user_id: string }[]).map((r) => r.user_id);
  }

  private inAudience(p: ProcRow, userId: string): boolean {
    return p.audience === 'all' || Boolean(this.db.prepare('SELECT 1 FROM procedure_audience WHERE procedure_id = ? AND user_id = ?').get(p.id, userId));
  }

  private row(id: string): ProcRow {
    const r = this.db.prepare('SELECT * FROM procedures WHERE id = ?').get(id) as ProcRow | undefined;
    if (!r) throw notFound('הנוהל לא נמצא');
    return r;
  }

  private version(id: string | null): ProcedureVersion | null {
    if (!id) return null;
    const v = this.db
      .prepare('SELECT v.*, u.name AS published_by_name FROM procedure_versions v LEFT JOIN users u ON u.id = v.published_by WHERE v.id = ?')
      .get(id) as VersionRow | undefined;
    return v
      ? { id: v.id, version: v.version, effectiveOn: v.effective_on, summary: v.summary, body: v.body, link: v.link, publishedAt: v.published_at, publishedByName: v.published_by_name }
      : null;
  }

  private toProcedure(actor: Actor, p: ProcRow, withBody: boolean): Procedure {
    const current = this.version(p.current_version_id);
    const versions = (this.db.prepare('SELECT id, version, effective_on FROM procedure_versions WHERE procedure_id = ? ORDER BY published_at DESC').all(p.id) as { id: string; version: string; effective_on: string }[]).map(
      (v) => ({ id: v.id, version: v.version, effectiveOn: v.effective_on }),
    );
    let ackStats: Procedure['ackStats'] = null;
    if (this.isManager(actor) && current) {
      const audience = new Set(this.audienceIds(p));
      const acked = (this.db.prepare('SELECT user_id FROM procedure_acks WHERE version_id = ?').all(current.id) as { user_id: string }[]).filter((r) => audience.has(r.user_id)).length;
      ackStats = { acked, total: audience.size };
    }
    const myAck = current ? (this.db.prepare('SELECT acked_at FROM procedure_acks WHERE version_id = ? AND user_id = ?').get(current.id, actor.id) as { acked_at: string } | undefined) : undefined;
    return {
      id: p.id,
      code: p.code,
      title: p.title,
      category: p.category,
      audience: p.audience,
      userIds: this.isManager(actor) && p.audience === 'users' ? (this.db.prepare('SELECT user_id FROM procedure_audience WHERE procedure_id = ?').all(p.id) as { user_id: string }[]).map((r) => r.user_id) : [],
      current: current && !withBody ? { ...current, body: '' } : current,
      versions,
      ackStats,
      myAckAt: myAck?.acked_at ?? null,
      forMe: this.inAudience(p, actor.id),
    };
  }

  /** Managers see every procedure; others only those addressed to them that have a published version. */
  list(actor: Actor): Procedure[] {
    const rows = this.db.prepare('SELECT * FROM procedures ORDER BY category, code').all() as ProcRow[];
    return rows.filter((p) => this.isManager(actor) || (p.current_version_id && this.inAudience(p, actor.id))).map((p) => this.toProcedure(actor, p, false));
  }

  get(actor: Actor, id: string): Procedure {
    const p = this.row(id);
    if (!this.isManager(actor) && !(p.current_version_id && this.inAudience(p, actor.id))) throw notFound('הנוהל לא נמצא');
    return this.toProcedure(actor, p, true);
  }

  private setAudience(id: string, audience: 'all' | 'users', userIds: string[]): void {
    const ids = [...new Set(userIds)];
    if (audience === 'users') {
      if (!ids.length) throw badRequest('יש לבחור לפחות משתמש אחד', { userIds: 'חובה' });
      const n = (this.db.prepare(`SELECT COUNT(*) AS n FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).get(...ids) as { n: number }).n;
      if (n !== ids.length) throw badRequest('משתמש לא קיים', { userIds: 'משתמש לא קיים' });
    }
    this.db.prepare('DELETE FROM procedure_audience WHERE procedure_id = ?').run(id);
    if (audience === 'users') {
      const ins = this.db.prepare('INSERT INTO procedure_audience (procedure_id, user_id) VALUES (?, ?)');
      ids.forEach((u) => ins.run(id, u));
    }
  }

  create(actor: Actor, input: { code: string; title: string; category: string; audience: 'all' | 'users'; userIds: string[] }): Procedure {
    if (!this.isManager(actor)) throw forbidden('ניהול נהלים מיועד למנהלים');
    if (this.db.prepare('SELECT 1 FROM procedures WHERE code = ? COLLATE NOCASE').get(input.code)) throw badRequest('קוד נוהל קיים', { code: 'קיים' });
    const id = newId();
    const ts = nowIso();
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO procedures (id, code, title, category, audience, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, input.code, input.title, input.category, input.audience, ts, ts);
      this.setAudience(id, input.audience, input.userIds);
    })();
    return this.get(actor, id);
  }

  update(actor: Actor, id: string, patch: { title?: string; category?: string; audience?: 'all' | 'users'; userIds?: string[] }): Procedure {
    if (!this.isManager(actor)) throw forbidden('ניהול נהלים מיועד למנהלים');
    const p = this.row(id);
    this.db.transaction(() => {
      this.db.prepare('UPDATE procedures SET title = ?, category = ?, audience = ?, updated_at = ? WHERE id = ?').run(patch.title ?? p.title, patch.category ?? p.category, patch.audience ?? p.audience, nowIso(), id);
      if (patch.audience || patch.userIds) this.setAudience(id, patch.audience ?? p.audience, patch.userIds ?? []);
    })();
    return this.get(actor, id);
  }

  publish(actor: Actor, id: string, input: { version: string; effectiveOn: string; summary: string; body: string; link: string | null }): Procedure {
    if (!this.isManager(actor)) throw forbidden('ניהול נהלים מיועד למנהלים');
    const p = this.row(id);
    if (!input.body.trim() && !input.link) throw badRequest('יש להזין את תוכן הנוהל או קישור למסמך', { body: 'חובה' });
    if (this.db.prepare('SELECT 1 FROM procedure_versions WHERE procedure_id = ? AND version = ?').get(id, input.version)) throw badRequest('גרסה בשם זה כבר קיימת', { version: 'קיימת' });
    const vid = newId();
    this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO procedure_versions (id, procedure_id, version, effective_on, summary, body, link, published_by, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(vid, id, input.version, input.effectiveOn, input.summary, input.body, input.link, actor.id, nowIso());
      this.db.prepare('UPDATE procedures SET current_version_id = ?, updated_at = ? WHERE id = ?').run(vid, nowIso(), id);
    })();
    for (const u of this.audienceIds(p)) {
      this.notifications.onModule(u, 'procedure', `${p.code} ${p.title}`, id, `נוהל ${p.code} "${p.title}" עודכן (גרסה ${input.version}) — נדרש אישור קריאה`, `/procedures/${id}`, `procedure:${vid}`);
    }
    return this.get(actor, id);
  }

  /** "קראתי ואישרתי" — only the current version, only by someone in the audience. */
  acknowledge(actor: Actor, versionId: string): Procedure {
    const v = this.db.prepare('SELECT procedure_id FROM procedure_versions WHERE id = ?').get(versionId) as { procedure_id: string } | undefined;
    if (!v) throw notFound('הגרסה לא נמצאה');
    const p = this.row(v.procedure_id);
    if (!this.inAudience(p, actor.id)) throw notFound('הנוהל לא נמצא');
    if (p.current_version_id !== versionId) throw badRequest('ניתן לאשר רק את הגרסה העדכנית');
    this.db.prepare('INSERT OR IGNORE INTO procedure_acks (version_id, user_id, acked_at) VALUES (?, ?, ?)').run(versionId, actor.id, nowIso());
    return this.get(actor, p.id);
  }

  report(actor: Actor, id: string): ProcedureAckReport {
    if (!this.isManager(actor)) throw forbidden();
    const p = this.row(id);
    if (!p.current_version_id) throw badRequest('לנוהל אין גרסה מפורסמת');
    const names = new Map((this.db.prepare('SELECT id, name FROM users').all() as { id: string; name: string }[]).map((u) => [u.id, u.name]));
    const acks = new Map((this.db.prepare('SELECT user_id, acked_at FROM procedure_acks WHERE version_id = ?').all(p.current_version_id) as { user_id: string; acked_at: string }[]).map((r) => [r.user_id, r.acked_at]));
    const audience = this.audienceIds(p);
    return {
      versionId: p.current_version_id,
      acked: audience.filter((u) => acks.has(u)).map((u) => ({ userId: u, name: names.get(u) ?? '', at: acks.get(u)! })),
      pending: audience.filter((u) => !acks.has(u)).map((u) => ({ userId: u, name: names.get(u) ?? '' })),
    };
  }

  /** Procedures waiting for the actor's acknowledgement. */
  pending(actor: Actor): Procedure[] {
    return this.list(actor).filter((p) => p.forMe && p.current && !p.myAckAt);
  }
}

/** Hazards pinned on a floor-plan image (an attachment of an item, N10). */
export class PlanService {
  constructor(
    private readonly db: DB,
    private readonly access: AccessService,
  ) {}

  /** The plan must be a clean (scanned) image on a board the actor can see. */
  private plan(actor: Actor, attachmentId: string, minRole: 'viewer' | 'editor'): { boardId: string } {
    const a = this.db.prepare('SELECT board_id, mime, status FROM attachments WHERE id = ?').get(attachmentId) as { board_id: string; mime: string; status: string } | undefined;
    if (!a) throw notFound('הקובץ לא נמצא');
    this.access.requireBoard(actor, a.board_id, minRole);
    if (a.status !== 'clean') throw badRequest('התוכנית עדיין בסריקה או נחסמה');
    if (!/^image\/(png|jpeg|webp)$/.test(a.mime)) throw badRequest('תוכנית קומה חייבת להיות תמונה (PNG / JPG / WEBP)');
    return { boardId: a.board_id };
  }

  get(actor: Actor, attachmentId: string): PlanPin[] {
    const { boardId } = this.plan(actor, attachmentId, 'viewer');
    return this.db
      .prepare('SELECT p.item_id AS itemId, p.x, p.y FROM plan_pins p JOIN items i ON i.id = p.item_id WHERE p.attachment_id = ? AND i.board_id = ? AND i.deleted_at IS NULL')
      .all(attachmentId, boardId) as PlanPin[];
  }

  set(actor: Actor, attachmentId: string, pins: PlanPin[]): PlanPin[] {
    const { boardId } = this.plan(actor, attachmentId, 'editor');
    const ids = [...new Set(pins.map((p) => p.itemId))];
    if (ids.length !== pins.length) throw badRequest('פריט מופיע פעמיים');
    if (ids.length) {
      const n = (this.db.prepare(`SELECT COUNT(*) AS n FROM items WHERE board_id = ? AND deleted_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`).get(boardId, ...ids) as { n: number }).n;
      if (n !== ids.length) throw badRequest('ניתן לנעוץ רק פריטים מאותו לוח', { pins: 'פריט לא תקין' });
    }
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM plan_pins WHERE attachment_id = ?').run(attachmentId);
      const ins = this.db.prepare('INSERT INTO plan_pins (attachment_id, item_id, x, y) VALUES (?, ?, ?, ?)');
      pins.forEach((p) => ins.run(attachmentId, p.itemId, Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100));
    })();
    return this.get(actor, attachmentId);
  }

  /** Clean image attachments of a board (candidates to use as floor plans). */
  plans(actor: Actor, boardId: string): { id: string; name: string; itemId: string; itemName: string; pins: number }[] {
    this.access.requireBoard(actor, boardId, 'viewer');
    return this.db
      .prepare(
        `SELECT a.id, a.original_name AS name, a.item_id AS itemId, i.name AS itemName, (SELECT COUNT(*) FROM plan_pins p WHERE p.attachment_id = a.id) AS pins
         FROM attachments a JOIN items i ON i.id = a.item_id AND i.deleted_at IS NULL
         WHERE a.board_id = ? AND a.status = 'clean' AND a.mime IN ('image/png','image/jpeg','image/webp') ORDER BY a.created_at DESC`,
      )
      .all(boardId) as { id: string; name: string; itemId: string; itemName: string; pins: number }[];
  }
}
