import { WEBHOOK_EVENTS, type Webhook, type WebhookDelivery, type WebhookEvent } from '@suboard/shared';
import { createHmac, randomBytes } from 'node:crypto';
import type { AppConfig } from '../config.js';
import { nowIso, type DB } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { badRequest, notFound } from '../lib/errors.js';
import { checkTargetUrl, safePost, UnsafeTargetError } from '../lib/safeFetch.js';
import { open, seal } from '../lib/secretbox.js';
import type { AccessService, Actor } from './access.js';
import type { AuditService } from './audit.js';
import type { BoardService } from './boards.js';
import { formatCell } from './export.js';
import type { ItemEvent, ItemService } from './items.js';
import type { ModuleService } from './modules.js';

export const MAX_WEBHOOKS_PER_BOARD = 5;
const DISABLE_AFTER_FAILURES = 10;
const KEEP_DELIVERIES = 30;

interface Row {
  id: string;
  board_id: string;
  url: string;
  secret_enc: string;
  events: string;
  active: number;
  failures: number;
  created_at: string;
}

/**
 * Outgoing webhooks: a board owner registers an HTTPS address that receives a signed JSON message
 * when items of the board are created or changed. Data leaves the system here, so: owners only, the
 * module is off until an administrator switches it on, targets are restricted (see safeFetch), and
 * every delivery is logged.
 */
