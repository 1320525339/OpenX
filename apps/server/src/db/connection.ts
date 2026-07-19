import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getDbPath } from "../paths.js";

let db: Database.Database | undefined;
let dbPathUsed: string | undefined;
let lastIntegrityOk: boolean | undefined;
let lastIntegrityMessage: string | undefined;

/** 测试用：重置数据库连接 */
export function resetDb(): void {
  if (db) {
    db.close();
    db = undefined;
    dbPathUsed = undefined;
  }
  lastIntegrityOk = undefined;
  lastIntegrityMessage = undefined;
}

/** 最近一次启动完整性检查结果（文件库） */
export function getDbIntegrityStatus(): {
  ok: boolean | undefined;
  message: string | undefined;
} {
  return { ok: lastIntegrityOk, message: lastIntegrityMessage };
}

export function getDb(): Database.Database {
  const path = getDbPath();
  if (db && dbPathUsed !== path) {
    db.close();
    db = undefined;
    dbPathUsed = undefined;
    lastIntegrityOk = undefined;
    lastIntegrityMessage = undefined;
  }
  if (!db) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    db = new Database(path);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");
    if (path !== ":memory:") {
      runIntegrityCheck(db);
    } else {
      lastIntegrityOk = true;
      lastIntegrityMessage = "ok";
    }
    migrate(db);
    dbPathUsed = path;
  }
  return db;
}

function runIntegrityCheck(database: Database.Database): void {
  try {
    const row = database.prepare("PRAGMA integrity_check").get() as
      | { integrity_check: string }
      | undefined;
    const result = row?.integrity_check ?? "unknown";
    lastIntegrityOk = result === "ok";
    lastIntegrityMessage = result;
    if (!lastIntegrityOk) {
      console.error(`[db] 完整性检查失败: ${result}`);
    }
  } catch (err) {
    lastIntegrityOk = false;
    lastIntegrityMessage = err instanceof Error ? err.message : String(err);
    console.error("[db] 完整性检查异常:", err);
  }
}

export function ensureColumn(
  database: Database.Database,
  table: string,
  column: string,
  definition: string,
) {
  const cols = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    try {
      database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/duplicate column name/i.test(message)) throw err;
    }
  }
}

