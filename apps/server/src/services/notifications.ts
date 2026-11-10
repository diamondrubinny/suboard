import {
  addDaysIso,
  findDueColumn,
  findPrimaryStatusColumn,
  formatDateHe,
  isItemDone,
  todayIso,
  type AppNotification,
  type NotificationKind,
} from '@suboard/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../config.js';
import { nowIso, type DB } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { escapeHtml, type Mailer } from '../lib/mailer.js';
import type { AccessService, Actor } from './access.js';
import type { BoardService } from './boards.js';
import { toItem, type ItemRow } from './mappers.js';

interface NotificationRow {
  id: string;
  kind: NotificationKind;
  board_id: string | null;
  item_id: string | null;
  title: string;
  actor_name: string | null;
  detail: string | null;
  read_at: string | null;
  created_at: string;
}

const KIND_TEXT: Record<NotificationKind, string> = {
  assigned: 'שויכת לפריט',
  overdue: 'פריט באיחור',
  due_tomorrow: 'תאריך יעד מחר',
  mentioned: 'הוזכרת',
  automation: 'אוטומציה',
  report: 'דוח מתוזמן',
  effectiveness: 'בדיקת אפקטיביות',
  monthly: 'מבט מנהל חודשי',
  training: 'הדרכה',
  permit: 'היתר עבודה',
  procedure: 'נוהל',
  followed: 'פריט במעקב',
  reply: 'תשובה לעדכון',
};

type Sender = { id: string | null; name: string };
/** `plain` lines are rendered without a link (e.g. report totals). */
export type MailLine = { text: string; boardId: string; itemId?: string | null; plain?: boolean; /** Absolute path inside the app, overrides the board/item link. */ href?: string };

/**
 * In-app notifications plus optional e-mail. E-mails carry only the item name, board name and a
 * link — never free-text content (data minimisation). All user content is HTML-escaped.
 */
export class NotificationService {
  constructor(
    private readonly db: DB,
    private readonly config: AppConfig,
    private readonly access: AccessService,
    private readonly boards: BoardService,
    private readonly mailer: Mailer | null,
    private log: Pick<FastifyBaseLogger, 'error' | 'info'> = console,
  ) {}

  setLogger(log: Pick<FastifyBaseLogger, 'error' | 'info'>) {
    this.log = log;
  }

  get emailEnabled(): boolean {
    return this.mailer !== null;
  }

