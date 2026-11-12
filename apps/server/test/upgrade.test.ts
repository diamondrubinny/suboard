import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { migrate } from '../src/db/index.js';
import { migrations } from '../src/db/migrations.js';
import { MemoryMailer } from '../src/lib/mailer.js';
import { Client, ORIGIN, PASSWORD } from './helpers.js';
import { hashPassword } from '../src/lib/crypto.js';

const latest = Math.max(...migrations.map((m) => m.version));
const NOW = '2026-06-01T08:00:00.000Z';

/** A database as an older release left it: migrations up to `version`, with some data in it. */
async function oldDatabase(version: number) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  for (const m of migrations.filter((x) => x.version <= version)) {
    db.exec(m.sql);
    db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(m.version, m.name, NOW);
  }
  const hash = await hashPassword(PASSWORD);
  db.prepare("INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at) VALUES ('00000000-0000-4000-8000-0000000000a1', 'boss@x.org', 'בוס', ?, 'admin', ?, ?)").run(hash, NOW, NOW);
  db.prepare("INSERT INTO boards (id, name, created_at, updated_at) VALUES ('00000000-0000-4000-8000-0000000000b1', 'ציוד', ?, ?)").run(NOW, NOW);
  db.prepare("INSERT INTO board_members (board_id, user_id, role) VALUES ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1', 'owner')").run();
  db.prepare("INSERT INTO board_groups (id, board_id, name, color, position) VALUES ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b1', 'תקין', 'green', 0)").run();
  db.prepare(`INSERT INTO board_columns (id, board_id, title, type, settings, position) VALUES ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000b1', 'סטטוס', 'status', '{"options":[{"id":"ok","label":"תקין","color":"green"}]}', 0)`).run();
  const item = db.prepare("INSERT INTO items (id, board_id, group_id, name, cell_values, position, created_at, updated_at) VALUES (?, '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000c1', ?, ?, ?, ?, ?)");
  item.run('00000000-0000-4000-8000-0000000000e1', 'מנדף 3', '{"00000000-0000-4000-8000-0000000000d1":"ok"}', 0, NOW, NOW);
  item.run('00000000-0000-4000-8000-0000000000e2', 'פאנל גז', '{}', 1, NOW, NOW);
  db.prepare("INSERT INTO item_updates (id, item_id, body, created_at) VALUES ('up1', '00000000-0000-4000-8000-0000000000e1', 'נבדק', ?)").run(NOW);
  const has = (table: string) => db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined;
  // automatic links exist from the release that introduced item_links; they must survive the table rebuild
  if (has('item_links')) db.prepare("INSERT INTO item_links (id, from_item, to_item, kind, created_at) VALUES ('l1', '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000e2', 'investigation_action', ?)").run(NOW);
  // work permits existed until migration 12 removed the module
  if (has('permits')) {
    db.prepare(
      "INSERT INTO permits (id, seq, type, title, location, location_key, starts_at, ends_at, status, requester_id, created_at, updated_at) VALUES ('p1', 1, 'hot', 'ריתוך', 'חדר 3', 'חדר 3', ?, ?, 'pending', '00000000-0000-4000-8000-0000000000a1', ?, ?)",
    ).run(NOW, NOW, NOW, NOW);
  }
  return db;
}

describe('upgrading an existing installation', () => {
  // Every release an installation may still be on: from before the first public installer to the previous one.
  for (const from of migrations.map((m) => m.version).filter((v) => v >= 7 && v < latest)) {
    it(`migrates a database from schema ${from} to ${latest}, keeps its data, and the app works on it`, async () => {
      const db = await oldDatabase(from);
      migrate(db);
      expect((db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number }).v).toBe(latest);
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(db.pragma('foreign_key_check')).toEqual([]);
      expect((db.prepare('SELECT name FROM items ORDER BY position').all() as { name: string }[]).map((r) => r.name)).toEqual(['מנדף 3', 'פאנל גז']);
      expect(db.prepare('SELECT body FROM item_updates').get()).toEqual({ body: 'נבדק' });
      if (from >= 5) expect(db.prepare("SELECT kind, column_id FROM item_links WHERE id = 'l1'").get()).toEqual({ kind: 'investigation_action', column_id: null });
      expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'permits'").get()).toBeUndefined();

      // the current application runs on the migrated database
      const config = loadConfig({ NODE_ENV: 'test', APP_ORIGIN: ORIGIN, LOGIN_MAX_PER_WINDOW: '1000', STATIC_DIR: '/nonexistent', MFA_REQUIRED_ROLES: '', UPLOAD_DIR: '/tmp/suboard-upgrade-test' });
      const app = await buildApp(config, db, { mailer: new MemoryMailer(), scanner: null });
      await app.ready();
      try {
        const c = new Client(app);
        await c.login('boss@x.org');
        const board = (await c.get('/api/boards/00000000-0000-4000-8000-0000000000b1')).json().board;
        expect(board.items).toHaveLength(2);
        expect(board.itemTerm).toBe('');
        expect((await c.get('/api/items/00000000-0000-4000-8000-0000000000e1/links')).json().links).toHaveLength(from >= 5 ? 1 : 0);
        expect((await c.post('/api/boards/00000000-0000-4000-8000-0000000000b1/items', { groupId: '00000000-0000-4000-8000-0000000000c1', name: 'חדש', parentId: '00000000-0000-4000-8000-0000000000e1' })).statusCode).toBe(201);
        expect((await c.post('/api/items/00000000-0000-4000-8000-0000000000e1/links', { toItemId: '00000000-0000-4000-8000-0000000000e2' })).statusCode).toBe(201);
        expect((await c.get('/api/modules')).statusCode).toBe(200);
        expect((await c.get('/api/boards/00000000-0000-4000-8000-0000000000b1/export.csv')).statusCode).toBe(200);
      } finally {
        await app.close();
        db.close();
      }
    });
  }
});
