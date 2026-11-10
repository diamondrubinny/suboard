import {
  PERMIT_BLOCKING_PAIRS,
  PERMIT_PRECAUTIONS,
  PERMIT_TYPE_LABELS,
  type Permit,
  type PermitConflict,
  type PermitStatus,
  type PermitType,
} from '@suboard/shared';
import type { FastifyBaseLogger } from 'fastify';
import { nowIso, parseJson, type DB } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { AppError, badRequest, forbidden, notFound } from '../lib/errors.js';
import type { Actor } from './access.js';
import type { NotificationService } from './notifications.js';

interface PermitRow {
  id: string;
  seq: number;
  type: PermitType;
  title: string;
  location: string;
  location_key: string;
  description: string;
  contractor: string;
  starts_at: string;
  ends_at: string;
  status: PermitStatus;
  requester_id: string | null;
  requester_name: string | null;
  precautions: string;
  conflict_note: string;
  created_at: string;
}

/** Same place = same text after trimming, lower-casing and collapsing whitespace / punctuation. */
export const locationKey = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[\s,.\-–—'"״׳]+/g, ' ')
    .trim();

const isBlocking = (a: PermitType, b: PermitType) => PERMIT_BLOCKING_PAIRS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
const number = (seq: number) => `P-${String(seq).padStart(4, '0')}`;

/**
 * Digital work permits (N7): multi-step approval in a fixed order, automatic activation / expiry by
 * time window, and conflict detection at the same location. An approval is a recorded action of a
 * signed-in user (identity, time, comment) in an append-only log — **not** a legally qualified
 * electronic signature (requires legal review if one is needed).
 */
export class PermitService {
  constructor(
    private readonly db: DB,
    private readonly notifications: NotificationService,
    private log: Pick<FastifyBaseLogger, 'error' | 'info'> = console,
  ) {}

  setLogger(log: Pick<FastifyBaseLogger, 'error' | 'info'>) {
    this.log = log;
  }

  private row(id: string): PermitRow {
    const r = this.db
      .prepare('SELECT p.*, u.name AS requester_name FROM permits p LEFT JOIN users u ON u.id = p.requester_id WHERE p.id = ?')
      .get(id) as PermitRow | undefined;
    if (!r) throw notFound('ההיתר לא נמצא');
    return r;
  }

  private approvals(id: string) {
    return this.db
      .prepare(
        `SELECT a.ord, a.user_id, COALESCE(u.name, 'משתמש שנמחק') AS user_name, a.decision, a.comment, a.decided_at
         FROM permit_approvals a LEFT JOIN users u ON u.id = a.user_id WHERE a.permit_id = ? ORDER BY a.ord`,
      )
      .all(id) as { ord: number; user_id: string; user_name: string; decision: 'approved' | 'rejected' | null; comment: string; decided_at: string | null }[];
  }

  private canView(actor: Actor, r: PermitRow): boolean {
    if (actor.role !== 'member' || r.requester_id === actor.id) return true;
    return this.approvals(r.id).some((a) => a.user_id === actor.id);
  }

  private event(permitId: string, userId: string | null, action: string, comment = ''): void {
    this.db.prepare('INSERT INTO permit_events (id, permit_id, user_id, action, comment, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(newId(), permitId, userId, action, comment, nowIso());
  }

  /** Pending / approved permits at the same location whose windows overlap [start, end). */
  conflicts(location: string, type: PermitType, startsAt: string, endsAt: string, excludeId?: string): PermitConflict[] {
    const rows = this.db
      .prepare(
        `SELECT p.*, NULL AS requester_name FROM permits p
         WHERE p.location_key = ? AND p.status IN ('pending','approved') AND p.starts_at < ? AND p.ends_at > ? AND p.id <> ?`,
      )
      .all(locationKey(location), endsAt, startsAt, excludeId ?? '') as PermitRow[];
    return rows.map((r) => ({
      permitId: r.id,
      number: number(r.seq),
      title: r.title,
      type: r.type,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      status: r.status,
      severity: isBlocking(type, r.type) ? 'block' : 'warn',
    }));
  }

  /** Conflict preview for the request form. Members see the clash, not other permits' titles. */
  check(actor: Actor, input: { location: string; type: PermitType; startsAt: string; endsAt: string }): PermitConflict[] {
    return this.conflicts(input.location, input.type, input.startsAt, input.endsAt).map((c) => (actor.role === 'member' ? { ...c, title: '' } : c));
  }

  private toPermit(actor: Actor, r: PermitRow, now = Date.now()): Permit {
    const approvals = this.approvals(r.id);
    const next = r.status === 'pending' ? approvals.find((a) => a.decision === null) : undefined;
    const events = (
      this.db
        .prepare('SELECT e.created_at, u.name AS user_name, e.action, e.comment FROM permit_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.permit_id = ? ORDER BY e.created_at, e.rowid')
        .all(r.id) as { created_at: string; user_name: string | null; action: string; comment: string }[]
    ).map((e) => ({ at: e.created_at, userName: e.user_name, action: e.action, comment: e.comment }));
    const conflicts = ['pending', 'approved'].includes(r.status) ? this.conflicts(r.location, r.type, r.starts_at, r.ends_at, r.id) : [];
    return {
      id: r.id,
      number: number(r.seq),
      type: r.type,
      title: r.title,
      location: r.location,
      description: r.description,
      contractor: r.contractor,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      status: r.status,
      active: r.status === 'approved' && Date.parse(r.starts_at) <= now && now < Date.parse(r.ends_at),
      requesterId: r.requester_id ?? '',
      requesterName: r.requester_name ?? 'משתמש שנמחק',
      precautions: parseJson<string[]>(r.precautions, []),
      conflictNote: r.conflict_note,
      approvals: approvals.map((a) => ({ order: a.ord, userId: a.user_id, userName: a.user_name, decision: a.decision, comment: a.comment, decidedAt: a.decided_at })),
      nextApproverId: next?.user_id ?? null,
      events,
      conflicts: actor.role === 'member' ? conflicts.map((c) => ({ ...c, title: '' })) : conflicts,
      createdAt: r.created_at,
    };
  }

  list(actor: Actor, scope: 'mine' | 'approvals' | 'all' = 'all'): Permit[] {
    const rows = this.db.prepare('SELECT p.*, u.name AS requester_name FROM permits p LEFT JOIN users u ON u.id = p.requester_id ORDER BY p.starts_at DESC LIMIT 500').all() as PermitRow[];
    return rows
      .filter((r) => this.canView(actor, r))
      .map((r) => this.toPermit(actor, r))
      .filter((p) => (scope === 'mine' ? p.requesterId === actor.id : scope === 'approvals' ? p.nextApproverId === actor.id : true));
  }

  get(actor: Actor, id: string): Permit {
    const r = this.row(id);
    if (!this.canView(actor, r)) throw notFound('ההיתר לא נמצא');
    return this.toPermit(actor, r);
  }

  create(
    actor: Actor,
    input: { type: PermitType; title: string; location: string; description: string; contractor: string; startsAt: string; endsAt: string; approverIds: string[]; precautions: string[]; conflictNote: string },
  ): Permit {
    if (Date.parse(input.endsAt) < Date.now()) throw badRequest('חלון הזמן כבר הסתיים', { endsAt: 'בעבר' });
    if (input.approverIds.includes(actor.id)) throw badRequest('מבקש/ת ההיתר לא יכול/ה לאשר אותו', { approverIds: 'הפרדת תפקידים' });
    const found = this.db
      .prepare(`SELECT COUNT(*) AS n FROM users WHERE is_active = 1 AND id IN (${input.approverIds.map(() => '?').join(',')})`)
      .get(...input.approverIds) as { n: number };
    if (found.n !== input.approverIds.length) throw badRequest('מאשר/ת לא תקין/ה', { approverIds: 'משתמש לא פעיל' });
    const required = PERMIT_PRECAUTIONS[input.type].map((p) => p.id);
    const missing = required.filter((id) => !input.precautions.includes(id));
    if (missing.length) throw badRequest('יש לאשר את כל אמצעי הזהירות לסוג ההיתר', { precautions: 'חסר' });
    const conflicts = this.conflicts(input.location, input.type, input.startsAt, input.endsAt);
    if (conflicts.some((c) => c.severity === 'block') && !input.conflictNote) {
      throw new AppError(409, 'PERMIT_CONFLICT', 'קיים היתר מתנגש באותו מיקום וזמן. יש לתאם, או לנמק במפורש מדוע העבודה בטוחה.', { conflictNote: 'נדרש נימוק' });
    }
    const id = newId();
    const ts = nowIso();
    this.db.transaction(() => {
      const seq = ((this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM permits').get() as { m: number }).m ?? 0) + 1;
      this.db
        .prepare(
          `INSERT INTO permits (id, seq, type, title, location, location_key, description, contractor, starts_at, ends_at, status, requester_id, precautions, conflict_note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
        )
        .run(id, seq, input.type, input.title, input.location, locationKey(input.location), input.description, input.contractor, input.startsAt, input.endsAt, actor.id, JSON.stringify(required), input.conflictNote, ts, ts);
      const ins = this.db.prepare('INSERT INTO permit_approvals (permit_id, ord, user_id) VALUES (?, ?, ?)');
      input.approverIds.forEach((u, i) => ins.run(id, i + 1, u));
      this.event(id, actor.id, 'requested', input.conflictNote ? `נימוק התנגשות: ${input.conflictNote}` : '');
    })();
    const p = this.get(actor, id);
    this.notifyApprover(p);
    return p;
  }

  private notifyApprover(p: Permit): void {
    if (!p.nextApproverId) return;
    this.notifications.onModule(p.nextApproverId, 'permit', `${p.number} ${p.title}`, p.id, `היתר ${p.number} (${PERMIT_TYPE_LABELS[p.type]}) ממתין לאישורך`, `/permits/${p.id}`);
  }

  private notifyRequester(p: Permit, text: string): void {
    if (p.requesterId) this.notifications.onModule(p.requesterId, 'permit', `${p.number} ${p.title}`, p.id, text, `/permits/${p.id}`);
  }

  decide(actor: Actor, id: string, decision: 'approved' | 'rejected', comment: string): Permit {
    const r = this.row(id);
    if (!this.canView(actor, r)) throw notFound('ההיתר לא נמצא');
    if (r.status !== 'pending') throw badRequest('ההיתר אינו ממתין לאישור');
    const next = this.approvals(id).find((a) => a.decision === null);
    if (!next || next.user_id !== actor.id) throw forbidden('זה לא תורך לאשר את ההיתר');
    if (Date.parse(r.ends_at) < Date.now()) throw badRequest('חלון הזמן של ההיתר כבר הסתיים');
    if (decision === 'rejected' && !comment) throw badRequest('יש לנמק דחייה', { comment: 'שדה חובה' });
    const ts = nowIso();
    this.db.transaction(() => {
      this.db.prepare('UPDATE permit_approvals SET decision = ?, comment = ?, decided_at = ? WHERE permit_id = ? AND ord = ?').run(decision, comment, ts, id, next.ord);
      this.event(id, actor.id, decision, comment);
      const remaining = this.approvals(id).some((a) => a.decision === null);
      if (decision === 'rejected') this.db.prepare("UPDATE permits SET status = 'rejected', updated_at = ? WHERE id = ?").run(ts, id);
      else if (!remaining) this.db.prepare("UPDATE permits SET status = 'approved', updated_at = ? WHERE id = ?").run(ts, id);
    })();
    const p = this.get(actor, id);
    if (p.status === 'rejected') this.notifyRequester(p, `היתר ${p.number} נדחה`);
    else if (p.status === 'approved') this.notifyRequester(p, `היתר ${p.number} אושר`);
    else this.notifyApprover(p);
    return p;
  }

  /** Close (work finished) or cancel. Requester, an approver, or a manager / admin. */
  finish(actor: Actor, id: string, action: 'closed' | 'cancelled', comment: string): Permit {
    const r = this.row(id);
    if (!this.canView(actor, r)) throw notFound('ההיתר לא נמצא');
    const allowedFrom: PermitStatus[] = action === 'closed' ? ['approved'] : ['pending', 'approved'];
    if (!allowedFrom.includes(r.status)) throw badRequest(action === 'closed' ? 'אפשר לסגור רק היתר מאושר' : 'אי אפשר לבטל היתר במצב זה');
    if (action === 'closed' && Date.parse(r.starts_at) > Date.now()) throw badRequest('העבודה עוד לא התחילה — אפשר לבטל את ההיתר');
    this.db.transaction(() => {
      this.db.prepare('UPDATE permits SET status = ?, updated_at = ? WHERE id = ?').run(action, nowIso(), id);
      this.event(id, actor.id, action, comment);
    })();
    const p = this.get(actor, id);
    if (actor.id !== p.requesterId) this.notifyRequester(p, action === 'closed' ? `היתר ${p.number} נסגר` : `היתר ${p.number} בוטל`);
    return p;
  }

  /** Every few minutes: approved / pending permits whose window ended become expired. */
  expireDue(now: Date = new Date()): number {
    const rows = this.db.prepare("SELECT id FROM permits WHERE status IN ('approved','pending') AND ends_at <= ?").all(now.toISOString()) as { id: string }[];
    for (const r of rows) {
      const claimed = this.db.prepare("UPDATE permits SET status = 'expired', updated_at = ? WHERE id = ? AND status IN ('approved','pending')").run(nowIso(), r.id).changes;
      if (!claimed) continue;
      this.event(r.id, null, 'expired');
      const row = this.row(r.id);
      if (row.requester_id) this.notifications.onModule(row.requester_id, 'permit', `${number(row.seq)} ${row.title}`, row.id, `תוקף היתר ${number(row.seq)} פג`, `/permits/${row.id}`);
    }
    if (rows.length) this.log.info({ expired: rows.length }, 'permits expired');
    return rows.length;
  }
}
