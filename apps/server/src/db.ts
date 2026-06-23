import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { clearGoalCancelledForConnect } from "./connect-store.js";
import type {
  CoachClarifyMessage,
  CoachClarifyStatus,
  CoachDispatchPermissionMessage,
  CoachExecutionMeta,
  CoachExecutionMessage,
  CoachMessageRecord,
  CoachRefinedMessage,
  CoachTextMessage,
  CoachToolResultMessage,
  CoachToolResultPayload,
  Conversation,
  CrewExchangeDirection,
  CrewExchangeRecord,
  Goal,
  GoalPriority,
  GoalStatus,
  LogLevel,
  Project,
  RunStreamEvent,
  SseEvent,
} from "@openx/shared";
import {
  CoachClarifyPayloadSchema,
  CoachDispatchPermissionPayloadSchema,
  CoachExecutionMetaSchema,
  CoachToolResultPayloadSchema,
  CLARIFY_TOOL_NAME,
  DISPATCH_PERMISSION_TOOL_NAME,
  DispatchContextSchema,
  GoalDeliverableSchema,
  CONNECT_ANY_EXECUTOR_ID,
  GOAL_PRIORITY_WEIGHT,
  RefinedGoalSchema,
  WORK_ORDER_TOOL_NAME,
  OPERATOR_ACTION_TOOL_NAME,
  OperatorActionMetaSchema,
  findPendingClarifyRecordIds,
  CrewExchangeDirectionSchema,
} from "@openx/shared";
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
    try {
      database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/duplicate column name/i.test(message)) throw err;
    }
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
      island_id TEXT PRIMARY KEY,
      seen_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_island_seen_at ON island_seen(seen_at);

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
  backfillCoachCrewGoalIds(database);
}

type ProjectRow = {
  id: string;
  name: string;
  workspace_dir: string;
  created_at: string;
  llm_context_json: string | null;
};