export class WebhookService {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly db: DB,
    private readonly config: AppConfig,
    private readonly access: AccessService,
    private readonly boards: BoardService,
    private readonly modules: ModuleService,
    private readonly audit: AuditService,
    items: ItemService,
  ) {
    items.onItemEvent((e) => this.onItemEvent(e));
  }

  private get insecure(): boolean {
    return this.config.env !== 'production' && this.config.webhookAllowInsecureTargets;
  }

  private toWebhook(r: Row): Webhook {
    const last = this.db.prepare('SELECT ok, http_status, error, created_at FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT 1').get(r.id) as
      | { ok: number; http_status: number | null; error: string | null; created_at: string }
      | undefined;
    let events: WebhookEvent[] = [];
    try {
      events = (JSON.parse(r.events) as string[]).filter((e): e is WebhookEvent => (WEBHOOK_EVENTS as readonly string[]).includes(e));
    } catch {
      events = [];
    }
    return {
      id: r.id,
      boardId: r.board_id,
      url: r.url,
      events,
      active: r.active === 1,
      failures: r.failures,
      createdAt: r.created_at,
      last: last ? { ok: last.ok === 1, status: last.http_status, error: last.error, at: last.created_at } : null,
    };
  }

  private row(actor: Actor, id: string): Row {
    const r = this.db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id) as Row | undefined;
    // Unknown and not-yours look the same.
    if (!r || this.access.boardRole(actor, r.board_id) !== 'owner') throw notFound('ה-Webhook לא נמצא');
    return r;
  }

  list(actor: Actor, boardId: string): Webhook[] {
    this.access.requireBoard(actor, boardId, 'owner');
    return (this.db.prepare('SELECT * FROM webhooks WHERE board_id = ? ORDER BY created_at').all(boardId) as Row[]).map((r) => this.toWebhook(r));
  }

  /** Returns the webhook and its signing secret — the only time the secret is shown. */
  create(actor: Actor, boardId: string, input: { url: string; events: WebhookEvent[] }, ip: string): { webhook: Webhook; secret: string } {
    this.access.requireBoard(actor, boardId, 'owner');
    let url: URL;
    try {
      url = checkTargetUrl(input.url, this.insecure);
    } catch (e) {
      const msg = e instanceof UnsafeTargetError ? e.message : 'כתובת לא תקינה';
      throw badRequest(msg, { url: msg });
    }
    const count = (this.db.prepare('SELECT COUNT(*) AS n FROM webhooks WHERE board_id = ?').get(boardId) as { n: number }).n;
    if (count >= MAX_WEBHOOKS_PER_BOARD) throw badRequest(`אפשר להגדיר עד ${MAX_WEBHOOKS_PER_BOARD} Webhooks ללוח`);
    const id = newId();
    const secret = `whsec_${randomBytes(32).toString('base64url')}`;
    this.db
      .prepare('INSERT INTO webhooks (id, board_id, url, secret_enc, events, active, failures, created_by, created_at) VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)')
      .run(id, boardId, url.href, seal(this.config.mfaKey, secret, `webhook:${id}`), JSON.stringify([...new Set(input.events)]), actor.id, nowIso());
    // The address may hold a token in its path: only the host is written to the audit log.
    this.audit.log('webhook_changed', { userId: actor.id, ip, meta: { action: 'created', boardId, host: url.host } });
    return { webhook: this.toWebhook(this.db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id) as Row), secret };
  }

  update(actor: Actor, id: string, input: { active?: boolean; events?: WebhookEvent[] }): Webhook {
    const r = this.row(actor, id);
    if (input.events) this.db.prepare('UPDATE webhooks SET events = ? WHERE id = ?').run(JSON.stringify([...new Set(input.events)]), id);
    // Switching it back on clears the failure count that switched it off.
    if (input.active !== undefined) this.db.prepare('UPDATE webhooks SET active = ?, failures = CASE WHEN ? = 1 THEN 0 ELSE failures END WHERE id = ?').run(input.active ? 1 : 0, input.active ? 1 : 0, id);
    return this.toWebhook(this.db.prepare('SELECT * FROM webhooks WHERE id = ?').get(r.id) as Row);
  }

  remove(actor: Actor, id: string, ip: string): void {
    const r = this.row(actor, id);
    this.db.prepare('DELETE FROM webhooks WHERE id = ?').run(id);
    this.audit.log('webhook_changed', { userId: actor.id, ip, meta: { action: 'deleted', boardId: r.board_id } });
  }

  deliveries(actor: Actor, id: string): WebhookDelivery[] {
    this.row(actor, id);
    return (
      this.db.prepare('SELECT id, event, ok, http_status, error, created_at FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT ?').all(id, KEEP_DELIVERIES) as {
        id: string;
        event: string;
        ok: number;
        http_status: number | null;
        error: string | null;
        created_at: string;
      }[]
    ).map((d) => ({ id: d.id, event: d.event, ok: d.ok === 1, status: d.http_status, error: d.error, at: d.created_at }));
  }

  /** Sends a sample message now and waits for the outcome. */
  async test(actor: Actor, id: string): Promise<WebhookDelivery> {
    const r = this.row(actor, id);
    if (!this.modules.enabled('webhooks')) throw badRequest('מודול ה-Webhooks כבוי');
    await this.deliver(r, 'ping', { event: 'ping', boardId: r.board_id, at: nowIso(), message: 'בדיקת חיבור מ-SUBoard' });
    return this.deliveries(actor, id)[0]!;
  }

  private onItemEvent(e: ItemEvent): void {
    if (!this.modules.enabled('webhooks')) return;
    const event: WebhookEvent = e.kind === 'created' ? 'item_created' : 'item_updated';
    const hooks = (this.db.prepare('SELECT * FROM webhooks WHERE board_id = ? AND active = 1').all(e.boardId) as Row[]).filter((h) => {
      try {
        return (JSON.parse(h.events) as string[]).includes(event);
      } catch {
        return false;
      }
    });
    if (!hooks.length) return;
    const columns = this.boards.columns(e.boardId);
    const users = new Map((this.db.prepare('SELECT id, name FROM users').all() as { id: string; name: string }[]).map((u) => [u.id, u.name]));
    // What a spreadsheet export of this row would hold — and nothing else: no e-mail addresses, no
    // updates, no files, and no values that only exist through another board (connected items, mirrors).
    const fields = Object.fromEntries(
      columns.filter((c) => !['relation', 'mirror', 'linked', 'files'].includes(c.type)).map((c) => [c.title, formatCell(c, e.after.values[c.id], e.after, users, columns)]),
    );
    const changed = e.before ? columns.filter((c) => JSON.stringify(e.before!.values[c.id]) !== JSON.stringify(e.after.values[c.id])).map((c) => c.title) : [];
    const board = this.db.prepare('SELECT name FROM boards WHERE id = ?').get(e.boardId) as { name: string } | undefined;
    const payload = {
      event,
      at: nowIso(),
      board: { id: e.boardId, name: board?.name ?? '' },
      item: { id: e.after.id, name: e.after.name, parentId: e.after.parentId, url: `${this.config.publicUrl}/boards/${e.boardId}?item=${e.after.id}`, fields },
      ...(e.before ? { changed: [...(e.before.name !== e.after.name ? ['name'] : []), ...changed] } : {}),
    };
    for (const h of hooks) this.enqueue(h, event, payload);
  }

  /** Deliveries run one after another, off the request path; a slow receiver never blocks a user. */
  private enqueue(hook: Row, event: string, payload: unknown): void {
    this.queue = this.queue.then(() => this.deliver(hook, event, payload)).catch(() => undefined);
  }

  /** Resolves when everything queued so far has been attempted (tests, shutdown). */
  idle(): Promise<void> {
    return this.queue;
  }

  private async deliver(hook: Row, event: string, payload: unknown): Promise<void> {
    const body = JSON.stringify(payload);
    const deliveryId = newId();
    let secret: string;
    try {
      secret = open(this.config.mfaKey, hook.secret_enc, `webhook:${hook.id}`);
    } catch {
      this.record(hook, deliveryId, event, { ok: false, status: null, error: 'לא ניתן לפענח את סוד החתימה' });
      return;
    }
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    const result = await safePost(
      hook.url,
      body,
      { 'X-SUBoard-Event': event, 'X-SUBoard-Delivery': deliveryId, 'X-SUBoard-Timestamp': timestamp, 'X-SUBoard-Signature': `sha256=${signature}` },
      { allowInsecureTargets: this.insecure },
    );
    this.record(hook, deliveryId, event, result);
  }

  private record(hook: Row, deliveryId: string, event: string, r: { ok: boolean; status: number | null; error: string | null }): void {
    // The webhook may have been deleted while the message was on its way.
    if (!this.db.prepare('SELECT 1 FROM webhooks WHERE id = ?').get(hook.id)) return;
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO webhook_deliveries (id, webhook_id, event, ok, http_status, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(deliveryId, hook.id, event, r.ok ? 1 : 0, r.status, r.error, nowIso());
      this.db
        .prepare('DELETE FROM webhook_deliveries WHERE webhook_id = ? AND id NOT IN (SELECT id FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT ?)')
        .run(hook.id, hook.id, KEEP_DELIVERIES);
      if (r.ok) this.db.prepare('UPDATE webhooks SET failures = 0 WHERE id = ?').run(hook.id);
      else {
        this.db.prepare('UPDATE webhooks SET failures = failures + 1 WHERE id = ?').run(hook.id);
        // A receiver that keeps failing is switched off instead of being retried forever.
        this.db.prepare('UPDATE webhooks SET active = 0 WHERE id = ? AND failures >= ?').run(hook.id, DISABLE_AFTER_FAILURES);
      }
    })();
  }
}
