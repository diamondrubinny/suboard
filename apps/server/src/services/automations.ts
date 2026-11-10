import {
  addDaysIso,
  diffDaysIso,
  findPrimaryStatusColumn,
  isItemDone,
  LIMITS,
  todayIso,
  type Automation,
  type AutomationRun,
  type CellValue,
  type Column,
  type CreateAutomationInput,
  type Item,
  type RuleAction,
  type RuleCondition,
  type RuleTrigger,
} from '@suboard/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../config.js';
import { nowIso, parseJson, type DB } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { AppError, badRequest, notFound } from '../lib/errors.js';
import type { AccessService, Actor } from './access.js';
import type { ActivityService } from './activity.js';
import type { BoardService } from './boards.js';
import type { ItemEvent, ItemService } from './items.js';
import { toItem, type ItemRow } from './mappers.js';
import type { NotificationService } from './notifications.js';

interface AutomationRow {
  id: string;
  board_id: string;
  name: string;
  enabled: number;
  trigger_type: string;
  rule: string;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  last_run_at: string | null;
  run_count: number;
  error_count: number;
}

interface Rule {
  trigger: RuleTrigger;
  conditions: RuleCondition[];
  actions: RuleAction[];
}

const SCHEDULED: RuleTrigger['type'][] = ['date_reached', 'status_stale'];
/** A scheduled date trigger still fires if the server was down on the exact day (up to this many days late). */
const DATE_GRACE_DAYS = 7;

/**
 * Board automations: "when <trigger> and <conditions> then <actions>".
 *
 * Safety rules of the engine:
 *  - Changes made by an automation never trigger other automations (no chaining → no loops).
 *  - Rules run after the user's change is committed; a failing rule is logged, never surfaced as
 *    a failure of the user's request.
 *  - Every value an action writes goes through the same validation as a manual edit.
 *  - Notification recipients are re-checked for board access at send time.
 */
export class AutomationService {
  constructor(
    private readonly db: DB,
    private readonly config: AppConfig,
    private readonly access: AccessService,
    private readonly boards: BoardService,
    private readonly items: ItemService,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationService,
    private log: Pick<FastifyBaseLogger, 'error' | 'info'> = console,
  ) {
    items.onItemEvent((e) => this.handleEvent(e));
  }

  setLogger(log: Pick<FastifyBaseLogger, 'error' | 'info'>) {
    this.log = log;
  }

  // ---------------------------------------------------------------- CRUD
  private toAutomation(r: AutomationRow): Automation {
    const rule = parseJson<Rule>(r.rule, { trigger: { type: 'item_created' }, conditions: [], actions: [] });
    return {
      id: r.id,
      boardId: r.board_id,
      name: r.name,
      enabled: r.enabled === 1,
      trigger: rule.trigger,
      conditions: rule.conditions,
      actions: rule.actions,
      createdBy: r.created_by,
      createdByName: r.created_by_name,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      lastRunAt: r.last_run_at,
      runCount: r.run_count,
      errorCount: r.error_count,
    };
  }

  private rows(where: string, ...params: unknown[]): AutomationRow[] {
    return this.db
      .prepare(
        `SELECT a.*, u.name AS created_by_name FROM automations a LEFT JOIN users u ON u.id = a.created_by
         WHERE ${where} ORDER BY a.created_at`,
      )
      .all(...params) as AutomationRow[];
  }

  private getRow(id: string): AutomationRow {
    const r = this.rows('a.id = ?', id)[0];
    if (!r) throw notFound('האוטומציה לא נמצאה');
    return r;
  }

  list(actor: Actor, boardId: string): Automation[] {
    this.access.requireBoard(actor, boardId, 'editor');
    return this.rows('a.board_id = ?', boardId).map((r) => this.toAutomation(r));
  }

