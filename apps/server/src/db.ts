import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Goal, GoalPriority, GoalStatus, LogLevel, RunStreamEvent, SseEvent } from "@openx/shared";
import { GOAL_PRIORITY_WEIGHT } from "@openx/shared";
import { getDbPath } from "./paths.js";

export const MAX_SSE_CATCHUP = 500;

let db: Database.Database | undefined;
let dbPathUsed: string | undefined;

/** 测试用：重置数据库连接 */
export function resetDb(): void {
  if (db) {
    db.close();
    db = undefined;
    dbPathUsed = undefined;
  }
}

export function getDb(): Database.Database {
  const path = getDbPath();
  if (db && dbPathUsed !== path) {
    db.close();
    db = undefined;
    dbPathUsed = undefined;
  }
  if (!db) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    db = new Database(path);
    db.pragma("journal_mode = WAL");
    migrate(db);
    dbPathUsed = path;
  }
  return db;
}

function ensureColumn(
  database: Database.Database,
  table: string,
  column: string,
  definition: string,
) {
  const cols = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function migrate(database: Database.Database) {
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

  ensureColumn(database, "goals", "parent_goal_id", "TEXT");
  ensureColumn(database, "goals", "depends_on_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(database, "goals", "priority", "TEXT NOT NULL DEFAULT 'medium'");
}

type GoalRow = {
  id: string;
  title: string;
  acceptance: string;
  user_draft: string | null;
  execution_prompt: string;
  constraints_json: string;
  executor_id: string;
  status: string;
  progress: number;
  result_summary: string | null;
  effect_status: string | null;
  rework_reason: string | null;
  parent_goal_id: string | null;
  depends_on_json: string;
  priority: string;
  created_at: string;
  updated_at: string;
};

function rowToGoal(row: GoalRow): Goal {
  return {
    id: row.id,
    title: row.title,
    acceptance: row.acceptance,
    userDraft: row.user_draft ?? undefined,
    executionPrompt: row.execution_prompt,
    constraints: JSON.parse(row.constraints_json) as string[],
    executorId: row.executor_id as Goal["executorId"],
    status: row.status as GoalStatus,
    progress: row.progress,
    resultSummary: row.result_summary ?? undefined,
    effectStatus: row.effect_status as Goal["effectStatus"],
    reworkReason: row.rework_reason ?? undefined,
    parentGoalId: row.parent_goal_id ?? undefined,
    dependsOn: JSON.parse(row.depends_on_json) as string[],
    priority: (row.priority as GoalPriority) || "medium",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listGoals(status?: GoalStatus): Goal[] {
  const database = getDb();
  if (status) {
    return database
      .prepare("SELECT * FROM goals WHERE status = ? ORDER BY updated_at DESC")
      .all(status)
      .map((r) => rowToGoal(r as GoalRow));
  }
  return database
    .prepare("SELECT * FROM goals ORDER BY updated_at DESC")
    .all()
    .map((r) => rowToGoal(r as GoalRow));
}

export function getGoalById(id: string): Goal | undefined {
  const row = getDb().prepare("SELECT * FROM goals WHERE id = ?").get(id) as
    | GoalRow
    | undefined;
  return row ? rowToGoal(row) : undefined;
}

export function listChildGoals(parentGoalId: string): Goal[] {
  return getDb()
    .prepare("SELECT * FROM goals WHERE parent_goal_id = ? ORDER BY created_at ASC")
    .all(parentGoalId)
    .map((r) => rowToGoal(r as GoalRow));
}

export function areDependenciesMet(goal: Goal): boolean {
  if (!goal.dependsOn?.length) return true;
  return goal.dependsOn.every((depId) => {
    const dep = getGoalById(depId);
    return dep?.status === "done";
  });
}

export function listRunnableDraftGoals(): Goal[] {
  return listGoals("draft")
    .filter(areDependenciesMet)
    .sort(
      (a, b) =>
        GOAL_PRIORITY_WEIGHT[a.priority] - GOAL_PRIORITY_WEIGHT[b.priority] ||
        a.createdAt.localeCompare(b.createdAt),
    );
}

export function insertGoal(goal: Goal): Goal {
  getDb()
    .prepare(
      `INSERT INTO goals (
        id, title, acceptance, user_draft, execution_prompt, constraints_json,
        executor_id, status, progress, result_summary, effect_status, rework_reason,
        parent_goal_id, depends_on_json, priority, created_at, updated_at
      ) VALUES (
        @id, @title, @acceptance, @userDraft, @executionPrompt, @constraintsJson,
        @executorId, @status, @progress, @resultSummary, @effectStatus, @reworkReason,
        @parentGoalId, @dependsOnJson, @priority, @createdAt, @updatedAt
      )`,
    )
    .run({
      id: goal.id,
      title: goal.title,
      acceptance: goal.acceptance,
      userDraft: goal.userDraft ?? null,
      executionPrompt: goal.executionPrompt,
      constraintsJson: JSON.stringify(goal.constraints),
      executorId: goal.executorId,
      status: goal.status,
      progress: goal.progress,
      resultSummary: goal.resultSummary ?? null,
      effectStatus: goal.effectStatus ?? null,
      reworkReason: goal.reworkReason ?? null,
      parentGoalId: goal.parentGoalId ?? null,
      dependsOnJson: JSON.stringify(goal.dependsOn ?? []),
      priority: goal.priority ?? "medium",
      createdAt: goal.createdAt,
      updatedAt: goal.updatedAt,
    });
  return goal;
}

export function updateGoal(goal: Goal): Goal {
  getDb()
    .prepare(
      `UPDATE goals SET
        title = @title, acceptance = @acceptance, user_draft = @userDraft,
        execution_prompt = @executionPrompt, constraints_json = @constraintsJson,
        executor_id = @executorId, status = @status, progress = @progress,
        result_summary = @resultSummary, effect_status = @effectStatus,
        rework_reason = @reworkReason, parent_goal_id = @parentGoalId,
        depends_on_json = @dependsOnJson, priority = @priority, updated_at = @updatedAt
      WHERE id = @id`,
    )
    .run({
      id: goal.id,
      title: goal.title,
      acceptance: goal.acceptance,
      userDraft: goal.userDraft ?? null,
      executionPrompt: goal.executionPrompt,
      constraintsJson: JSON.stringify(goal.constraints),
      executorId: goal.executorId,
      status: goal.status,
      progress: goal.progress,
      resultSummary: goal.resultSummary ?? null,
      effectStatus: goal.effectStatus ?? null,
      reworkReason: goal.reworkReason ?? null,
      parentGoalId: goal.parentGoalId ?? null,
      dependsOnJson: JSON.stringify(goal.dependsOn ?? []),
      priority: goal.priority ?? "medium",
      updatedAt: goal.updatedAt,
    });
  return goal;
}

/** CAS 式状态迁移：仅当当前状态在 fromStatuses 中时才更新 */
export function transitionGoalStatus(
  goalId: string,
  fromStatuses: GoalStatus[],
  to: GoalStatus,
): Goal | null {
  if (fromStatuses.length === 0) return null;
  const placeholders = fromStatuses.map(() => "?").join(", ");
  const now = new Date().toISOString();
  const result = getDb()
    .prepare(
      `UPDATE goals SET status = ?, updated_at = ? WHERE id = ? AND status IN (${placeholders})`,
    )
    .run(to, now, goalId, ...fromStatuses);
  if (result.changes === 0) return null;
  return getGoalById(goalId) ?? null;
}

function purgeGoalRecords(id: string): void {
  const database = getDb();
  database.prepare("DELETE FROM goal_logs WHERE goal_id = ?").run(id);
  database.prepare("DELETE FROM coach_messages WHERE goal_id = ?").run(id);
  database.prepare("DELETE FROM execution_summaries WHERE goal_id = ?").run(id);
  database.prepare("DELETE FROM run_events WHERE goal_id = ?").run(id);
  database.prepare("DELETE FROM goals WHERE id = ?").run(id);
}

function goalDepthInSet(id: string, idSet: Set<string>): number {
  const goal = getGoalById(id);
  if (!goal?.parentGoalId || !idSet.has(goal.parentGoalId)) return 0;
  return 1 + goalDepthInSet(goal.parentGoalId, idSet);
}

/** 硬删除目标（含子目标级联）；返回 deleted / failed */
export function deleteGoals(ids: string[]): {
  deleted: string[];
  failed: { id: string; error: string }[];
} {
  const deleted: string[] = [];
  const failed: { id: string; error: string }[] = [];
  const toDelete = new Set<string>();

  const collectDescendants = (id: string) => {
    if (!getGoalById(id)) return;
    toDelete.add(id);
    for (const child of listChildGoals(id)) {
      collectDescendants(child.id);
    }
  };

  for (const id of ids) {
    if (!getGoalById(id)) {
      failed.push({ id, error: "Not found" });
      continue;
    }
    collectDescendants(id);
  }

  const blocked = new Map<string, string>();
  for (const id of toDelete) {
    const blockers = listGoals().filter(
      (g) => !toDelete.has(g.id) && (g.dependsOn?.includes(id) ?? false),
    );
    if (blockers.length > 0) {
      blocked.set(id, `被「${blockers[0]!.title}」依赖`);
    }
  }

  const sorted = [...toDelete].sort(
    (a, b) => goalDepthInSet(b, toDelete) - goalDepthInSet(a, toDelete),
  );

  for (const id of sorted) {
    if (blocked.has(id)) {
      failed.push({ id, error: blocked.get(id)! });
      continue;
    }
    if (!getGoalById(id)) continue;
    purgeGoalRecords(id);
    deleted.push(id);
  }

  return { deleted, failed };
}

export function appendLog(
  goalId: string,
  level: LogLevel,
  message: string,
): { level: LogLevel; message: string; timestamp: string } {
  const timestamp = new Date().toISOString();
  getDb()
    .prepare(
      "INSERT INTO goal_logs (goal_id, level, message, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(goalId, level, message, timestamp);
  return { level, message, timestamp };
}

export function listLogs(goalId: string, limit = 200) {
  return getDb()
    .prepare(
      "SELECT level, message, created_at as timestamp FROM goal_logs WHERE goal_id = ? ORDER BY id DESC LIMIT ?",
    )
    .all(goalId, limit)
    .reverse() as { level: LogLevel; message: string; timestamp: string }[];
}

export function saveCoachMessage(
  goalId: string | null,
  role: "user" | "coach",
  text: string,
): { id: number; goalId: string | null; role: string; text: string; timestamp: string } {
  const timestamp = new Date().toISOString();
  const result = getDb()
    .prepare(
      "INSERT INTO coach_messages (goal_id, role, text, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(goalId, role, text, timestamp);
  return {
    id: Number(result.lastInsertRowid),
    goalId,
    role,
    text,
    timestamp,
  };
}

export function listCoachMessages(goalId?: string | null, limit = 80) {
  const database = getDb();
  if (goalId) {
    return database
      .prepare(
        `SELECT id, goal_id as goalId, role, text, created_at as timestamp
         FROM coach_messages WHERE goal_id = ? OR goal_id IS NULL
         ORDER BY id DESC LIMIT ?`,
      )
      .all(goalId, limit)
      .reverse() as {
      id: number;
      goalId: string | null;
      role: "user" | "coach";
      text: string;
      timestamp: string;
    }[];
  }
  return database
    .prepare(
      `SELECT id, goal_id as goalId, role, text, created_at as timestamp
       FROM coach_messages WHERE goal_id IS NULL
       ORDER BY id DESC LIMIT ?`,
    )
    .all(limit)
    .reverse() as {
    id: number;
    goalId: string | null;
    role: "user" | "coach";
    text: string;
    timestamp: string;
  }[];
}

export function saveExecutionSummary(
  goalId: string,
  summary: string,
  executorId: string,
): void {
  const timestamp = new Date().toISOString();
  getDb()
    .prepare(
      "INSERT INTO execution_summaries (goal_id, summary, executor_id, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(goalId, summary, executorId, timestamp);
}

export function listExecutionSummaries(goalId: string, limit = 5): string[] {
  return getDb()
    .prepare(
      "SELECT summary FROM execution_summaries WHERE goal_id = ? ORDER BY id DESC LIMIT ?",
    )
    .all(goalId, limit)
    .map((r) => (r as { summary: string }).summary)
    .reverse();
}

export function buildGoalFeedback(goalId: string) {
  const goal = getGoalById(goalId);
  if (!goal) return undefined;
  const recentLogs = listLogs(goalId, 20).map((l) => ({
    level: l.level,
    message: l.message,
  }));
  return {
    reworkReason: goal.reworkReason,
    resultSummary: goal.resultSummary,
    recentLogs,
    priorSummaries: listExecutionSummaries(goalId),
  };
}

export type StoredSseEvent = {
  id: number;
  eventType: SseEvent["type"];
  payload: SseEvent;
  createdAt: string;
};

export function appendSseEvent(event: SseEvent): StoredSseEvent {
  const createdAt = new Date().toISOString();
  const result = getDb()
    .prepare(
      "INSERT INTO sse_events (event_type, payload_json, created_at) VALUES (?, ?, ?)",
    )
    .run(event.type, JSON.stringify(event), createdAt);
  return {
    id: Number(result.lastInsertRowid),
    eventType: event.type,
    payload: event,
    createdAt,
  };
}

export function getSseEventById(id: number): StoredSseEvent | undefined {
  const row = getDb()
    .prepare(
      "SELECT id, event_type as eventType, payload_json as payloadJson, created_at as createdAt FROM sse_events WHERE id = ?",
    )
    .get(id) as
    | { id: number; eventType: string; payloadJson: string; createdAt: string }
    | undefined;
  if (!row) return undefined;
  return {
    id: row.id,
    eventType: row.eventType as SseEvent["type"],
    payload: JSON.parse(row.payloadJson) as SseEvent,
    createdAt: row.createdAt,
  };
}

export function countSseEventsAfter(afterId: number): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) as count FROM sse_events WHERE id > ?")
    .get(afterId) as { count: number };
  return row.count;
}

export function listSseEventsAfter(afterId: number, limit = MAX_SSE_CATCHUP): StoredSseEvent[] {
  return getDb()
    .prepare(
      `SELECT id, event_type as eventType, payload_json as payloadJson, created_at as createdAt
       FROM sse_events WHERE id > ? ORDER BY id ASC LIMIT ?`,
    )
    .all(afterId, limit)
    .map((row) => {
      const r = row as {
        id: number;
        eventType: string;
        payloadJson: string;
        createdAt: string;
      };
      return {
        id: r.id,
        eventType: r.eventType as SseEvent["type"],
        payload: JSON.parse(r.payloadJson) as SseEvent,
        createdAt: r.createdAt,
      };
    });
}

export function listRecentSseEvents(limit = 80): StoredSseEvent[] {
  return getDb()
    .prepare(
      `SELECT id, event_type as eventType, payload_json as payloadJson, created_at as createdAt
       FROM sse_events ORDER BY id DESC LIMIT ?`,
    )
    .all(limit)
    .reverse()
    .map((row) => {
      const r = row as {
        id: number;
        eventType: string;
        payloadJson: string;
        createdAt: string;
      };
      return {
        id: r.id,
        eventType: r.eventType as SseEvent["type"],
        payload: JSON.parse(r.payloadJson) as SseEvent,
        createdAt: r.createdAt,
      };
    });
}

const MAX_RUN_EVENTS_PER_GOAL = 400;

export function clearRunEvents(goalId: string): void {
  getDb().prepare("DELETE FROM run_events WHERE goal_id = ?").run(goalId);
}

export function appendRunEventRecord(
  goalId: string,
  runId: string,
  event: RunStreamEvent,
): void {
  const timestamp = new Date().toISOString();
  getDb()
    .prepare(
      "INSERT INTO run_events (goal_id, run_id, payload_json, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(goalId, runId, JSON.stringify(event), timestamp);
  const row = getDb()
    .prepare("SELECT COUNT(*) as count FROM run_events WHERE goal_id = ?")
    .get(goalId) as { count: number };
  if (row.count > MAX_RUN_EVENTS_PER_GOAL) {
    getDb()
      .prepare(
        `DELETE FROM run_events WHERE goal_id = ? AND id NOT IN (
          SELECT id FROM run_events WHERE goal_id = ? ORDER BY id DESC LIMIT ?
        )`,
      )
      .run(goalId, goalId, MAX_RUN_EVENTS_PER_GOAL);
  }
}

export function listRunEventRecords(goalId: string, limit = 200): RunStreamEvent[] {
  return getDb()
    .prepare(
      `SELECT payload_json as payloadJson FROM run_events
       WHERE goal_id = ? ORDER BY id ASC LIMIT ?`,
    )
    .all(goalId, limit)
    .map((row) => JSON.parse((row as { payloadJson: string }).payloadJson) as RunStreamEvent);
}
