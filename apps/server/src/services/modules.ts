import { defaultModuleState, MODULE_KEYS, type ModuleKey, type ModuleState } from '@suboard/shared';
import { nowIso, type DB } from '../db/index.js';
import { forbidden } from '../lib/errors.js';
import type { Actor } from './access.js';
import type { AuditService } from './audit.js';

const SETTING = 'modules';

/** Which optional modules are switched on (system-wide, set by an administrator). */
export class ModuleService {
  private cache: ModuleState | null = null;

  constructor(
    private readonly db: DB,
    private readonly audit: AuditService,
  ) {}

  state(): ModuleState {
    if (this.cache) return this.cache;
    const state = defaultModuleState();
    const row = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(SETTING) as { value: string } | undefined;
    if (row) {
      try {
        const saved = JSON.parse(row.value) as Record<string, unknown>;
        // Unknown keys are ignored and missing ones stay on, so adding a module later needs no migration.
        for (const k of MODULE_KEYS) if (typeof saved[k] === 'boolean') state[k] = saved[k] as boolean;
      } catch {
        /* unreadable setting: everything stays on */
      }
    }
    this.cache = state;
    return state;
  }

  enabled(key: ModuleKey): boolean {
    return this.state()[key];
  }

  set(actor: Actor, changes: Partial<ModuleState>, ip: string): ModuleState {
    if (actor.role !== 'admin') throw forbidden();
    const next = { ...this.state() };
    const changed: Record<string, boolean> = {};
    for (const k of MODULE_KEYS) {
      const v = changes[k];
      if (typeof v === 'boolean' && v !== next[k]) {
        next[k] = v;
        changed[k] = v;
      }
    }
    if (Object.keys(changed).length) {
      this.db
        .prepare('INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at')
        .run(SETTING, JSON.stringify(next), actor.id, nowIso());
      this.cache = next;
      this.audit.log('modules_changed', { userId: actor.id, ip, meta: changed });
    }
    return next;
  }
}
