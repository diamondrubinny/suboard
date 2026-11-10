/**
 * Ordered, append-only schema migrations. Never edit a migration that has shipped;
 * add a new one instead.
 */
export const migrations: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: 'init',
    sql: /* sql */ `
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin','manager','member')),
        is_active INTEGER NOT NULL DEFAULT 1,
        must_change_password INTEGER NOT NULL DEFAULT 0,
        failed_logins INTEGER NOT NULL DEFAULT 0,
        locked_until TEXT,
        last_login_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,               -- sha256(token); the raw token is never stored
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        user_agent TEXT
      );
      CREATE INDEX idx_sessions_user ON sessions(user_id);

      CREATE TABLE boards (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        template_key TEXT NOT NULL DEFAULT 'blank',
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      );

      CREATE TABLE board_members (
        board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')),
        PRIMARY KEY (board_id, user_id)
      );
      CREATE INDEX idx_members_user ON board_members(user_id);

      CREATE TABLE board_groups (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        position REAL NOT NULL
      );
      CREATE INDEX idx_groups_board ON board_groups(board_id);

      CREATE TABLE board_columns (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        type TEXT NOT NULL,
        settings TEXT NOT NULL DEFAULT '{}',
        position REAL NOT NULL
      );
      CREATE INDEX idx_columns_board ON board_columns(board_id);

      CREATE TABLE items (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        group_id TEXT NOT NULL REFERENCES board_groups(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        cell_values TEXT NOT NULL DEFAULT '{}',
        position REAL NOT NULL,
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_items_board ON items(board_id);
      CREATE INDEX idx_items_group ON items(group_id);

      CREATE TABLE item_updates (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_updates_item ON item_updates(item_id);

      CREATE TABLE activity (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        item_id TEXT,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_activity_board ON activity(board_id, created_at);
      CREATE INDEX idx_activity_item ON activity(item_id, created_at);

      CREATE TABLE audit_log (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        event TEXT NOT NULL,
        ip_hash TEXT,
        meta TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_audit_created ON audit_log(created_at);
    `,
  },
  {
    version: 2,
    name: 'mfa_notifications_attachments',
    sql: /* sql */ `
      ALTER TABLE users ADD COLUMN mfa_secret_enc TEXT;
      ALTER TABLE users ADD COLUMN mfa_enabled INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN mfa_last_step INTEGER;
      ALTER TABLE users ADD COLUMN email_notifications INTEGER NOT NULL DEFAULT 1;

      CREATE TABLE mfa_recovery_codes (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code_hash TEXT NOT NULL,
        used_at TEXT
      );
      CREATE INDEX idx_recovery_user ON mfa_recovery_codes(user_id);

      CREATE TABLE mfa_challenges (
        id TEXT PRIMARY KEY,               -- sha256(token)
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        board_id TEXT REFERENCES boards(id) ON DELETE CASCADE,
        item_id TEXT REFERENCES items(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        read_at TEXT,
        emailed_at TEXT,
        created_at TEXT NOT NULL,
        day TEXT NOT NULL                  -- local YYYY-MM-DD, for once-per-day reminders
      );
      CREATE INDEX idx_notifications_user ON notifications(user_id, created_at);
      CREATE INDEX idx_notifications_dedupe ON notifications(user_id, item_id, kind, day);

      CREATE TABLE attachments (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        original_name TEXT NOT NULL,
        mime TEXT NOT NULL,
        size INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending','clean','infected','error')),
        scan_detail TEXT,
        scanned_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_attachments_item ON attachments(item_id);
      CREATE INDEX idx_attachments_status ON attachments(status);

      CREATE TABLE job_runs (
        name TEXT PRIMARY KEY,
        last_run_day TEXT NOT NULL
      );
    `,
  },
  {
    version: 3,
    name: 'subitems_trash_seq_views',
    sql: /* sql */ `
      ALTER TABLE items ADD COLUMN parent_id TEXT REFERENCES items(id) ON DELETE CASCADE;
      ALTER TABLE items ADD COLUMN deleted_at TEXT;
      ALTER TABLE items ADD COLUMN seq INTEGER;
      ALTER TABLE boards ADD COLUMN item_seq INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX idx_items_parent ON items(parent_id);
      CREATE INDEX idx_items_deleted ON items(board_id, deleted_at);

      -- Running number per board for existing items, in creation order.
      UPDATE items SET seq = (
        SELECT rn FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY board_id ORDER BY created_at, rowid) AS rn FROM items) x
        WHERE x.id = items.id
      );
      UPDATE boards SET item_seq = COALESCE((SELECT MAX(seq) FROM items WHERE items.board_id = boards.id), 0);
      CREATE UNIQUE INDEX idx_items_board_seq ON items(board_id, seq);

      CREATE TABLE saved_views (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        config TEXT NOT NULL DEFAULT '{}',
        shared INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_views_board ON saved_views(board_id);
    `,
  },
  {
    version: 4,
    name: 'automations_recurrences_reports',
    sql: /* sql */ `
      CREATE TABLE automations (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        trigger_type TEXT NOT NULL,
        rule TEXT NOT NULL,                -- JSON {trigger, conditions, actions}, validated by Zod on write
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_run_at TEXT,
        run_count INTEGER NOT NULL DEFAULT 0,
        error_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_automations_board ON automations(board_id, trigger_type);

      CREATE TABLE automation_runs (
        id TEXT PRIMARY KEY,
        automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
        board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        item_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('ok','error')),
        detail TEXT,
        dedupe_key TEXT,                   -- scheduled triggers: fire once per key
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_runs_board ON automation_runs(board_id, created_at);
      CREATE UNIQUE INDEX idx_runs_dedupe ON automation_runs(automation_id, item_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

      CREATE TABLE recurrences (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        group_id TEXT NOT NULL REFERENCES board_groups(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        cell_values TEXT NOT NULL DEFAULT '{}',
        schedule TEXT NOT NULL,
        due_column_id TEXT,
        due_offset_days INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        next_date TEXT,
        last_item_id TEXT,
        last_created_at TEXT,
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_recurrences_due ON recurrences(enabled, next_date);
      CREATE INDEX idx_recurrences_board ON recurrences(board_id);

      CREATE TABLE scheduled_reports (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        frequency TEXT NOT NULL CHECK (frequency IN ('daily','weekly','monthly')),
        weekday INTEGER NOT NULL DEFAULT 0,
        month_day INTEGER NOT NULL DEFAULT 1,
        recipients TEXT NOT NULL DEFAULT '[]',
        enabled INTEGER NOT NULL DEFAULT 1,
        last_sent_day TEXT,
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_reports_board ON scheduled_reports(board_id);

      ALTER TABLE notifications ADD COLUMN detail TEXT;
    `,
  },
];
