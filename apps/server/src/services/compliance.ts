import {
  addDaysIso,
  todayIso,
  type BoardCompliance,
  type Column,
  type ComplianceBucket,
  type ComplianceSettings,
  type Item,
} from '@suboard/shared';
import type { AppConfig } from '../config.js';
import { parseJson, type DB } from '../db/index.js';
import { badRequest } from '../lib/errors.js';
import type { AccessService, Actor } from './access.js';
import type { ActivityService } from './activity.js';
import type { BoardService } from './boards.js';
import { toItem, type ItemRow } from './mappers.js';

const GROUP_TYPES: Column['type'][] = ['status', 'tags', 'text', 'person'];

/**
 * Periodic-compliance engine: for boards with a "next inspection" date column, how many items are
 * within date, due soon, overdue or missing a date — overall and per location / type.
 */
export class ComplianceService {
  constructor(
    private readonly db: DB,
    private readonly config: AppConfig,
    private readonly access: AccessService,
    private readonly boards: BoardService,
    private readonly activity: ActivityService,
  ) {}

  private settingsOf(boardId: string): NonNullable<ComplianceSettings> | null {
    const r = this.db.prepare('SELECT compliance FROM boards WHERE id = ?').get(boardId) as { compliance: string | null } | undefined;
    return r?.compliance ? parseJson<NonNullable<ComplianceSettings>>(r.compliance, null as never) : null;
  }

  configure(actor: Actor, boardId: string, settings: ComplianceSettings): BoardCompliance | null {
    this.access.requireBoard(actor, boardId, 'owner');
    if (settings) {
      const cols = this.boards.columns(boardId);
      const date = cols.find((c) => c.id === settings.dateColumnId);
      if (!date || date.type !== 'date') throw badRequest('יש לבחור עמודת תאריך מהלוח', { dateColumnId: 'עמודה לא תקינה' });
      if (settings.groupByColumnId) {
        const g = cols.find((c) => c.id === settings.groupByColumnId);
        if (!g || !GROUP_TYPES.includes(g.type)) throw badRequest('עמודת הפילוח חייבת להיות סטטוס, תגיות, טקסט או אנשים', { groupByColumnId: 'עמודה לא תקינה' });
      }
    }
    this.db.prepare('UPDATE boards SET compliance = ? WHERE id = ?').run(settings ? JSON.stringify(settings) : null, boardId);
    this.activity.record(boardId, actor.id, 'compliance_updated', { enabled: Boolean(settings) });
    return settings ? this.forBoard(actor, boardId) : null;
  }

  forBoard(actor: Actor, boardId: string): BoardCompliance | null {
    this.access.requireBoard(actor, boardId, 'viewer');
    return this.compute(boardId);
  }

  /** All boards the actor can see that have compliance configured. */
  overview(actor: Actor): BoardCompliance[] {
    return this.access
      .accessibleBoardIds(actor)
      .map((id) => this.compute(id))
      .filter((x): x is BoardCompliance => x !== null)
      .sort((a, b) => (a.summary.percent ?? 101) - (b.summary.percent ?? 101));
  }

  private compute(boardId: string, now: Date = new Date()): BoardCompliance | null {
    const settings = this.settingsOf(boardId);
    if (!settings) return null;
    const cols = this.boards.columns(boardId);
    const dateCol = cols.find((c) => c.id === settings.dateColumnId);
    if (!dateCol) return null; // column deleted after configuration
    const groupCol = settings.groupByColumnId ? cols.find((c) => c.id === settings.groupByColumnId) : undefined;
    const boardName = (this.db.prepare('SELECT name FROM boards WHERE id = ?').get(boardId) as { name: string }).name;
    const items = (this.db.prepare('SELECT * FROM items WHERE board_id = ? AND parent_id IS NULL AND deleted_at IS NULL').all(boardId) as ItemRow[]).map(toItem);
    const today = todayIso(this.config.timeZone, now);
    const soon = addDaysIso(today, settings.windowDays ?? 30);
    const users = groupCol?.type === 'person' ? new Map((this.db.prepare('SELECT id, name FROM users').all() as { id: string; name: string }[]).map((u) => [u.id, u.name])) : null;

    const groupKeys = (i: Item): { key: string; label: string }[] => {
      if (!groupCol) return [];
      const v = i.values[groupCol.id];
      const none = [{ key: '∅', label: 'ללא' }];
      if (groupCol.type === 'status') {
        const o = groupCol.settings.options?.find((x) => x.id === v);
        return o ? [{ key: o.id, label: o.label }] : none;
      }
      if (groupCol.type === 'tags' && Array.isArray(v) && v.length) {
        return (v as string[]).map((id) => ({ key: id, label: groupCol.settings.options?.find((x) => x.id === id)?.label ?? id }));
      }
      if (groupCol.type === 'person' && Array.isArray(v) && v.length) return (v as string[]).map((id) => ({ key: id, label: users?.get(id) ?? 'משתמש' }));
      if (groupCol.type === 'text' && typeof v === 'string' && v.trim()) return [{ key: v.trim(), label: v.trim() }];
      return none;
    };

    const empty = (key: string, label: string): ComplianceBucket => ({ key, label, total: 0, ok: 0, dueSoon: 0, overdue: 0, missing: 0, percent: null });
    const summary = empty('all', 'הכל');
    const groups = new Map<string, ComplianceBucket>();
    const overdueItems: BoardCompliance['overdueItems'] = [];
    for (const i of items) {
      const d = i.values[dateCol.id];
      const state: 'ok' | 'dueSoon' | 'overdue' | 'missing' = typeof d !== 'string' ? 'missing' : d < today ? 'overdue' : d <= soon ? 'dueSoon' : 'ok';
      const keys = groupKeys(i);
      for (const b of [summary, ...keys.map((k) => groups.get(k.key) ?? groups.set(k.key, empty(k.key, k.label)).get(k.key)!)]) {
        b.total++;
        b[state]++;
      }
      if (state === 'overdue') overdueItems.push({ id: i.id, name: i.name, date: d as string, group: keys.map((k) => k.label).join(', ') || null });
    }
    const pct = (b: ComplianceBucket) => (b.percent = b.total ? Math.round(((b.ok + b.dueSoon) / b.total) * 100) : null);
    pct(summary);
    groups.forEach(pct);
    return {
      boardId,
      boardName,
      settings: { dateColumnId: settings.dateColumnId, groupByColumnId: settings.groupByColumnId ?? null, windowDays: settings.windowDays ?? 30 },
      dateColumnTitle: dateCol.title,
      groupByTitle: groupCol?.title ?? null,
      summary,
      groups: [...groups.values()].sort((a, b) => (a.percent ?? 101) - (b.percent ?? 101) || a.label.localeCompare(b.label, 'he')),
      overdueItems: overdueItems.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 50),
    };
  }
}