  create(actor: Actor, boardId: string, input: Required<Pick<CreateAutomationInput, 'name'>> & { enabled: boolean } & Rule): Automation {
    this.access.requireBoard(actor, boardId, 'owner');
    const count = (this.db.prepare('SELECT COUNT(*) AS n FROM automations WHERE board_id = ?').get(boardId) as { n: number }).n;
    if (count >= LIMITS.automationsPerBoard) throw badRequest(`ניתן להגדיר עד ${LIMITS.automationsPerBoard} אוטומציות ללוח`);
    const rule: Rule = { trigger: input.trigger, conditions: input.conditions, actions: input.actions };
    this.validateRule(boardId, rule);
    const id = newId();
    const ts = nowIso();
    this.db
      .prepare(
        `INSERT INTO automations (id, board_id, name, enabled, trigger_type, rule, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, boardId, input.name, input.enabled ? 1 : 0, rule.trigger.type, JSON.stringify(rule), actor.id, ts, ts);
    this.activity.record(boardId, actor.id, 'automation_created', { name: input.name });
    return this.toAutomation(this.getRow(id));
  }

  update(actor: Actor, id: string, input: { name?: string; enabled?: boolean } & Partial<Rule>): Automation {
    const row = this.getRow(id);
    this.access.requireBoard(actor, row.board_id, 'owner');
    const current = this.toAutomation(row);
    const rule: Rule = {
      trigger: input.trigger ?? current.trigger,
      conditions: input.conditions ?? current.conditions,
      actions: input.actions ?? current.actions,
    };
    this.validateRule(row.board_id, rule);
    this.db
      .prepare('UPDATE automations SET name = ?, enabled = ?, trigger_type = ?, rule = ?, updated_at = ? WHERE id = ?')
      .run(input.name ?? row.name, (input.enabled ?? current.enabled) ? 1 : 0, rule.trigger.type, JSON.stringify(rule), nowIso(), id);
    this.activity.record(row.board_id, actor.id, 'automation_updated', { name: input.name ?? row.name, ...(input.enabled !== undefined ? { enabled: input.enabled } : {}) });
    return this.toAutomation(this.getRow(id));
  }

  remove(actor: Actor, id: string): void {
    const row = this.getRow(id);
    this.access.requireBoard(actor, row.board_id, 'owner');
    this.db.prepare('DELETE FROM automations WHERE id = ?').run(id);
    this.activity.record(row.board_id, actor.id, 'automation_deleted', { name: row.name });
  }

  runs(actor: Actor, boardId: string, limit = 100): AutomationRun[] {
    this.access.requireBoard(actor, boardId, 'editor');
    return (
      this.db
        .prepare(
          `SELECT r.id, r.automation_id, a.name AS automation_name, r.item_id, i.name AS item_name, r.status, r.detail, r.created_at
           FROM automation_runs r JOIN automations a ON a.id = r.automation_id
           LEFT JOIN items i ON i.id = r.item_id AND i.deleted_at IS NULL
           WHERE r.board_id = ? ORDER BY r.created_at DESC, r.rowid DESC LIMIT ?`,
        )
        .all(boardId, Math.min(limit, 500)) as {
        id: string;
        automation_id: string;
        automation_name: string;
        item_id: string | null;
        item_name: string | null;
        status: 'ok' | 'error';
        detail: string | null;
        created_at: string;
      }[]
    ).map((r) => ({
      id: r.id,
      automationId: r.automation_id,
      automationName: r.automation_name,
      itemId: r.item_id,
      itemName: r.item_name,
      status: r.status,
      detail: r.detail,
      createdAt: r.created_at,
    }));
  }

  purgeRunsOlderThan(days: number = LIMITS.automationRunRetentionDays): number {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    return this.db.prepare('DELETE FROM automation_runs WHERE created_at < ?').run(cutoff).changes;
  }

  // ---------------------------------------------------------------- validation
  private column(columns: Column[], id: string, types: Column['type'][], label: string): Column {
    const c = columns.find((x) => x.id === id);
    if (!c) throw badRequest(`עמודה לא קיימת (${label})`, { columnId: 'עמודה לא קיימת' });
    if (!types.includes(c.type)) throw badRequest(`סוג העמודה "${c.title}" לא מתאים (${label})`, { columnId: 'סוג עמודה לא מתאים' });
    return c;
  }

  private option(col: Column, optionId: string): void {
    if (!col.settings.options?.some((o) => o.id === optionId)) throw badRequest(`תווית לא קיימת בעמודה "${col.title}"`, { optionId: 'תווית לא קיימת' });
  }

  private group(boardId: string, groupId: string): void {
    if (!this.db.prepare('SELECT 1 FROM board_groups WHERE id = ? AND board_id = ?').get(groupId, boardId)) {
      throw badRequest('הקבוצה אינה שייכת ללוח', { groupId: 'קבוצה לא תקינה' });
    }
  }

  /** Every column / label / group / user a rule references must exist on the board, with the right type. */
  private validateRule(boardId: string, rule: Rule): void {
    const cols = this.boards.columns(boardId);
    const t = rule.trigger;
    if (t.type === 'status_changed') {
      const c = this.column(cols, t.columnId, ['status'], 'טריגר');
      if (t.to) this.option(c, t.to);
    } else if (t.type === 'checkbox_checked') this.column(cols, t.columnId, ['checkbox'], 'טריגר');
    else if (t.type === 'person_assigned') this.column(cols, t.columnId, ['person'], 'טריגר');
    else if (t.type === 'date_reached') this.column(cols, t.columnId, ['date'], 'טריגר');
    else if (t.type === 'status_stale') this.option(this.column(cols, t.columnId, ['status'], 'טריגר'), t.optionId);

    for (const c of rule.conditions) {
      if (c.type === 'status_is' || c.type === 'status_is_not') {
        const col = this.column(cols, c.columnId, ['status'], 'תנאי');
        c.optionIds.forEach((o) => this.option(col, o));
      } else if (c.type === 'group_is') this.group(boardId, c.groupId);
      else if (c.type === 'person_empty') this.column(cols, c.columnId, ['person'], 'תנאי');
      else if (c.type === 'not_done' && !findPrimaryStatusColumn(cols)) throw badRequest('לתנאי "לא הושלם" נדרשת עמודת סטטוס בלוח');
    }

    for (const a of rule.actions) {
      if (a.type === 'set_status') this.option(this.column(cols, a.columnId, ['status'], 'פעולה'), a.optionId);
      else if (a.type === 'set_checkbox') this.column(cols, a.columnId, ['checkbox'], 'פעולה');
      else if (a.type === 'assign') {
        this.column(cols, a.columnId, ['person'], 'פעולה');
        this.items.assertUsersOnBoard(boardId, a.userIds, 'שיוך', 'userIds');
      } else if (a.type === 'clear') {
        const c = this.column(cols, a.columnId, cols.map((x) => x.type), 'פעולה');
        if (c.type === 'auto_id') throw badRequest(`העמודה "${c.title}" מחושבת אוטומטית`);
      } else if (a.type === 'set_date') this.column(cols, a.columnId, ['date'], 'פעולה');
      else if (a.type === 'move_group') this.group(boardId, a.groupId);
      else if (a.type === 'notify') {
        if (a.to.columnId) this.column(cols, a.to.columnId, ['person'], 'התראה');
        this.items.assertUsersOnBoard(boardId, a.to.userIds, 'התראה', 'userIds');
      }
    }
    const hasCreateSub = rule.actions.some((a) => a.type === 'create_subitem');
    if (hasCreateSub && rule.actions.filter((a) => a.type === 'create_subitem').length > 3) throw badRequest('עד 3 תת-פריטים לחוק');
  }

  // ---------------------------------------------------------------- matching
  private triggerMatches(t: RuleTrigger, e: ItemEvent): boolean {
    const before = e.before?.values ?? {};
    const after = e.after.values;
    switch (t.type) {
      case 'item_created':
        return e.kind === 'created';
      case 'status_changed':
        return e.kind === 'changed' && before[t.columnId] !== after[t.columnId] && after[t.columnId] != null && (!t.to || after[t.columnId] === t.to);
      case 'checkbox_checked':
        return e.kind === 'changed' && before[t.columnId] !== true && after[t.columnId] === true;
      case 'person_assigned': {
        const prev = new Set(Array.isArray(before[t.columnId]) ? (before[t.columnId] as string[]) : []);
        const next = Array.isArray(after[t.columnId]) ? (after[t.columnId] as string[]) : [];
        return next.some((id) => !prev.has(id));
      }
      default:
        return false; // scheduled triggers are evaluated by runScheduled
    }
  }

  private conditionsMatch(conditions: RuleCondition[], item: Item, columns: Column[]): boolean {
    return conditions.every((c) => {
      switch (c.type) {
        case 'status_is':
          return typeof item.values[c.columnId] === 'string' && c.optionIds.includes(item.values[c.columnId] as string);
        case 'status_is_not':
          return !(typeof item.values[c.columnId] === 'string' && c.optionIds.includes(item.values[c.columnId] as string));
        case 'not_done':
          return !isItemDone(item, findPrimaryStatusColumn(columns));
        case 'group_is':
          return item.groupId === c.groupId;
        case 'person_empty': {
          const v = item.values[c.columnId];
          return !Array.isArray(v) || v.length === 0;
        }
      }
    });
  }

  // ---------------------------------------------------------------- execution
  private handleEvent(e: ItemEvent): void {
    if (e.after.parentId) return; // rules apply to top-level items
    const rules = this.rows('a.board_id = ? AND a.enabled = 1', e.boardId).filter((r) => !SCHEDULED.includes(r.trigger_type as RuleTrigger['type']));
    if (!rules.length) return;
    const columns = this.boards.columns(e.boardId);
    for (const row of rules) {
      const a = this.toAutomation(row);
      if (!this.triggerMatches(a.trigger, e)) continue;
      let item: Item;
      try {
        item = this.items.getLive(e.after.id); // fresh state (an earlier rule may have changed it)
      } catch {
        return; // deleted by an earlier rule's effects — nothing left to do
      }
      if (!this.conditionsMatch(a.conditions, item, columns)) continue;
      this.execute(a, item, null);
    }
  }

  /** Runs a rule's actions on one item and records the run. Never throws. */
  private execute(a: Automation, item: Item, dedupeKey: string | null): void {
    const doer = { id: null, name: `אוטומציה «${a.name}»`, automation: a.name };
    let status: 'ok' | 'error' = 'ok';
    let detail: string | null = null;
    try {
      for (const action of a.actions) this.runAction(a, action, item.id, doer);
    } catch (err) {
      status = 'error';
      detail = err instanceof AppError ? err.message : 'שגיאה פנימית';
      if (!(err instanceof AppError)) this.log.error({ err: err instanceof Error ? err.message : String(err), automationId: a.id }, 'automation failed');
    }
    const ts = nowIso();
    this.db
      .prepare('INSERT OR IGNORE INTO automation_runs (id, automation_id, board_id, item_id, status, detail, dedupe_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(newId(), a.id, a.boardId, item.id, status, detail, dedupeKey, ts);
    this.db
      .prepare(`UPDATE automations SET last_run_at = ?, run_count = run_count + 1, error_count = error_count + ? WHERE id = ?`)
      .run(ts, status === 'error' ? 1 : 0, a.id);
  }

  private runAction(a: Automation, action: RuleAction, itemId: string, doer: { id: null; name: string; automation: string }): void {
    const today = todayIso(this.config.timeZone);
    const set = (columnId: string, value: CellValue) => this.items.systemUpdate(doer, itemId, { values: { [columnId]: value } });
    switch (action.type) {
      case 'set_status':
        set(action.columnId, action.optionId);
        return;
      case 'set_checkbox':
        set(action.columnId, action.value);
        return;
      case 'assign': {
        const current = this.items.getLive(itemId).values[action.columnId];
        const ids = action.mode === 'add' ? [...new Set([...(Array.isArray(current) ? (current as string[]) : []), ...action.userIds])] : action.userIds;
        set(action.columnId, ids.slice(0, LIMITS.personsPerCell));
        return;
      }
      case 'clear':
        set(action.columnId, null);
        return;
      case 'set_date':
        set(action.columnId, addDaysIso(today, action.offsetDays));
        return;
      case 'move_group':
        this.items.systemUpdate(doer, itemId, { groupId: action.groupId });
        return;
      case 'create_subitem': {
        const item = this.items.getLive(itemId);
        this.items.systemCreate(doer, item.boardId, { groupId: item.groupId, parentId: item.id, name: action.name });
        return;
      }
      case 'notify': {
        const item = this.items.getLive(itemId);
        const ids = new Set<string>(action.to.userIds);
        if (action.to.columnId) {
          if (!this.boards.columns(item.boardId).some((c) => c.id === action.to.columnId)) throw badRequest('עמודת האנשים להתראה נמחקה');
          const v = item.values[action.to.columnId];
          if (Array.isArray(v)) (v as string[]).forEach((id) => ids.add(id));
        }
        if (action.to.owners) {
          for (const r of this.db.prepare("SELECT user_id FROM board_members WHERE board_id = ? AND role = 'owner'").all(item.boardId) as { user_id: string }[]) {
            ids.add(r.user_id);
          }
        }
        this.notifications.onAutomation(item.boardId, item.id, item.name, a.name, action.message, [...ids]);
        return;
      }
    }
  }

  // ---------------------------------------------------------------- scheduled (date / SLA)
  /** Time the item entered its current value of `columnId` (last change in history, else creation). */
  private enteredAt(item: Item, columnId: string): string {
    const r = this.db
      .prepare(
        `SELECT created_at FROM activity WHERE item_id = ? AND action = 'item_value_changed' AND json_extract(detail, '$.columnId') = ?
         ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .get(item.id, columnId) as { created_at: string } | undefined;
    return r?.created_at ?? item.createdAt;
  }

  /**
   * Daily evaluation of scheduled triggers (once per local day after DIGEST_HOUR unless forced).
   * Each (rule, item, key) fires at most once thanks to a unique dedupe key.
   */
  runScheduled(now: Date = new Date(), force = false): number {
    const today = todayIso(this.config.timeZone, now);
    if (!force) {
      const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: this.config.timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now));
      if (hour < this.config.digestHour) return 0;
      const last = this.db.prepare("SELECT last_run_day FROM job_runs WHERE name = 'automations_scheduled'").get() as { last_run_day: string } | undefined;
      if (last?.last_run_day === today) return 0;
    }
    this.db
      .prepare("INSERT INTO job_runs (name, last_run_day) VALUES ('automations_scheduled', ?) ON CONFLICT(name) DO UPDATE SET last_run_day = excluded.last_run_day")
      .run(today);