  private insert(userId: string, kind: NotificationKind, boardId: string | null, itemId: string | null, title: string, actorId: string | null, detail: string | null = null): string {
    const id = newId();
    this.db
      .prepare('INSERT INTO notifications (id, user_id, kind, board_id, item_id, title, actor_id, detail, created_at, day) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, userId, kind, boardId, itemId, title, actorId, detail, nowIso(), todayIso(this.config.timeZone));
    return id;
  }

  private boardName(boardId: string): string {
    return (this.db.prepare('SELECT name FROM boards WHERE id = ?').get(boardId) as { name: string } | undefined)?.name ?? '';
  }

  /**
   * Of the given users, those that are active and can still see the board right now (re-checked at
   * send time: someone removed from the board after a rule / report was configured gets nothing).
   */
  usersWithAccess(boardId: string, userIds: Iterable<string>): string[] {
    const out: string[] = [];
    const get = this.db.prepare('SELECT id, name, role FROM users WHERE id = ? AND is_active = 1');
    for (const id of new Set(userIds)) {
      const u = get.get(id) as Actor | undefined;
      if (u && this.access.boardRole(u, boardId)) out.push(id);
    }
    return out;
  }

  /** Automation "notify" action. The message is written by a board owner (not item content). */
  onAutomation(boardId: string, itemId: string, itemName: string, ruleName: string, message: string, userIds: string[]): number {
    const boardName = this.boardName(boardId);
    const recipients = this.usersWithAccess(boardId, userIds);
    for (const userId of recipients) {
      const id = this.insert(userId, 'automation', boardId, itemId, itemName, null, message);
      void this.emailOne(userId, id, {
        subject: `SUBoard: ${ruleName}`.slice(0, 150),
        lines: [{ text: `${message} — "${itemName}" (${boardName})`, boardId, itemId }],
      });
    }
    return recipients.length;
  }

  /** Effectiveness check of an investigation is due (once per due date). */
  onEffectivenessDue(boardId: string, itemId: string, itemName: string, userIds: string[]): number {
    const recipients = this.usersWithAccess(boardId, userIds);
    const boardName = this.boardName(boardId);
    for (const userId of recipients) {
      const id = this.insert(userId, 'effectiveness', boardId, itemId, itemName, null, null);
      void this.emailOne(userId, id, {
        subject: 'SUBoard: הגיע מועד בדיקת אפקטיביות',
        lines: [{ text: `הגיע מועד בדיקת האפקטיביות של הפעולות בתחקיר "${itemName}" (${boardName})`, boardId, itemId }],
      });
    }
    return recipients.length;
  }

  /**
   * Notification for a module outside boards (trainings, permits, procedures). `detail` carries the
   * target id the UI links to; `href` is the in-app path used in the e-mail. Optional `dedupeKey`
   * makes it once-only (same user, kind and key).
   */
  onModule(userId: string, kind: 'training' | 'permit' | 'procedure', title: string, detail: string, text: string, href: string, dedupeKey?: string): boolean {
    if (dedupeKey && this.db.prepare('SELECT 1 FROM notifications WHERE user_id = ? AND kind = ? AND day = ?').get(userId, kind, dedupeKey)) return false;
    const id = newId();
    this.db
      .prepare('INSERT INTO notifications (id, user_id, kind, board_id, item_id, title, actor_id, detail, created_at, day) VALUES (?, ?, ?, NULL, NULL, ?, NULL, ?, ?, ?)')
      .run(id, userId, kind, title, detail, nowIso(), dedupeKey ?? todayIso(this.config.timeZone));
    void this.emailMany(userId, [id], { subject: `SUBoard: ${text}`.slice(0, 150), lines: [{ text, boardId: '', href }] });
    return true;
  }

  /** Monthly management report: in-app notification (title = month label) + e-mail. */
  async onMonthly(userId: string, month: string, title: string, lines: MailLine[]): Promise<number> {
    const id = this.insert(userId, 'monthly', null, null, title, null, month);
    await this.emailMany(userId, [id], { subject: `SUBoard: ${title}`, lines: [...lines, { text: 'לדוח המלא במערכת', boardId: '', href: `/reports/monthly?month=${month}` }] });
    return 1;
  }

  /** Scheduled report delivery: in-app notification (links to the board summary) + optional e-mail. */
  async onReport(boardId: string, reportName: string, userIds: string[], lines: MailLine[]): Promise<number> {
    const boardName = this.boardName(boardId);
    const recipients = this.usersWithAccess(boardId, userIds);
    for (const userId of recipients) {
      const id = this.insert(userId, 'report', boardId, null, boardName, null, reportName);
      await this.emailMany(userId, [id], {
        subject: `SUBoard: ${reportName} — ${boardName}`.slice(0, 150),
        lines,
      });
    }
    return recipients.length;
  }

  /** Called after an item's person columns change: notifies newly-added assignees (not the actor). */
  onAssigned(actor: Sender, boardId: string, itemId: string, itemName: string, newAssignees: string[]): void {
    const boardName = (this.db.prepare('SELECT name FROM boards WHERE id = ?').get(boardId) as { name: string } | undefined)?.name ?? '';
    for (const userId of new Set(newAssignees)) {
      if (userId === actor.id) continue;
      const id = this.insert(userId, 'assigned', boardId, itemId, itemName, actor.id);
      void this.emailOne(userId, id, {
        subject: 'SUBoard: שויכת לפריט',
        lines: [{ text: `${actor.name} שייך/ה אותך לפריט "${itemName}" בלוח "${boardName}".`, boardId, itemId }],
      });
    }
  }

  /** Called after an update mentions people (already validated as board members). */
  onMentioned(actor: Sender, boardId: string, itemId: string, itemName: string, userIds: string[]): void {
    const boardName = (this.db.prepare('SELECT name FROM boards WHERE id = ?').get(boardId) as { name: string } | undefined)?.name ?? '';
    for (const userId of new Set(userIds)) {
      if (userId === actor.id) continue;
      const id = this.insert(userId, 'mentioned', boardId, itemId, itemName, actor.id);
      void this.emailOne(userId, id, {
        subject: 'SUBoard: הוזכרת בעדכון',
        lines: [{ text: `${actor.name} הזכיר/ה אותך בעדכון על "${itemName}" בלוח "${boardName}".`, boardId, itemId }],
      });
    }
  }

  /** Someone replied to the user's update. */
  onReply(actor: Sender, boardId: string, itemId: string, itemName: string, userId: string): void {
    if (userId === actor.id || !this.usersWithAccess(boardId, [userId]).length) return;
    const id = this.insert(userId, 'reply', boardId, itemId, itemName, actor.id);
    void this.emailOne(userId, id, {
      subject: 'SUBoard: תשובה לעדכון שלך',
      lines: [{ text: `${actor.name} ענה/תה לעדכון שלך על "${itemName}" בלוח "${this.boardName(boardId)}".`, boardId, itemId }],
    });
  }

  /**
   * Activity on a followed item. Access is re-checked now (someone removed from the board stops
   * hearing about it). While a previous notice for the same item is still unread it is refreshed in
   * place (no second notice, no second e-mail) — following never floods the inbox.
   */
  onFollowed(actorId: string, boardId: string, itemId: string, itemName: string, what: 'update' | 'status' | 'moved', userIds: string[]): number {
    const actorName = (this.db.prepare('SELECT name FROM users WHERE id = ?').get(actorId) as { name: string } | undefined)?.name ?? '';
    const pending = this.db.prepare("SELECT id FROM notifications WHERE user_id = ? AND item_id = ? AND kind = 'followed' AND read_at IS NULL");
    const refresh = this.db.prepare('UPDATE notifications SET title = ?, actor_id = ?, detail = ?, created_at = ?, day = ? WHERE id = ?');
    const boardName = this.boardName(boardId);
    const text = what === 'update' ? `${actorName} הוסיף/ה עדכון ל"${itemName}"` : what === 'status' ? `${actorName} שינה/תה סטטוס ב"${itemName}"` : `${actorName} העביר/ה את "${itemName}" לקבוצה אחרת`;
    let sent = 0;
    for (const userId of this.usersWithAccess(boardId, userIds)) {
      if (userId === actorId) continue;
      const existing = pending.get(userId, itemId) as { id: string } | undefined;
      if (existing) {
        refresh.run(itemName, actorId, what, nowIso(), todayIso(this.config.timeZone), existing.id);
        continue;
      }
      const id = this.insert(userId, 'followed', boardId, itemId, itemName, actorId, what);
      void this.emailOne(userId, id, { subject: 'SUBoard: עדכון בפריט שאחריו את/ה עוקב/ת', lines: [{ text: `${text} בלוח "${boardName}".`, boardId, itemId }] });
      sent++;
    }
    return sent;
  }

  list(userId: string, limit = 50): { notifications: AppNotification[]; unread: number } {
    const rows = this.db
      .prepare(
        `SELECT n.id, n.kind, n.board_id, n.item_id, n.title, a.name AS actor_name, n.detail, n.read_at, n.created_at
         FROM notifications n LEFT JOIN users a ON a.id = n.actor_id
         WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT ?`,
      )
      .all(userId, Math.min(limit, 200)) as NotificationRow[];
    const unread = (this.db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId) as { n: number }).n;
    return {
      unread,
      notifications: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        boardId: r.board_id,
        itemId: r.item_id,
        title: r.title,
        actorName: r.actor_name,
        detail: r.detail,
        read: r.read_at !== null,
        createdAt: r.created_at,
      })),
    };
  }

  /** Marks notifications read — always scoped to the requesting user (no cross-user access). */
  markRead(userId: string, input: { all: true } | { ids: string[] }): void {
    if ('all' in input) {
      this.db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(nowIso(), userId);
      return;
    }
    const stmt = this.db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL');
    const ts = nowIso();
    this.db.transaction(() => input.ids.forEach((id) => stmt.run(ts, id, userId)))();
  }

  /**
   * Daily reminders (runs once per local day after DIGEST_HOUR): for every active user, open items
   * assigned to them that are overdue or due tomorrow → one notification per item per day, and one
   * digest e-mail. Returns the number of notifications created.
   */
  async runDailyReminders(now: Date = new Date(), force = false): Promise<number> {
    const today = todayIso(this.config.timeZone, now);
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: this.config.timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now));
    if (!force) {
      if (hour < this.config.digestHour) return 0;
      const last = this.db.prepare("SELECT last_run_day FROM job_runs WHERE name = 'daily_reminders'").get() as { last_run_day: string } | undefined;
      if (last?.last_run_day === today) return 0;
    }
    this.db
      .prepare("INSERT INTO job_runs (name, last_run_day) VALUES ('daily_reminders', ?) ON CONFLICT(name) DO UPDATE SET last_run_day = excluded.last_run_day")
      .run(today);

    const tomorrow = addDaysIso(today, 1);
    const users = this.db.prepare('SELECT id, name, role FROM users WHERE is_active = 1').all() as Actor[];
    const exists = this.db.prepare('SELECT 1 FROM notifications WHERE user_id = ? AND item_id = ? AND kind = ? AND day = ?');
    let created = 0;

    for (const user of users) {
      const lines: MailLine[] = [];
      const ids: string[] = [];
      for (const boardId of this.access.accessibleBoardIds(user)) {
        const boardName = (this.db.prepare('SELECT name FROM boards WHERE id = ?').get(boardId) as { name: string }).name;
        const columns = this.boards.columns(boardId);
        const due = findDueColumn(columns);
        if (!due) continue;
        const status = findPrimaryStatusColumn(columns);
        const persons = columns.filter((c) => c.type === 'person');
        const items = (this.db.prepare('SELECT * FROM items WHERE board_id = ? AND deleted_at IS NULL').all(boardId) as ItemRow[]).map(toItem);
        for (const item of items) {
          const dueDate = item.values[due.id];
          if (typeof dueDate !== 'string' || isItemDone(item, status)) continue;
          const assigned = persons.some((c) => Array.isArray(item.values[c.id]) && (item.values[c.id] as string[]).includes(user.id));
          if (!assigned) continue;
          const kind: NotificationKind | null = dueDate < today ? 'overdue' : dueDate === tomorrow ? 'due_tomorrow' : null;
          if (!kind || exists.get(user.id, item.id, kind, today)) continue;
          ids.push(this.insert(user.id, kind, boardId, item.id, item.name, null));
          created++;
          lines.push({
            text: `${KIND_TEXT[kind]}: "${item.name}" (${boardName}) — יעד ${formatDateHe(dueDate)}`,
            boardId,
            itemId: item.id,
          });
        }
      }
      if (lines.length) await this.emailMany(user.id, ids, { subject: `SUBoard: ${lines.length} פריטים דורשים טיפול`, lines });
    }
    this.log.info({ created }, 'daily reminders');
    return created;
  }

  purgeOlderThan(days: number): number {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    return this.db.prepare('DELETE FROM notifications WHERE created_at < ?').run(cutoff).changes;
  }

  // ---------------------------------------------------------------- e-mail
  private recipient(userId: string): string | null {
    const r = this.db.prepare('SELECT email, is_active, email_notifications FROM users WHERE id = ?').get(userId) as
      | { email: string; is_active: number; email_notifications: number }
      | undefined;
    return r && r.is_active && r.email_notifications ? r.email : null;
  }

  private async emailOne(userId: string, notificationId: string, msg: { subject: string; lines: MailLine[] }) {
    await this.emailMany(userId, [notificationId], msg);
  }

  private async emailMany(userId: string, notificationIds: string[], msg: { subject: string; lines: MailLine[] }) {
    if (!this.mailer) return;
    const to = this.recipient(userId);
    if (!to) return;
    const link = (l: MailLine) => (l.href ? `${this.config.publicUrl}${l.href}` : `${this.config.publicUrl}/boards/${l.boardId}${l.itemId ? `?item=${l.itemId}` : ''}`);
    const text = [...msg.lines.map((l) => (l.plain ? `• ${l.text}` : `• ${l.text}\n  ${link(l)}`)), '', 'ניתן לכבות התראות דוא"ל בעמוד הפרופיל במערכת.'].join('\n');
    const html =
      `<div dir="rtl" lang="he" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6">` +
      `<ul>${msg.lines.map((l) => (l.plain ? `<li>${escapeHtml(l.text)}</li>` : `<li>${escapeHtml(l.text)} — <a href="${escapeHtml(link(l))}">פתיחה</a></li>`)).join('')}</ul>` +
      `<p style="color:#555;font-size:13px">ניתן לכבות התראות דוא"ל בעמוד הפרופיל במערכת.</p></div>`;
    try {
      await this.mailer.send({ to, subject: msg.subject, text, html });
      const stmt = this.db.prepare('UPDATE notifications SET emailed_at = ? WHERE id = ?');
      const ts = nowIso();
      for (const id of notificationIds) stmt.run(ts, id);
    } catch (err) {
      // Never fail the user's request because SMTP is down; the in-app notification still exists.
      this.log.error({ err: err instanceof Error ? err.message : String(err) }, 'notification e-mail failed');
    }
  }
}