type ConversationRow = {
  id: string;
  project_id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type GoalRow = {
  id: string;
  conversation_id: string | null;
  title: string;
  acceptance: string;
  user_draft: string | null;
  execution_prompt: string;
  constraints_json: string;
  executor_id: string;
  status: string;
  progress: number;
  result_summary: string | null;
  deliverables_json: string | null;
  effect_status: string | null;
  rework_reason: string | null;
  parent_goal_id: string | null;
  depends_on_json: string;
  priority: string;
  auto_review: number;
  max_iterations: number | null;
  iteration_count: number;
  dispatch_context_json: string | null;
  waived: number;
  foreman_thread_id: string | null;
  crew_session_id: string | null;
  crew_status: string | null;
  order_no: number | null;
  created_at: string;
  updated_at: string;
};

export function allocateWorkOrderNo(): number {
  const row = getDb()
    .prepare("SELECT COALESCE(MAX(order_no), 0) AS maxNo FROM goals")
    .get() as { maxNo: number };
  return row.maxNo + 1;
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

function parseDispatchContextJson(raw: string | null | undefined) {
  if (!raw?.trim()) return undefined;
  try {
    const parsed = DispatchContextSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function parseDeliverablesJson(raw: string | null | undefined) {
  if (!raw?.trim()) return undefined;
  try {
    const parsed = GoalDeliverableSchema.array().safeParse(JSON.parse(raw));
    return parsed.success && parsed.data.length > 0 ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function rowToGoal(row: GoalRow): Goal {
  return {
    id: row.id,
    orderNo: row.order_no && row.order_no > 0 ? row.order_no : 0,
    conversationId: row.conversation_id ?? "",
    title: row.title,
    acceptance: row.acceptance,
    userDraft: row.user_draft ?? undefined,
    executionPrompt: row.execution_prompt,
    constraints: JSON.parse(row.constraints_json) as string[],
    executorId: row.executor_id as Goal["executorId"],
    status: row.status as GoalStatus,
    progress: row.progress,
    resultSummary: row.result_summary ?? undefined,
    deliverables: parseDeliverablesJson(row.deliverables_json),
    effectStatus: row.effect_status as Goal["effectStatus"],
    reworkReason: row.rework_reason ?? undefined,
    parentGoalId: row.parent_goal_id ?? undefined,
    dependsOn: JSON.parse(row.depends_on_json) as string[],
    priority: (row.priority as GoalPriority) || "medium",
    autoReview: row.auto_review === 1,
    maxIterations: row.max_iterations ?? undefined,
    iterationCount: row.iteration_count ?? 0,
    dispatchContext: parseDispatchContextJson(row.dispatch_context_json),
    waived: row.waived === 1 ? true : undefined,
    foremanThreadId: row.foreman_thread_id ?? undefined,
    crewSessionId: row.crew_session_id ?? undefined,
    crewStatus: (row.crew_status as Goal["crewStatus"]) ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type ListGoalsFilter = {
  status?: GoalStatus;
  conversationId?: string;
  projectId?: string;
  displayFilter?: string;
};

export type GoalsPageQuery = {
  limit: number;
  offset: number;
};

export type GoalsPageResult = {
  goals: Goal[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

export type GoalDisplayCounts = {
  all: number;
  incomplete: number;
  failed: number;
  done: number;
  rework: number;
};

export type LogPageRow = {
  goalId: string;
  level: LogLevel;
  message: string;
  timestamp: string;
};

export type LogsPageResult = {
  logs: LogPageRow[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

function buildGoalsFilterClause(filter: ListGoalsFilter): { where: string; params: unknown[] } {
  const conditions: string[] = ["conversation_id IS NOT NULL"];
  const params: unknown[] = [];
  if (filter.status) {
    conditions.push("status = ?");
    params.push(filter.status);
  }
  if (filter.conversationId) {
    conditions.push("conversation_id = ?");
    params.push(filter.conversationId);
  }
  if (filter.projectId) {
    conditions.push(
      "conversation_id IN (SELECT id FROM conversations WHERE project_id = ?)",
    );
    params.push(filter.projectId);
  }
  const displayFilter = filter.displayFilter;
  if (displayFilter && displayFilter !== "all") {
    if (displayFilter === "incomplete") {
      conditions.push("status NOT IN ('done', 'failed', 'cancelled')");
    } else if (displayFilter === "failed") {
      conditions.push("status IN ('failed', 'cancelled')");
    } else if (displayFilter === "done") {
      conditions.push("status = 'done'");
    } else if (displayFilter === "rework") {
      conditions.push("status = 'running' AND effect_status = 'rework'");
    } else if (displayFilter === "awaiting_review") {
      conditions.push("status = 'awaiting_review'");
    } else if (displayFilter === "running") {
      conditions.push("status = 'running'");
    } else if (displayFilter === "draft") {
      conditions.push("status = 'draft'");
    } else {
      conditions.push("status = ?");
      params.push(displayFilter);
    }
  }
  return {
    where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

export function listGoalsPage(
  filter: ListGoalsFilter = {},
  page: GoalsPageQuery = { limit: 80, offset: 0 },
): GoalsPageResult {
  const database = getDb();
  const { where, params } = buildGoalsFilterClause(filter);
  const limit = Math.min(Math.max(page.limit, 1), 500);
  const offset = Math.max(page.offset, 0);
  const totalRow = database
    .prepare(`SELECT COUNT(*) AS total FROM goals ${where}`)
    .get(...params) as { total: number };
  const goals = database
    .prepare(
      `SELECT * FROM goals ${where} ORDER BY order_no ASC, created_at ASC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset)
    .map((r) => rowToGoal(r as GoalRow));
  const total = totalRow.total ?? 0;
  return {
    goals,
    total,
    limit,
    offset,
    hasMore: offset + goals.length < total,
  };
}

export function countGoalsByDisplay(filter: ListGoalsFilter = {}): GoalDisplayCounts {
  const database = getDb();
  const base = { ...filter, displayFilter: undefined as string | undefined };
  const countFor = (displayFilter: string) => {
    const { where, params } = buildGoalsFilterClause({ ...base, displayFilter });
    const row = database
      .prepare(`SELECT COUNT(*) AS total FROM goals ${where}`)
      .get(...params) as { total: number };
    return row.total ?? 0;
  };
  return {
    all: countFor("all"),
    incomplete: countFor("incomplete"),
    failed: countFor("failed"),
    done: countFor("done"),
    rework: countFor("rework"),
  };
}

export function listLogsPage(opts: {
  goalId?: string;
  limit?: number;
  offset?: number;
}): LogsPageResult {
  const database = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 120, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (opts.goalId) {
    conditions.push("goal_id = ?");
    params.push(opts.goalId);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const totalRow = database
    .prepare(`SELECT COUNT(*) AS total FROM goal_logs ${where}`)
    .get(...params) as { total: number };
  const logs = database
    .prepare(
      `SELECT goal_id AS goalId, level, message, created_at AS timestamp
       FROM goal_logs ${where}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset)
    .reverse() as LogPageRow[];
  const total = totalRow.total ?? 0;
  return {
    logs,
    total,
    limit,
    offset,
    hasMore: offset + logs.length < total,
  };
}

export function listGoals(filter?: GoalStatus | ListGoalsFilter): Goal[] {
  const database = getDb();
  const f: ListGoalsFilter =
    typeof filter === "string" ? { status: filter } : (filter ?? {});
  const { where, params } = buildGoalsFilterClause(f);
  return database
    .prepare(`SELECT * FROM goals ${where} ORDER BY order_no ASC, created_at ASC`)
    .all(...params)
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
    return dep?.status === "done" || dep?.waived === true;
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
  const orderNo = goal.orderNo > 0 ? goal.orderNo : allocateWorkOrderNo();
  const record: Goal = { ...goal, orderNo };
  getDb()
    .prepare(
      `INSERT INTO goals (
        id, order_no, conversation_id, title, acceptance, user_draft, execution_prompt, constraints_json,
        executor_id, status, progress, result_summary, deliverables_json, effect_status, rework_reason,
        parent_goal_id, depends_on_json, priority, auto_review, max_iterations,
        iteration_count, dispatch_context_json, waived,
        foreman_thread_id, crew_session_id, crew_status,
        created_at, updated_at
      ) VALUES (
        @id, @orderNo, @conversationId, @title, @acceptance, @userDraft, @executionPrompt, @constraintsJson,
        @executorId, @status, @progress, @resultSummary, @deliverablesJson, @effectStatus, @reworkReason,
        @parentGoalId, @dependsOnJson, @priority, @autoReview, @maxIterations,
        @iterationCount, @dispatchContextJson, @waived,
        @foremanThreadId, @crewSessionId, @crewStatus,
        @createdAt, @updatedAt
      )`,
    )
    .run({
      id: record.id,
      orderNo: record.orderNo,
      conversationId: record.conversationId,
      title: record.title,
      acceptance: record.acceptance,
      userDraft: record.userDraft ?? null,
      executionPrompt: record.executionPrompt,
      constraintsJson: JSON.stringify(record.constraints),
      executorId: record.executorId,
      status: record.status,
      progress: record.progress,
      resultSummary: record.resultSummary ?? null,
      deliverablesJson:
        record.deliverables && record.deliverables.length > 0
          ? JSON.stringify(record.deliverables)
          : null,
      effectStatus: record.effectStatus ?? null,
      reworkReason: record.reworkReason ?? null,
      parentGoalId: record.parentGoalId ?? null,
      dependsOnJson: JSON.stringify(record.dependsOn ?? []),
      priority: record.priority ?? "medium",
      autoReview: record.autoReview ? 1 : 0,
      maxIterations: record.maxIterations ?? null,
      iterationCount: record.iterationCount ?? 0,
      dispatchContextJson: record.dispatchContext
        ? JSON.stringify(record.dispatchContext)
        : null,
      waived: record.waived ? 1 : 0,
      foremanThreadId: record.foremanThreadId ?? null,
      crewSessionId: record.crewSessionId ?? null,
      crewStatus: record.crewStatus ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  return record;
}

export function updateGoalCrewBinding(
  goalId: string,
  patch: {
    foremanThreadId?: string;
    crewSessionId?: string;
    crewStatus?: Goal["crewStatus"] | null;
  },
): Goal | undefined {
  const goal = getGoalById(goalId);
  if (!goal) return undefined;
  if (patch.foremanThreadId !== undefined) {
    goal.foremanThreadId = patch.foremanThreadId;
  }
  if (patch.crewSessionId !== undefined) {
    goal.crewSessionId = patch.crewSessionId;
  }
  if (patch.crewStatus !== undefined) {
    goal.crewStatus = patch.crewStatus ?? undefined;
  }
  goal.updatedAt = new Date().toISOString();
  return updateGoal(goal);
}

export function updateGoal(goal: Goal): Goal {
  getDb()
    .prepare(
      `UPDATE goals SET
        title = @title, acceptance = @acceptance, user_draft = @userDraft,
        execution_prompt = @executionPrompt, constraints_json = @constraintsJson,
        executor_id = @executorId, status = @status, progress = @progress,
        result_summary = @resultSummary, deliverables_json = @deliverablesJson,
        effect_status = @effectStatus,
        rework_reason = @reworkReason, parent_goal_id = @parentGoalId,
        depends_on_json = @dependsOnJson, priority = @priority,
        auto_review = @autoReview, max_iterations = @maxIterations,
        iteration_count = @iterationCount, dispatch_context_json = @dispatchContextJson,
        waived = @waived,
        foreman_thread_id = @foremanThreadId, crew_session_id = @crewSessionId,
        crew_status = @crewStatus,
        updated_at = @updatedAt
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
      deliverablesJson:
        goal.deliverables && goal.deliverables.length > 0
          ? JSON.stringify(goal.deliverables)
          : null,
      effectStatus: goal.effectStatus ?? null,
      reworkReason: goal.reworkReason ?? null,
      parentGoalId: goal.parentGoalId ?? null,
      dependsOnJson: JSON.stringify(goal.dependsOn ?? []),
      priority: goal.priority ?? "medium",
      autoReview: goal.autoReview ? 1 : 0,
      maxIterations: goal.maxIterations ?? null,
      iterationCount: goal.iterationCount ?? 0,
      dispatchContextJson: goal.dispatchContext
        ? JSON.stringify(goal.dispatchContext)
        : null,
      waived: goal.waived ? 1 : 0,
      foremanThreadId: goal.foremanThreadId ?? null,
      crewSessionId: goal.crewSessionId ?? null,
      crewStatus: goal.crewStatus ?? null,
      updatedAt: goal.updatedAt,
    });
  return goal;
}

/** CAS：将 connect:any 任务认领给指定 executor（单条） */
export function claimConnectPoolGoal(goalId: string, executorId: string): Goal | null {
  const now = new Date().toISOString();
  const info = getDb()
    .prepare(
      `UPDATE goals SET executor_id = @executorId, updated_at = @updatedAt
       WHERE id = @goalId AND executor_id = @poolId AND status = 'running'`,
    )
    .run({
      goalId,
      executorId,
      updatedAt: now,
      poolId: CONNECT_ANY_EXECUTOR_ID,
    });
  if (info.changes === 0) return null;
  return getGoalById(goalId) ?? null;
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
  // 清理 Connect 取消标记，避免 cancelledGoalIds Set 无限增长
  clearGoalCancelledForConnect(id);
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
  // 一次性读取所有目标，避免循环内 N 次全表扫描
  const allGoals = listGoals();
  for (const id of toDelete) {
    const blocker = allGoals.find(
      (g) => !toDelete.has(g.id) && (g.dependsOn?.includes(id) ?? false),
    );
    if (blocker) {
      blocked.set(id, `被「${blocker.title}」依赖`);
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

type CoachMessageRow = {
  id: number;
  conversationId: string;
  goal_id: string | null;
  role: string;
  text: string;
  timestamp: string;
  kind: string;
  meta_json: string | null;
};

function rowToCoachMessage(row: CoachMessageRow): CoachMessageRecord {
  if (row.kind === "execution" && row.meta_json) {
    const execution = CoachExecutionMetaSchema.parse(JSON.parse(row.meta_json));
    return {
      id: row.id,
      conversationId: row.conversationId,
      kind: "execution",
      timestamp: row.timestamp,
      execution,
    };
  }
  if (row.kind === "refined" && row.meta_json) {
    const refined = RefinedGoalSchema.parse(JSON.parse(row.meta_json));
    const linkedClarifyMessageId =
      row.text && /^\d+$/.test(row.text) ? Number(row.text) : undefined;
    return {
      id: row.id,
      conversationId: row.conversationId,
      kind: "refined",
      timestamp: row.timestamp,
      refined,
      linkedGoalId: row.goal_id ?? undefined,
      linkedClarifyMessageId,
    };
  }
  if (row.kind === "clarify" && row.meta_json) {
    const clarify = CoachClarifyPayloadSchema.parse(JSON.parse(row.meta_json));
    const linkedRefinedMessageId =
      row.text && /^\d+$/.test(row.text) ? Number(row.text) : undefined;
    return {
      id: row.id,
      conversationId: row.conversationId,
      kind: "clarify",
      timestamp: row.timestamp,
      clarify,
      linkedRefinedMessageId,
    };
  }
  if (row.kind === "tool_result" && row.meta_json) {
    const toolResult = CoachToolResultPayloadSchema.parse(JSON.parse(row.meta_json));
    return {
      id: row.id,
      conversationId: row.conversationId,
      kind: "tool_result",
      timestamp: row.timestamp,
      toolResult,
    };
  }
  if (row.kind === "operator_action" && row.meta_json) {
    const operatorAction = OperatorActionMetaSchema.parse(JSON.parse(row.meta_json));
    return {
      id: row.id,
      conversationId: row.conversationId,
      kind: "operator_action",
      timestamp: row.timestamp,
      operatorAction,
    };
  }
  if (row.kind === "dispatch_permission" && row.meta_json) {
    const dispatchPermission = CoachDispatchPermissionPayloadSchema.parse(
      JSON.parse(row.meta_json),
    );
    return {
      id: row.id,
      conversationId: row.conversationId,
      kind: "dispatch_permission",
      timestamp: row.timestamp,
      dispatchPermission,
    };
  }
  return {
    id: row.id,
    conversationId: row.conversationId,
    kind: "text",
    role: row.role as "user" | "coach",
    text: row.text,
    timestamp: row.timestamp,
    linkedGoalId: row.goal_id ?? undefined,
  };
}

export function saveCoachMessage(
  conversationId: string,
  role: "user" | "coach",
  text: string,
  goalId?: string | null,
): CoachTextMessage {
  const timestamp = new Date().toISOString();
  const result = getDb()
    .prepare(
      `INSERT INTO coach_messages (conversation_id, goal_id, role, text, kind, meta_json, created_at)
       VALUES (?, ?, ?, ?, 'text', NULL, ?)`,
    )
    .run(conversationId, goalId ?? null, role, text, timestamp);
  touchConversation(conversationId);
  return {
    id: Number(result.lastInsertRowid),
    conversationId,
    kind: "text",
    role,
    text,
    timestamp,
    linkedGoalId: goalId ?? undefined,
  };
}

export function hasCoachExecutionMessage(
  conversationId: string,
  goalId: string,
  runId: string,
): boolean {
  const row = getDb()
    .prepare(
      `SELECT id FROM coach_messages
       WHERE conversation_id = ? AND kind = 'execution'
         AND json_extract(meta_json, '$.goalId') = ?
         AND json_extract(meta_json, '$.runId') = ?
       LIMIT 1`,
    )
    .get(conversationId, goalId, runId) as { id: number } | undefined;
  return Boolean(row);
}

export function linkCoachRefinedMessage(messageId: number, goalId: string): void {
  getDb()
    .prepare(
      `UPDATE coach_messages SET goal_id = ? WHERE id = ? AND kind = 'refined'`,
    )
    .run(goalId, messageId);
}

export function getCoachMessageById(
  messageId: number,
): CoachMessageRecord | null {
  const row = getDb()
    .prepare(
      `SELECT id, conversation_id as conversationId, goal_id, role, text, kind, meta_json,
              created_at as timestamp
       FROM coach_messages WHERE id = ?`,
    )
    .get(messageId) as CoachMessageRow | undefined;
  return row ? rowToCoachMessage(row) : null;
}

export function hasWorkOrderToolResult(
  conversationId: string,
  refinedMessageId: number,
): boolean {
  const row = getDb()
    .prepare(
      `SELECT id FROM coach_messages
       WHERE conversation_id = ? AND kind = 'tool_result'
         AND json_extract(meta_json, '$.toolName') = ?
         AND json_extract(meta_json, '$.refinedMessageId') = ?
       LIMIT 1`,
    )
    .get(conversationId, WORK_ORDER_TOOL_NAME, refinedMessageId) as
    | { id: number }
    | undefined;
  return Boolean(row);
}

export function hasClarifyToolResult(
  conversationId: string,
  clarifyMessageId: number,
): boolean {
  const row = getDb()
    .prepare(
      `SELECT id FROM coach_messages
       WHERE conversation_id = ? AND kind = 'tool_result'
         AND json_extract(meta_json, '$.toolName') = ?
         AND json_extract(meta_json, '$.clarifyMessageId') = ?
       LIMIT 1`,
    )
    .get(conversationId, CLARIFY_TOOL_NAME, clarifyMessageId) as
    | { id: number }
    | undefined;
  return Boolean(row);
}

export function hasOperatorActionToolResult(
  conversationId: string,
  operatorMessageId: number,
): boolean {
  const row = getDb()
    .prepare(
      `SELECT id FROM coach_messages
       WHERE conversation_id = ? AND kind = 'tool_result'
         AND json_extract(meta_json, '$.toolName') = ?
         AND json_extract(meta_json, '$.operatorMessageId') = ?
       LIMIT 1`,
    )
    .get(conversationId, OPERATOR_ACTION_TOOL_NAME, operatorMessageId) as
    | { id: number }
    | undefined;
  return Boolean(row);
}

export function saveCoachOperatorToolTrace(
  conversationId: string,
  toolCalls: Array<{ name: string; args: unknown; result: unknown }>,
): void {
  for (const tc of toolCalls) {
    const pending =
      tc.name === "openx_call_api" ||
      tc.name === "request_admin_access" ||
      tc.name === "propose_dispatch_permission"
        ? (tc.result as { kind?: string })?.kind === "pending" ||
          (tc.result as { kind?: string })?.kind === "proposal"
        : false;
    if (pending) continue;
    const payload = JSON.stringify({ args: tc.args, result: tc.result });
    const text = `[工具调用 ${tc.name}] ${payload.length > 4000 ? `${payload.slice(0, 4000)}…` : payload}`;
    saveCoachMessage(conversationId, "coach", text);
  }
}

export function saveCoachToolResultMessage(
  conversationId: string,
  toolResult: CoachToolResultPayload,
): CoachToolResultMessage {
  const timestamp = new Date().toISOString();
  const dismissed = toolResult.outcome === "dismissed";
  const metaJson = JSON.stringify({
    ...toolResult,
    dismissed,
  });
  const goalId =
    toolResult.toolName === WORK_ORDER_TOOL_NAME
      ? (toolResult.goalId ?? null)
      : null;
  const result = getDb()
    .prepare(
      `INSERT INTO coach_messages (conversation_id, goal_id, role, text, kind, meta_json, created_at)
       VALUES (?, ?, 'coach', '', 'tool_result', ?, ?)`,
    )
    .run(
      conversationId,
      goalId,
      metaJson,
      timestamp,
    );
  touchConversation(conversationId);
  return {
    id: Number(result.lastInsertRowid),
    conversationId,
    kind: "tool_result",
    timestamp,
    toolResult,
  };
}

export function saveCoachClarifyMessage(
  conversationId: string,
  clarify: CoachClarifyMessage["clarify"],
): CoachClarifyMessage {
  const timestamp = new Date().toISOString();
  const metaJson = JSON.stringify(clarify);
  const result = getDb()
    .prepare(
      `INSERT INTO coach_messages (conversation_id, goal_id, role, text, kind, meta_json, created_at)
       VALUES (?, NULL, 'coach', '', 'clarify', ?, ?)`,
    )
    .run(conversationId, metaJson, timestamp);
  touchConversation(conversationId);
  return {
    id: Number(result.lastInsertRowid),
    conversationId,
    kind: "clarify",
    timestamp,
    clarify,
  };
}

export function saveCoachDispatchPermissionMessage(
  conversationId: string,
  dispatchPermission: CoachDispatchPermissionMessage["dispatchPermission"],
): CoachDispatchPermissionMessage {
  const timestamp = new Date().toISOString();
  const metaJson = JSON.stringify(dispatchPermission);
  const result = getDb()
    .prepare(
      `INSERT INTO coach_messages (conversation_id, goal_id, role, text, kind, meta_json, created_at)
       VALUES (?, NULL, 'coach', '', 'dispatch_permission', ?, ?)`,
    )
    .run(conversationId, metaJson, timestamp);
  touchConversation(conversationId);
  return {
    id: Number(result.lastInsertRowid),
    conversationId,
    kind: "dispatch_permission",
    timestamp,
    dispatchPermission,
  };
}

export function updateCoachDispatchPermissionStatus(
  messageId: number,
  status: "confirmed" | "dismissed",
): void {
  const row = getDb()
    .prepare(`SELECT meta_json FROM coach_messages WHERE id = ? AND kind = 'dispatch_permission'`)
    .get(messageId) as { meta_json: string } | undefined;
  if (!row?.meta_json) return;
  const payload = CoachDispatchPermissionPayloadSchema.parse(JSON.parse(row.meta_json));
  const metaJson = JSON.stringify({ ...payload, status });
  getDb()
    .prepare(`UPDATE coach_messages SET meta_json = ? WHERE id = ?`)
    .run(metaJson, messageId);
}

export function hasDispatchPermissionToolResult(
  conversationId: string,
  dispatchPermissionMessageId: number,
): boolean {
  const row = getDb()
    .prepare(
      `SELECT id FROM coach_messages
       WHERE conversation_id = ? AND kind = 'tool_result'
         AND json_extract(meta_json, '$.toolName') = ?
         AND json_extract(meta_json, '$.dispatchPermissionMessageId') = ?
       LIMIT 1`,
    )
    .get(conversationId, DISPATCH_PERMISSION_TOOL_NAME, dispatchPermissionMessageId) as
    | { id: number }
    | undefined;
  return Boolean(row);
}

export function updateCoachClarifyStatus(
  messageId: number,
  status: CoachClarifyStatus,
): void {
  const row = getDb()
    .prepare(`SELECT meta_json FROM coach_messages WHERE id = ? AND kind = 'clarify'`)
    .get(messageId) as { meta_json: string } | undefined;
  if (!row?.meta_json) return;
  const clarify = CoachClarifyPayloadSchema.parse(JSON.parse(row.meta_json));
  const metaJson = JSON.stringify({ ...clarify, status });
  getDb()
    .prepare(`UPDATE coach_messages SET meta_json = ? WHERE id = ?`)
    .run(metaJson, messageId);
}

/** 澄清回答后关联生成的工单消息（存于 text 列，仅 clarify kind） */
export function linkCoachClarifyToRefined(
  clarifyMessageId: number,
  refinedMessageId: number,
): void {
  getDb()
    .prepare(
      `UPDATE coach_messages SET text = ? WHERE id = ? AND kind = 'clarify'`,
    )
    .run(String(refinedMessageId), clarifyMessageId);
}

export function saveCoachRefinedMessage(
  conversationId: string,
  refined: CoachRefinedMessage["refined"],
  opts?: { linkedClarifyMessageId?: number },
): CoachRefinedMessage {
  const timestamp = new Date().toISOString();
  const metaJson = JSON.stringify(refined);
  const linkText =
    opts?.linkedClarifyMessageId != null
      ? String(opts.linkedClarifyMessageId)
      : "";
  const result = getDb()
    .prepare(
      `INSERT INTO coach_messages (conversation_id, goal_id, role, text, kind, meta_json, created_at)
       VALUES (?, NULL, 'coach', ?, 'refined', ?, ?)`,
    )
    .run(conversationId, linkText, metaJson, timestamp);
  touchConversation(conversationId);
  return {
    id: Number(result.lastInsertRowid),
    conversationId,
    kind: "refined",
    timestamp,
    refined,
    linkedClarifyMessageId: opts?.linkedClarifyMessageId,
  };
}

export function saveCoachExecutionMessage(
  conversationId: string,
  execution: CoachExecutionMeta,
): CoachExecutionMessage {
  const timestamp = new Date().toISOString();
  const metaJson = JSON.stringify(execution);
  const result = getDb()
    .prepare(
      `INSERT INTO coach_messages (conversation_id, goal_id, role, text, kind, meta_json, created_at)
       VALUES (?, ?, 'coach', '', 'execution', ?, ?)`,
    )
    .run(conversationId, execution.goalId, metaJson, timestamp);
  touchConversation(conversationId);
  return {
    id: Number(result.lastInsertRowid),
    conversationId,
    kind: "execution",
    timestamp,
    execution,
  };
}

export function listCoachMessages(
  conversationId: string,
  limit = 80,
): CoachMessageRecord[] {
  return (
    getDb()
      .prepare(
        `SELECT id, conversation_id as conversationId, goal_id, role, text, kind, meta_json,
                created_at as timestamp
         FROM coach_messages WHERE conversation_id = ?
         ORDER BY id DESC LIMIT ?`,
      )
      .all(conversationId, limit)
      .reverse() as CoachMessageRow[]
  ).map(rowToCoachMessage);
}

export function listPendingClarifyIdsForConversation(
  conversationId: string,
): number[] {
  const records = listCoachMessages(conversationId, 200);
  return findPendingClarifyRecordIds(records);
}

export function hasLatestReviewPass(goalId: string): boolean {
  const entries = listReviewRoundEntries(goalId, 5);
  const latest = entries[entries.length - 1];
  return latest?.verdict === "pass";
}

export type CoachThreadCheckpoint = {
  id: number;
  conversationId: string;
  upToMessageId: number;
  summaryText: string;
  createdAt: string;
};

export function getLatestCoachThreadCheckpoint(
  conversationId: string,
): CoachThreadCheckpoint | undefined {
  const row = getDb()
    .prepare(
      `SELECT id, conversation_id as conversationId, up_to_message_id as upToMessageId,
              summary_text as summaryText, created_at as createdAt
       FROM coach_thread_checkpoints
       WHERE conversation_id = ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(conversationId) as CoachThreadCheckpoint | undefined;
  return row;
}

export function saveCoachThreadCheckpoint(input: {
  conversationId: string;
  upToMessageId: number;
  summaryText: string;
}): CoachThreadCheckpoint {
  const createdAt = new Date().toISOString();
  const result = getDb()
    .prepare(
      `INSERT INTO coach_thread_checkpoints
       (conversation_id, up_to_message_id, summary_text, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(
      input.conversationId,
      input.upToMessageId,
      input.summaryText,
      createdAt,
    );
  return {
    id: Number(result.lastInsertRowid),
    conversationId: input.conversationId,
    upToMessageId: input.upToMessageId,
    summaryText: input.summaryText,
    createdAt,
  };
}

export type MemorySearchHit = {
  projectId: string;
  scope: string;
  content: string;
  rank: number;
};

export function indexMemoryChunk(
  projectId: string,
  scope: string,
  content: string,
): void {
  getDb()
    .prepare(
      `INSERT INTO memory_fts (project_id, scope, content) VALUES (?, ?, ?)`,
    )
    .run(projectId, scope, content);
}

export function clearMemoryIndex(projectId: string, scope?: string): void {
  if (scope) {
    getDb()
      .prepare(`DELETE FROM memory_fts WHERE project_id = ? AND scope = ?`)
      .run(projectId, scope);
    return;
  }
  getDb()
    .prepare(`DELETE FROM memory_fts WHERE project_id = ?`)
    .run(projectId);
}

export function searchMemoryFts(
  projectId: string,
  query: string,
  limit = 5,
  scope?: string,
): MemorySearchHit[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const terms = trimmed
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"`)
    .join(" OR ");
  if (!terms) return [];
  if (scope) {
    return getDb()
      .prepare(
        `SELECT project_id as projectId, scope, content,
                bm25(memory_fts) as rank
         FROM memory_fts
         WHERE project_id = ? AND scope = ? AND memory_fts MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(projectId, scope, terms, limit) as MemorySearchHit[];
  }
  return getDb()
    .prepare(
      `SELECT project_id as projectId, scope, content,
              bm25(memory_fts) as rank
       FROM memory_fts
       WHERE project_id = ? AND memory_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
    )
    .all(projectId, terms, limit) as MemorySearchHit[];
}

function rowToProject(row: ProjectRow): Project {
  let llmContext: Project["llmContext"];
  if (row.llm_context_json) {
    try {
      llmContext = JSON.parse(row.llm_context_json) as Project["llmContext"];
    } catch {
      llmContext = undefined;
    }
  }
  return {
    id: row.id,
    name: row.name,
    workspaceDir: row.workspace_dir,
    createdAt: row.created_at,
    llmContext,
  };
}

function rowToConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listProjects(): Project[] {
  return getDb()
    .prepare("SELECT * FROM projects ORDER BY created_at ASC")
    .all()
    .map((r) => rowToProject(r as ProjectRow));
}

export function getProjectById(id: string): Project | undefined {
  const row = getDb().prepare("SELECT * FROM projects WHERE id = ?").get(id) as
    | ProjectRow
    | undefined;
  return row ? rowToProject(row) : undefined;
}

export function insertProject(project: Project): Project {
  getDb()
    .prepare(
      "INSERT INTO projects (id, name, workspace_dir, created_at, llm_context_json) VALUES (?, ?, ?, ?, ?)",
    )
    .run(
      project.id,
      project.name,
      project.workspaceDir,
      project.createdAt,
      project.llmContext ? JSON.stringify(project.llmContext) : null,
    );
  return project;
}

export function updateProject(project: Project): Project {
  getDb()
    .prepare(
      "UPDATE projects SET name = ?, workspace_dir = ?, llm_context_json = ? WHERE id = ?",
    )
    .run(
      project.name,
      project.workspaceDir,
      project.llmContext ? JSON.stringify(project.llmContext) : null,
      project.id,
    );
  return project;
}

export function deleteProject(id: string): boolean {
  const database = getDb();
  const convIds = database
    .prepare("SELECT id FROM conversations WHERE project_id = ?")
    .all(id) as { id: string }[];
  for (const { id: convId } of convIds) {
    deleteConversation(convId);
  }
  const result = database.prepare("DELETE FROM projects WHERE id = ?").run(id);
  return result.changes > 0;
}

export function listConversations(projectId?: string): Conversation[] {
  const database = getDb();
  if (projectId) {
    return database
      .prepare(
        "SELECT * FROM conversations WHERE project_id = ? ORDER BY updated_at DESC",
      )
      .all(projectId)
      .map((r) => rowToConversation(r as ConversationRow));
  }
  return database
    .prepare("SELECT * FROM conversations ORDER BY updated_at DESC")
    .all()
    .map((r) => rowToConversation(r as ConversationRow));
}

export function getConversationById(id: string): Conversation | undefined {
  const row = getDb()
    .prepare("SELECT * FROM conversations WHERE id = ?")
    .get(id) as ConversationRow | undefined;
  return row ? rowToConversation(row) : undefined;
}

export function insertConversation(conversation: Conversation): Conversation {
  getDb()
    .prepare(
      "INSERT INTO conversations (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(
      conversation.id,
      conversation.projectId,
      conversation.title,
      conversation.createdAt,
      conversation.updatedAt,
    );
  return conversation;
}

export function updateConversation(conversation: Conversation): Conversation {
  getDb()
    .prepare("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?")
    .run(conversation.title, conversation.updatedAt, conversation.id);
  return conversation;
}

export function touchConversation(id: string): void {
  const now = new Date().toISOString();
  getDb()
    .prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
    .run(now, id);
}

export function deleteConversation(id: string): boolean {
  const database = getDb();
  const goalIds = database
    .prepare("SELECT id FROM goals WHERE conversation_id = ?")
    .all(id) as { id: string }[];
  if (goalIds.length > 0) {
    deleteGoals(goalIds.map((g) => g.id));
  }
  database.prepare("DELETE FROM coach_messages WHERE conversation_id = ?").run(id);
  const result = database
    .prepare("DELETE FROM conversations WHERE id = ?")
    .run(id);
  return result.changes > 0;
}

export function getProjectForConversation(
  conversationId: string,
): Project | undefined {
  const conv = getConversationById(conversationId);
  if (!conv) return undefined;
  return getProjectById(conv.projectId);
}

export function getWorkspaceDirForConversation(
  conversationId: string,
): string | undefined {
  return getProjectForConversation(conversationId)?.workspaceDir;
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

export const REVIEW_ROUND_LOG_PREFIX = "【审查记录】";

export type ReviewVerifySnapshot = {
  command: string;
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  stdout?: string;
  stderr?: string;
};

export type ReviewRoundEntry = {
  round: number;
  roundLabel: string;
  verdict: "pass" | "fail";
  reason: string;
  reworkInstruction?: string;
  reworkTargets?: Array<{ childTitle: string; instruction: string }>;
  verifyResults?: ReviewVerifySnapshot[];
  timestamp: string;
};

export function listReviewRoundEntries(
  goalId: string,
  limit = 30,
): ReviewRoundEntry[] {
  const rows = listLogs(goalId, 400)
    .filter((l) => l.message.startsWith(REVIEW_ROUND_LOG_PREFIX))
    .map((l) => {
      try {
        const data = JSON.parse(
          l.message.slice(REVIEW_ROUND_LOG_PREFIX.length),
        ) as {
          round?: number;
          verdict?: "pass" | "fail";
          reason?: string;
          reworkInstruction?: string;
          reworkTargets?: Array<{ childTitle: string; instruction: string }>;
          verifyResults?: ReviewVerifySnapshot[];
        };
        const round = data.round ?? 0;
        const entry: ReviewRoundEntry = {
          round,
          roundLabel: `第 ${round + 1} 轮`,
          verdict: data.verdict ?? "fail",
          reason: data.reason ?? "",
          timestamp: l.timestamp,
        };
        if (data.reworkInstruction !== undefined) {
          entry.reworkInstruction = data.reworkInstruction;
        }
        if (data.reworkTargets !== undefined) {
          entry.reworkTargets = data.reworkTargets;
        }
        if (data.verifyResults !== undefined) {
          entry.verifyResults = data.verifyResults;
        }
        return entry;
      } catch {
        return null;
      }
    })
    .filter((e): e is ReviewRoundEntry => e !== null);
  return rows.slice(-limit);
}

export function listReviewRounds(goalId: string, limit = 10): string[] {
  return listReviewRoundEntries(goalId, limit).map((entry) => {
    const targets =
      entry.reworkTargets?.length
        ? `\n打回子任务：${entry.reworkTargets.map((t) => `「${t.childTitle}」→ ${t.instruction}`).join("；")}`
        : "";
    const rework = entry.reworkInstruction
      ? `\n修改清单：${entry.reworkInstruction}`
      : "";
    const tests =
      entry.verifyResults?.length
        ? `\n验证：${entry.verifyResults.map((v) => `${v.command} → ${v.ok ? "通过" : "失败"}`).join("；")}`
        : "";
    return `${entry.roundLabel} ${entry.verdict}：${entry.reason}${rework}${targets}${tests}`;
  });
}

export function buildGoalFeedback(goalId: string) {
  const goal = getGoalById(goalId);
  if (!goal) return undefined;
  const recentLogs = listLogs(goalId, 20).map((l) => ({
    level: l.level,
    message: l.message,
  }));
  const priorReviewRounds = listReviewRounds(goalId, 10);
  return {
    reworkReason: goal.reworkReason,
    resultSummary: goal.resultSummary,
    recentLogs,
    priorSummaries: listExecutionSummaries(goalId, 10),
    priorReviewRounds:
      priorReviewRounds.length > 0 ? priorReviewRounds : undefined,
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

const MAX_ISLAND_SEEN = 500;

function pruneIslandSeen(maxCount: number): void {
  getDb()
    .prepare(
      `DELETE FROM island_seen WHERE island_id NOT IN (
        SELECT island_id FROM island_seen ORDER BY seen_at DESC LIMIT ?
      )`,
    )
    .run(maxCount);
}

export function listIslandSeenIds(limit = MAX_ISLAND_SEEN): string[] {
  const capped = Math.max(1, Math.min(limit, MAX_ISLAND_SEEN));
  return getDb()
    .prepare(
      `SELECT island_id as islandId FROM island_seen ORDER BY seen_at DESC LIMIT ?`,
    )
    .all(capped)
    .map((row) => (row as { islandId: string }).islandId);
}

export function isIslandSeenInDb(islandId: string): boolean {
  const row = getDb()
    .prepare("SELECT 1 as ok FROM island_seen WHERE island_id = ?")
    .get(islandId) as { ok: number } | undefined;
  return row != null;
}

export function bulkMarkIslandSeen(ids: string[]): number {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return 0;

  const now = new Date().toISOString();
  const insert = getDb().prepare(
    "INSERT OR IGNORE INTO island_seen (island_id, seen_at) VALUES (?, ?)",
  );
  const mark = getDb().transaction((idList: string[]) => {
    let marked = 0;
    for (const id of idList) {
      const info = insert.run(id, now);
      if (info.changes > 0) marked += 1;
    }
    pruneIslandSeen(MAX_ISLAND_SEEN);
    return marked;
  });

  return mark(unique);
}

type CrewMessageRow = {
  id: number;
  goal_id: string;
  conversation_id: string;
  direction: string;
  summary: string;
  payload_json: string | null;
  created_at: string;
};

function rowToCrewExchange(row: CrewMessageRow): CrewExchangeRecord {
  let payload: unknown;
  if (row.payload_json?.trim()) {
    try {
      payload = JSON.parse(row.payload_json);
    } catch {
      payload = undefined;
    }
  }
  const direction = CrewExchangeDirectionSchema.parse(row.direction);
  return {
    id: row.id,
    goalId: row.goal_id,
    conversationId: row.conversation_id,
    direction,
    summary: row.summary,
    payload,
    createdAt: row.created_at,
  };
}

export function appendCrewExchange(input: {
  goalId: string;
  conversationId: string;
  direction: CrewExchangeDirection;
  summary: string;
  payload?: unknown;
}): CrewExchangeRecord {
  const createdAt = new Date().toISOString();
  const result = getDb()
    .prepare(
      `INSERT INTO crew_messages (goal_id, conversation_id, direction, summary, payload_json, created_at)
       VALUES (@goalId, @conversationId, @direction, @summary, @payloadJson, @createdAt)`,
    )
    .run({
      goalId: input.goalId,
      conversationId: input.conversationId,
      direction: input.direction,
      summary: input.summary,
      payloadJson: input.payload != null ? JSON.stringify(input.payload) : null,
      createdAt,
    });
  return rowToCrewExchange({
    id: Number(result.lastInsertRowid),
    goal_id: input.goalId,
    conversation_id: input.conversationId,
    direction: input.direction,
    summary: input.summary,
    payload_json: input.payload != null ? JSON.stringify(input.payload) : null,
    created_at: createdAt,
  });
}

export function listCrewExchanges(goalId: string, limit = 40): CrewExchangeRecord[] {
  return getDb()
    .prepare(
      `SELECT * FROM crew_messages WHERE goal_id = ? ORDER BY id DESC LIMIT ?`,
    )
    .all(goalId, limit)
    .map((row) => rowToCrewExchange(row as CrewMessageRow))
    .reverse();
}
