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
  {
    version: 5,
    name: 'links_investigations_compliance_forms',
    sql: /* sql */ `
      CREATE TABLE item_links (
        id TEXT PRIMARY KEY,
        from_item TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        to_item TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('checklist_capa','investigation_action')),
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_links_from ON item_links(from_item);
      CREATE INDEX idx_links_to ON item_links(to_item);

      CREATE TABLE investigations (
        item_id TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
        data TEXT NOT NULL,                 -- JSON, validated by Zod on write
        effectiveness_due TEXT,
        effectiveness_result TEXT,
        reminded_for TEXT,                  -- effectiveness_due value a reminder was already sent for
        updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_investigations_due ON investigations(effectiveness_due);

      CREATE TABLE forms (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        config TEXT NOT NULL,               -- JSON {description, groupId, nameLabel, fields, audience, allowPhotos}
        enabled INTEGER NOT NULL DEFAULT 1,
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_forms_board ON forms(board_id);

      ALTER TABLE items ADD COLUMN form_id TEXT REFERENCES forms(id) ON DELETE SET NULL;
      CREATE INDEX idx_items_form ON items(form_id, created_by);
      ALTER TABLE boards ADD COLUMN compliance TEXT;
    `,
  },
  {
    version: 6,
    name: 'dashboards_dependencies_monthly',
    sql: /* sql */ `
      CREATE TABLE dashboards (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        shared INTEGER NOT NULL DEFAULT 0,
        widgets TEXT NOT NULL DEFAULT '[]',   -- JSON, validated by Zod on write
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_dashboards_owner ON dashboards(owner_id);

      CREATE TABLE item_dependencies (
        blocker_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        blocked_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (blocker_id, blocked_id)
      );
      CREATE INDEX idx_deps_blocked ON item_dependencies(blocked_id);

      ALTER TABLE users ADD COLUMN monthly_report INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX idx_activity_action ON activity(board_id, action, created_at);
    `,
  },
  {
    version: 7,
    name: 'trainings_permits_procedures_pins',
    sql: /* sql */ `
      CREATE TABLE trainings (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        validity_months INTEGER NOT NULL DEFAULT 12,
        all_users INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE training_requirements (
        training_id TEXT NOT NULL REFERENCES trainings(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY (training_id, user_id)
      );
      CREATE TABLE training_records (
        id TEXT PRIMARY KEY,
        training_id TEXT NOT NULL REFERENCES trainings(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        completed_on TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        recorded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_training_records ON training_records(training_id, user_id, completed_on);

      CREATE TABLE permits (
        id TEXT PRIMARY KEY,
        seq INTEGER NOT NULL UNIQUE,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        location TEXT NOT NULL,
        location_key TEXT NOT NULL,         -- normalized, for conflict detection
        description TEXT NOT NULL DEFAULT '',
        contractor TEXT NOT NULL DEFAULT '',
        starts_at TEXT NOT NULL,
        ends_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','cancelled','closed','expired')),
        requester_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        precautions TEXT NOT NULL DEFAULT '[]',
        conflict_note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_permits_window ON permits(location_key, status, starts_at, ends_at);
      CREATE TABLE permit_approvals (
        permit_id TEXT NOT NULL REFERENCES permits(id) ON DELETE CASCADE,
        ord INTEGER NOT NULL,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        decision TEXT CHECK (decision IN ('approved','rejected')),
        comment TEXT NOT NULL DEFAULT '',
        decided_at TEXT,
        PRIMARY KEY (permit_id, ord)
      );
      -- Append-only log of every permit action (who, when, what).
      CREATE TABLE permit_events (
        id TEXT PRIMARY KEY,
        permit_id TEXT NOT NULL REFERENCES permits(id) ON DELETE CASCADE,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        comment TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_permit_events ON permit_events(permit_id, created_at);

      CREATE TABLE procedures (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'כללי',
        audience TEXT NOT NULL DEFAULT 'all',
        current_version_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE procedure_audience (
        procedure_id TEXT NOT NULL REFERENCES procedures(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY (procedure_id, user_id)
      );
      CREATE TABLE procedure_versions (
        id TEXT PRIMARY KEY,
        procedure_id TEXT NOT NULL REFERENCES procedures(id) ON DELETE CASCADE,
        version TEXT NOT NULL,
        effective_on TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        link TEXT,
        published_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        published_at TEXT NOT NULL
      );
      CREATE INDEX idx_proc_versions ON procedure_versions(procedure_id, published_at);
      CREATE TABLE procedure_acks (
        version_id TEXT NOT NULL REFERENCES procedure_versions(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        acked_at TEXT NOT NULL,
        PRIMARY KEY (version_id, user_id)
      );

      CREATE TABLE plan_pins (
        attachment_id TEXT NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        x REAL NOT NULL,
        y REAL NOT NULL,
        PRIMARY KEY (attachment_id, item_id)
      );
    `,
  },
  {
    version: 8,
    name: 'sso_scim',
    sql: /* sql */ `
      ALTER TABLE users ADD COLUMN sso_subject TEXT;
      CREATE UNIQUE INDEX idx_users_sso_subject ON users(sso_subject) WHERE sso_subject IS NOT NULL;
      ALTER TABLE users ADD COLUMN auth_source TEXT NOT NULL DEFAULT 'local';
      ALTER TABLE users ADD COLUMN scim_external_id TEXT;
      CREATE UNIQUE INDEX idx_users_scim_external ON users(scim_external_id) WHERE scim_external_id IS NOT NULL;
      -- Session established through the IdP with MFA (satisfies MFA_REQUIRED_ROLES without local TOTP).
      ALTER TABLE sessions ADD COLUMN idp_mfa INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE sessions ADD COLUMN via_sso INTEGER NOT NULL DEFAULT 0;

      -- Pending OIDC logins: state / nonce / PKCE verifier stay server-side, one use, 10 minutes.
      CREATE TABLE sso_states (
        id TEXT PRIMARY KEY,                -- sha256 of the random cookie value
        state TEXT NOT NULL,
        nonce TEXT NOT NULL,
        code_verifier TEXT NOT NULL,
        next_path TEXT NOT NULL DEFAULT '/',
        expires_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 9,
    name: 'everyday',
    sql: /* sql */ `
      CREATE TABLE board_favorites (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (user_id, board_id)
      );
      -- Last time a user opened a board (one row per pair; trimmed to 20 per user).
      CREATE TABLE board_visits (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        visited_at TEXT NOT NULL,
        PRIMARY KEY (user_id, board_id)
      );
      CREATE INDEX idx_board_visits_user ON board_visits(user_id, visited_at);
      CREATE TABLE item_followers (
        item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (item_id, user_id)
      );
      CREATE INDEX idx_item_followers_user ON item_followers(user_id);
      -- One level of replies; deleting an update deletes its replies.
      ALTER TABLE item_updates ADD COLUMN parent_id TEXT REFERENCES item_updates(id) ON DELETE CASCADE;
      CREATE INDEX idx_updates_parent ON item_updates(parent_id);
      CREATE TABLE update_reactions (
        update_id TEXT NOT NULL REFERENCES item_updates(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        emoji TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (update_id, user_id, emoji)
      );
    `,
  },
  {
    version: 10,
    name: 'board_templates',
    sql: /* sql */ `
      -- Organisation board templates: structure only (groups + columns), never items or people.
      CREATE TABLE board_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        base_key TEXT NOT NULL,
        groups_json TEXT NOT NULL,
        columns_json TEXT NOT NULL,
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 11,
    name: 'password_resets',
    sql: /* sql */ `
      -- Self-service password reset links: only the SHA-256 of the token is stored; one use, 30 minutes.
      CREATE TABLE password_resets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT
      );
      CREATE INDEX idx_password_resets_user ON password_resets(user_id, created_at);
    `,
  },
];