    const rules = this.rows(
      `a.enabled = 1 AND a.trigger_type IN ('date_reached','status_stale')
       AND EXISTS (SELECT 1 FROM boards b WHERE b.id = a.board_id AND b.archived_at IS NULL)`,
    ).map((r) => this.toAutomation(r));
    const fired = this.db.prepare('SELECT 1 FROM automation_runs WHERE automation_id = ? AND item_id = ? AND dedupe_key = ?');
    let count = 0;
    for (const a of rules) {
      const columns = this.boards.columns(a.boardId);
      const items = (
        this.db.prepare('SELECT * FROM items WHERE board_id = ? AND parent_id IS NULL AND deleted_at IS NULL').all(a.boardId) as ItemRow[]
      ).map(toItem);
      for (const item of items) {
        let key: string | null = null;
        const t = a.trigger;
        if (t.type === 'date_reached') {
          const date = item.values[t.columnId];
          if (typeof date !== 'string') continue;
          const target = addDaysIso(date, t.offsetDays);
          if (target > today || diffDaysIso(target, today) > DATE_GRACE_DAYS) continue;
          key = `date:${date}`;
        } else if (t.type === 'status_stale') {
          if (item.values[t.columnId] !== t.optionId) continue;
          const since = this.enteredAt(item, t.columnId);
          const sinceDay = todayIso(this.config.timeZone, new Date(since));
          if (diffDaysIso(sinceDay, today) < t.days) continue;
          key = `stale:${since}`;
        }
        if (!key || fired.get(a.id, item.id, key)) continue;
        if (!this.conditionsMatch(a.conditions, item, columns)) continue;
        this.execute(a, item, key);
        count++;
      }
    }
    if (count) this.log.info({ fired: count }, 'scheduled automations');
    return count;
  }
}