/** island_seen：从单列 PK 迁移到 (scope_key, island_id) 复合主键 */
function migrateIslandSeenCompositeKey(database: Database.Database): void {
  const idx = database
    .prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name = 'island_seen'`)
    .get() as { name: string; sql: string } | undefined;
  if (!idx?.sql) return;
  if (/PRIMARY KEY\s*\(\s*scope_key/i.test(idx.sql)) return;

  database.exec(`
    CREATE TABLE IF NOT EXISTS island_seen_v2 (
      island_id TEXT NOT NULL,
      scope_key TEXT NOT NULL DEFAULT 'global',
      seen_at TEXT NOT NULL,
      PRIMARY KEY (scope_key, island_id)
    );
    INSERT OR IGNORE INTO island_seen_v2 (island_id, scope_key, seen_at)
      SELECT island_id, COALESCE(scope_key, 'global'), seen_at FROM island_seen;
    DROP TABLE island_seen;
    ALTER TABLE island_seen_v2 RENAME TO island_seen;
    CREATE INDEX IF NOT EXISTS idx_island_seen_at ON island_seen(seen_at);
  `);
}

function backfillGoalOrderNumbers(database: Database.Database): void {
  const rows = database
    .prepare(
      "SELECT id FROM goals WHERE order_no IS NULL OR order_no <= 0 ORDER BY created_at ASC, id ASC",
    )
    .all() as { id: string }[];
  if (rows.length === 0) return;
  let next =
    (
      database.prepare("SELECT COALESCE(MAX(order_no), 0) AS maxNo FROM goals").get() as {
        maxNo: number;
      }
    ).maxNo + 1;
  const stmt = database.prepare("UPDATE goals SET order_no = ? WHERE id = ?");
  for (const row of rows) {
    stmt.run(next, row.id);
    next += 1;
  }
}

function backfillCoachCrewGoalIds(database: Database.Database): void {
  const rows = database
    .prepare(
      `SELECT id, conversation_id AS conversationId, text
       FROM coach_messages
       WHERE goal_id IS NULL AND kind = 'text' AND role = 'coach'
         AND text LIKE '[%] %'`,
    )
    .all() as { id: number; conversationId: string; text: string }[];
  if (rows.length === 0) return;
  const findGoal = database.prepare(
    `SELECT goal_id AS goalId FROM crew_messages
     WHERE conversation_id = ? AND summary = ?
     ORDER BY id DESC LIMIT 1`,
  );
  const update = database.prepare(
    "UPDATE coach_messages SET goal_id = ? WHERE id = ? AND goal_id IS NULL",
  );
  for (const row of rows) {
    const summary = row.text.replace(/^\[[^\]]+\]\s*/, "").trim();
    if (!summary) continue;
    const match = findGoal.get(row.conversationId, summary) as
      | { goalId: string }
      | undefined;
    if (match?.goalId) update.run(match.goalId, row.id);
  }
}

type SchemaMigration = {
  id: number;
  name: string;
  up: (database: Database.Database) => void;
};

const VERSIONED_MIGRATIONS: SchemaMigration[] = [
  {
    id: 2,
    name: "goals_query_indexes",
    up: (database) => {
      database.exec(`
        CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status);
        CREATE INDEX IF NOT EXISTS idx_goals_parent ON goals(parent_goal_id);
        CREATE INDEX IF NOT EXISTS idx_goals_updated ON goals(updated_at DESC);
      `);
    },
  },
  {
    id: 3,
    name: "purge_orphan_goal_side_tables",
    up: (database) => {
      database.exec(`
        DELETE FROM dispatch_receipts
          WHERE goal_id IS NOT NULL
            AND goal_id NOT IN (SELECT id FROM goals);
        DELETE FROM token_usage_events
          WHERE goal_id IS NOT NULL
            AND goal_id NOT IN (SELECT id FROM goals);
        DELETE FROM attention_records
          WHERE goal_id IS NOT NULL
            AND goal_id NOT IN (SELECT id FROM goals);
      `);
    },
  },
];

function ensureSchemaMigrationsTable(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    );
  `);
}

function appliedMigrationIds(database: Database.Database): Set<number> {
  const rows = database
    .prepare("SELECT id FROM schema_migrations")
    .all() as { id: number }[];
  return new Set(rows.map((r) => r.id));
}

function recordMigration(
  database: Database.Database,
  id: number,
  name: string,
): void {
  database
    .prepare(
      "INSERT OR IGNORE INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)",
    )
    .run(id, name, new Date().toISOString());
}

/** 幂等基线 schema（v1）+ 有序增量迁移 */
function migrate(database: Database.Database) {
  ensureSchemaMigrationsTable(database);
  const applied = appliedMigrationIds(database);

  database.transaction(() => {
    migrateBaseline(database);
    if (!applied.has(1)) {
      recordMigration(database, 1, "baseline");
    }
    for (const m of VERSIONED_MIGRATIONS) {
      if (applied.has(m.id)) continue;
      m.up(database);
      recordMigration(database, m.id, m.name);
    }
  })();
}

