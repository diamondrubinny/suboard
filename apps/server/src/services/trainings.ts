import {
  addDaysIso,
  addMonthsIso,
  diffDaysIso,
  formatDateHe,
  todayIso,
  type MyTraining,
  type Training,
  type TrainingCell,
  type TrainingMatrix,
} from '@suboard/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../config.js';
import { nowIso, type DB } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import type { Actor } from './access.js';
import type { AuditService } from './audit.js';
import { csvField } from './export.js';
import type { NotificationService } from './notifications.js';

const SOON_DAYS = 30;

interface TrainingRow {
  id: string;
  name: string;
  description: string;
  validity_months: number;
  all_users: number;
}

/**
 * Training matrix (N6). Training records are employee data: only managers / admins see the matrix;
 * every user sees their own trainings. Reminders 30 days before expiry and on the expiry day.
 */
export class TrainingService {
  constructor(
    private readonly db: DB,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    private log: Pick<FastifyBaseLogger, 'error' | 'info'> = console,
  ) {}

  setLogger(log: Pick<FastifyBaseLogger, 'error' | 'info'>) {
    this.log = log;
  }

  private requireManager(actor: Actor): void {
    if (actor.role === 'member') throw forbidden('ניהול הדרכות מיועד למנהלים');
  }

  private all(): Training[] {
    const rows = this.db.prepare('SELECT * FROM trainings ORDER BY name').all() as TrainingRow[];
    const req = this.db.prepare('SELECT user_id FROM training_requirements WHERE training_id = ?');
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      validityMonths: r.validity_months,
      allUsers: r.all_users === 1,
      requiredUserIds: (req.all(r.id) as { user_id: string }[]).map((x) => x.user_id),
    }));
  }

  private one(id: string): Training {
    const t = this.all().find((x) => x.id === id);
    if (!t) throw notFound('ההדרכה לא נמצאה');
    return t;
  }

  /** Latest record per (training, user). */
  private latest(): Map<string, { id: string; completed_on: string }> {
    const rows = this.db
      .prepare(
        `SELECT r.id, r.training_id, r.user_id, r.completed_on FROM training_records r
         WHERE r.completed_on = (SELECT MAX(completed_on) FROM training_records x WHERE x.training_id = r.training_id AND x.user_id = r.user_id)`,
      )
      .all() as { id: string; training_id: string; user_id: string; completed_on: string }[];
    return new Map(rows.map((r) => [`${r.training_id}:${r.user_id}`, r]));
  }

  private cell(t: Training, userId: string, rec: { id: string; completed_on: string } | undefined, today: string): TrainingCell {
    const required = t.allUsers || t.requiredUserIds.includes(userId);
    if (!rec) return { state: required ? 'missing' : 'not_required', completedOn: null, expiresOn: null, recordId: null };
    const expiresOn = t.validityMonths ? addMonthsIso(rec.completed_on, t.validityMonths) : null;
    const state = !expiresOn ? 'valid' : expiresOn < today ? 'expired' : expiresOn <= addDaysIso(today, SOON_DAYS) ? 'expiring' : 'valid';
    return { state, completedOn: rec.completed_on, expiresOn, recordId: rec.id };
  }

  list(actor: Actor): Training[] {
    this.requireManager(actor);
    return this.all();
  }

  create(actor: Actor, input: { name: string; description: string; validityMonths: number; allUsers: boolean }): Training {
    this.requireManager(actor);
    const id = newId();
    const ts = nowIso();
    this.db
      .prepare('INSERT INTO trainings (id, name, description, validity_months, all_users, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, input.name, input.description, input.validityMonths, input.allUsers ? 1 : 0, ts, ts);
    return this.one(id);
  }

  update(actor: Actor, id: string, patch: { name?: string; description?: string; validityMonths?: number; allUsers?: boolean }): Training {
    this.requireManager(actor);
    const t = this.one(id);
    this.db
      .prepare('UPDATE trainings SET name = ?, description = ?, validity_months = ?, all_users = ?, updated_at = ? WHERE id = ?')
      .run(patch.name ?? t.name, patch.description ?? t.description, patch.validityMonths ?? t.validityMonths, (patch.allUsers ?? t.allUsers) ? 1 : 0, nowIso(), id);
    return this.one(id);
  }

  remove(actor: Actor, id: string): void {
    this.requireManager(actor);
    this.one(id);
    this.db.prepare('DELETE FROM trainings WHERE id = ?').run(id);
  }

  setRequirements(actor: Actor, id: string, userIds: string[]): Training {
    this.requireManager(actor);
    this.one(id);
    const ids = [...new Set(userIds)];
    if (ids.length) {
      const n = (this.db.prepare(`SELECT COUNT(*) AS n FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).get(...ids) as { n: number }).n;
      if (n !== ids.length) throw badRequest('משתמש לא קיים', { userIds: 'משתמש לא קיים' });
    }
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM training_requirements WHERE training_id = ?').run(id);
      const ins = this.db.prepare('INSERT INTO training_requirements (training_id, user_id) VALUES (?, ?)');
      for (const u of ids) ins.run(id, u);
    })();
    return this.one(id);
  }

  addRecords(actor: Actor, id: string, input: { userIds: string[]; completedOn: string; note: string }): number {
    this.requireManager(actor);
    this.one(id);
    if (input.completedOn > todayIso(this.config.timeZone)) throw badRequest('תאריך ההדרכה בעתיד', { completedOn: 'תאריך עתידי' });
    const ids = [...new Set(input.userIds)];
    const n = (this.db.prepare(`SELECT COUNT(*) AS n FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).get(...ids) as { n: number }).n;
    if (n !== ids.length) throw badRequest('משתמש לא קיים', { userIds: 'משתמש לא קיים' });
    const ins = this.db.prepare('INSERT INTO training_records (id, training_id, user_id, completed_on, note, recorded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const ts = nowIso();
    this.db.transaction(() => ids.forEach((u) => ins.run(newId(), id, u, input.completedOn, input.note, actor.id, ts)))();
    return ids.length;
  }

  removeRecord(actor: Actor, recordId: string): void {
    this.requireManager(actor);
    if (!this.db.prepare('DELETE FROM training_records WHERE id = ?').run(recordId).changes) throw notFound('הרשומה לא נמצאה');
  }

  matrix(actor: Actor, now: Date = new Date()): TrainingMatrix {
    this.requireManager(actor);
    const today = todayIso(this.config.timeZone, now);
    const trainings = this.all();
    const latest = this.latest();
    const users = this.db.prepare('SELECT id, name FROM users WHERE is_active = 1 ORDER BY name').all() as { id: string; name: string }[];
    const totals: TrainingMatrix['totals'] = Object.fromEntries(trainings.map((t) => [t.id, { required: 0, valid: 0, expiring: 0, expired: 0, missing: 0 }]));
    const rows = users.map((u) => {
      const cells: Record<string, TrainingCell> = {};
      for (const t of trainings) {
        const c = this.cell(t, u.id, latest.get(`${t.id}:${u.id}`), today);
        cells[t.id] = c;
        const required = t.allUsers || t.requiredUserIds.includes(u.id);
        if (required) {
          const tt = totals[t.id]!;
          tt.required++;
          if (c.state === 'valid' || c.state === 'expiring' || c.state === 'expired' || c.state === 'missing') tt[c.state]++;
        }
      }
      return { id: u.id, name: u.name, cells };
    });
    return { trainings, users: rows, totals };
  }

  matrixCsv(actor: Actor, ip: string): string {
    const m = this.matrix(actor);
    const label: Record<string, string> = { valid: 'בתוקף', expiring: 'פג בקרוב', expired: 'פג', missing: 'חסר', not_required: '' };
    const header = ['עובד/ת', ...m.trainings.map((t) => t.name)];
    const rows = m.users.map((u) => [
      u.name,
      ...m.trainings.map((t) => {
        const c = u.cells[t.id]!;
        return c.state === 'not_required' ? '' : `${label[c.state]}${c.expiresOn ? ` (עד ${formatDateHe(c.expiresOn)})` : c.completedOn ? ` (${formatDateHe(c.completedOn)})` : ''}`;
      }),
    ]);
    this.audit.log('data_export', { userId: actor.id, ip, meta: { scope: 'training_matrix', rows: rows.length, format: 'csv' } });
    return '﻿' + [header, ...rows].map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
  }

  mine(actor: Actor, now: Date = new Date()): MyTraining[] {
    const today = todayIso(this.config.timeZone, now);
    const latest = this.latest();
    const hist = this.db.prepare('SELECT id, completed_on, note FROM training_records WHERE training_id = ? AND user_id = ? ORDER BY completed_on DESC');
    return this.all()
      .filter((t) => t.allUsers || t.requiredUserIds.includes(actor.id) || latest.has(`${t.id}:${actor.id}`))
      .map((t) => ({
        // Members only learn their own requirement, not who else must attend.
        training: { ...t, requiredUserIds: [] },
        cell: this.cell(t, actor.id, latest.get(`${t.id}:${actor.id}`), today),
        history: (hist.all(t.id, actor.id) as { id: string; completed_on: string; note: string }[]).map((h) => ({ id: h.id, completedOn: h.completed_on, note: h.note })),
      }));
  }

  /** Daily: remind users 30 days before a required training expires and on the expiry day (once each). */
  runReminders(now: Date = new Date(), force = false): number {
    if (!force) {
      const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: this.config.timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now));
      if (hour < this.config.digestHour) return 0;
    }
    const today = todayIso(this.config.timeZone, now);
    const latest = this.latest();
    const users = this.db.prepare('SELECT id FROM users WHERE is_active = 1').all() as { id: string }[];
    let sent = 0;
    for (const t of this.all()) {
      if (!t.validityMonths) continue;
      for (const u of users) {
        if (!(t.allUsers || t.requiredUserIds.includes(u.id))) continue;
        const c = this.cell(t, u.id, latest.get(`${t.id}:${u.id}`), today);
        if (!c.expiresOn) continue;
        const left = diffDaysIso(today, c.expiresOn);
        const phase = left <= 0 ? 'expired' : left <= SOON_DAYS ? 'soon' : null;
        if (!phase) continue;
        const text = phase === 'expired' ? `תוקף ההדרכה "${t.name}" פג (${formatDateHe(c.expiresOn)})` : `תוקף ההדרכה "${t.name}" יפוג ב-${formatDateHe(c.expiresOn)}`;
        if (this.notifications.onModule(u.id, 'training', t.name, phase, text, '/trainings/me', `training:${t.id}:${c.expiresOn}:${phase}`)) sent++;
      }
    }
    if (sent) this.log.info({ sent }, 'training reminders');
    return sent;
  }
}