function migrateBaseline(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      acceptance TEXT NOT NULL,
      user_draft TEXT,
      execution_prompt TEXT NOT NULL,
      constraints_json TEXT NOT NULL DEFAULT '[]',
      executor_id TEXT NOT NULL,
      status TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      result_summary TEXT,
      effect_status TEXT,
      rework_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS goal_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      goal_id TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (goal_id) REFERENCES goals(id)
    );
    CREATE INDEX IF NOT EXISTS idx_goal_logs_goal ON goal_logs(goal_id);

    CREATE TABLE IF NOT EXISTS coach_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      goal_id TEXT,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_coach_messages_goal ON coach_messages(goal_id);

    CREATE TABLE IF NOT EXISTS execution_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      goal_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      executor_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (goal_id) REFERENCES goals(id)
    );
    CREATE INDEX IF NOT EXISTS idx_execution_summaries_goal ON execution_summaries(goal_id);

    CREATE TABLE IF NOT EXISTS sse_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sse_events_created ON sse_events(created_at);

    CREATE TABLE IF NOT EXISTS run_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      goal_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_run_events_goal ON run_events(goal_id, id);
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      workspace_dir TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id);

    CREATE TABLE IF NOT EXISTS island_seen (
      island_id TEXT NOT NULL,
      scope_key TEXT NOT NULL DEFAULT 'global',
      seen_at TEXT NOT NULL,
      PRIMARY KEY (scope_key, island_id)
    );
    CREATE INDEX IF NOT EXISTS idx_island_seen_at ON island_seen(seen_at);

    CREATE TABLE IF NOT EXISTS attention_records (
      key TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      goal_id TEXT,
      severity TEXT NOT NULL,
      state TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      scope_audience TEXT NOT NULL DEFAULT 'global',
      scope_user_id TEXT,
      scope_device_id TEXT,
      payload_json TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_attention_state ON attention_records(state, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_attention_goal ON attention_records(goal_id);
    CREATE INDEX IF NOT EXISTS idx_attention_expires ON attention_records(expires_at);

    CREATE TABLE IF NOT EXISTS coach_thread_checkpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      up_to_message_id INTEGER NOT NULL,
      summary_text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_coach_checkpoints_conv
      ON coach_thread_checkpoints(conversation_id, id DESC);

    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      project_id UNINDEXED,
      scope UNINDEXED,
      content,
      tokenize = 'unicode61'
    );
  `);

  ensureColumn(database, "goals", "parent_goal_id", "TEXT");
  ensureColumn(database, "goals", "depends_on_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(database, "goals", "priority", "TEXT NOT NULL DEFAULT 'medium'");
  ensureColumn(database, "goals", "auto_review", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "goals", "max_iterations", "INTEGER");
  ensureColumn(database, "goals", "iteration_count", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "goals", "conversation_id", "TEXT");
  ensureColumn(database, "goals", "deliverables_json", "TEXT");
  ensureColumn(database, "goals", "dispatch_context_json", "TEXT");
  ensureColumn(database, "goals", "waived", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "goals", "foreman_thread_id", "TEXT");
  ensureColumn(database, "goals", "crew_session_id", "TEXT");
  ensureColumn(database, "goals", "crew_status", "TEXT");
  ensureColumn(database, "goals", "order_no", "INTEGER");
  ensureColumn(database, "goals", "revision", "INTEGER NOT NULL DEFAULT 0");
  backfillGoalOrderNumbers(database);
  ensureColumn(database, "coach_messages", "conversation_id", "TEXT");
  ensureColumn(database, "coach_messages", "kind", "TEXT NOT NULL DEFAULT 'text'");
  ensureColumn(database, "coach_messages", "meta_json", "TEXT");
  ensureColumn(database, "projects", "llm_context_json", "TEXT");
  database.exec(
    "CREATE INDEX IF NOT EXISTS idx_goals_conversation ON goals(conversation_id)",
  );
  database.exec(
    "CREATE INDEX IF NOT EXISTS idx_coach_messages_conversation ON coach_messages(conversation_id)",
  );
  database.exec(`
    CREATE TABLE IF NOT EXISTS crew_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      goal_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      summary TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_crew_messages_goal ON crew_messages(goal_id, id);
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS integration_runs (
      id TEXT PRIMARY KEY,
      integration_id TEXT NOT NULL,
      lane TEXT NOT NULL,
      trace_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      goal_id TEXT,
      payload_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_integration_runs_integration
      ON integration_runs(integration_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_integration_runs_lane
      ON integration_runs(integration_id, lane, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_runs_idempotency
      ON integration_runs(integration_id, idempotency_key);

    CREATE TABLE IF NOT EXISTS integration_idempotency (
      idempotency_key TEXT NOT NULL,
      integration_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      PRIMARY KEY (integration_id, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS idx_integration_idempotency_expires
      ON integration_idempotency(expires_at);
  `);
  ensureColumn(database, "integration_runs", "source_key", "TEXT");
  ensureColumn(database, "integration_runs", "input_json", "TEXT");
  ensureColumn(database, "integration_runs", "result_json", "TEXT");
  ensureColumn(database, "integration_runs", "started_at", "TEXT");
  ensureColumn(database, "island_seen", "scope_key", "TEXT NOT NULL DEFAULT 'global'");
  migrateIslandSeenCompositeKey(database);

  database.exec(`
    CREATE TABLE IF NOT EXISTS dispatch_receipts (
      receipt_id TEXT PRIMARY KEY,
      goal_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      executor_id TEXT NOT NULL,
      dispatch_context_json TEXT,
      workspace_root TEXT,
      ack_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (goal_id) REFERENCES goals(id)
    );
    CREATE INDEX IF NOT EXISTS idx_dispatch_receipts_goal
      ON dispatch_receipts(goal_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_dispatch_receipts_run
      ON dispatch_receipts(run_id);

    CREATE TABLE IF NOT EXISTS token_usage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connection_id TEXT,
      goal_id TEXT,
      run_id TEXT,
      model TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      recorded_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_token_usage_goal
      ON token_usage_events(goal_id, recorded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_token_usage_connection
      ON token_usage_events(connection_id, recorded_at DESC);
  `);

  // 将历史 running + awaiting_user 升级为正式 paused
  database
    .prepare(
      `UPDATE goals SET status = 'paused', updated_at = ?
       WHERE status = 'running' AND crew_status = 'awaiting_user'`,
    )
    .run(new Date().toISOString());

  ensureColumn(database, "conversations", "mode", "TEXT NOT NULL DEFAULT 'foreman'");
  ensureColumn(database, "coach_messages", "speaker_type", "TEXT");
  ensureColumn(database, "coach_messages", "speaker_id", "TEXT");
  ensureColumn(database, "coach_messages", "reply_to_message_id", "INTEGER");
  ensureColumn(database, "coach_messages", "round_id", "TEXT");
  ensureColumn(database, "coach_messages", "generation_status", "TEXT");
  ensureColumn(database, "coach_messages", "generation_meta_json", "TEXT");

  database.exec(`
    CREATE TABLE IF NOT EXISTS ai_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      avatar TEXT,
      description TEXT NOT NULL DEFAULT '',
      role_prompt TEXT NOT NULL,
      model_ref TEXT NOT NULL,
      default_capability_ids_json TEXT NOT NULL DEFAULT '[]',
      builtin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversation_participants (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      model_ref TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      capability_ids_json TEXT NOT NULL DEFAULT '[]',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_conversation_participants_conv
      ON conversation_participants(conversation_id, sort_order);

    CREATE TABLE IF NOT EXISTS chat_rounds (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      source_message_id INTEGER,
      mode TEXT NOT NULL,
      participant_ids_json TEXT NOT NULL DEFAULT '[]',
      synthesize INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      estimated_calls INTEGER NOT NULL DEFAULT 0,
      output_goal TEXT,
      length TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_chat_rounds_conv
      ON chat_rounds(conversation_id, created_at DESC);
  `);
  ensureColumn(database, "chat_rounds", "composer_context_json", "TEXT");
  database.exec(`
    CREATE TABLE IF NOT EXISTS peer_requests (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      round_id TEXT,
      from_participant_id TEXT NOT NULL,
      to_participant_id TEXT NOT NULL,
      from_display_name TEXT NOT NULL,
      to_display_name TEXT NOT NULL,
      question TEXT NOT NULL,
      status TEXT NOT NULL,
      message_id INTEGER,
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_peer_requests_conv
      ON peer_requests(conversation_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS peer_mention_grants (
      conversation_id TEXT NOT NULL,
      from_participant_id TEXT NOT NULL,
      to_participant_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (conversation_id, from_participant_id, to_participant_id),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
  `);

  backfillCoachCrewGoalIds(database);
}

/** 可选：回收空闲页（备份后或大删除后调用） */
export function vacuumDb(): void {
  getDb().exec("VACUUM");
}
