import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  CoachExecutionMeta,
  CoachExecutionMessage,
  CoachMessageRecord,
  CoachRefinedMessage,
  CoachTextMessage,
  CoachToolResultMessage,
  Conversation,
  Goal,
  GoalPriority,
  GoalStatus,
  LogLevel,
  Project,
  RunStreamEvent,
  SseEvent,
  WorkOrderToolResult,
} from "@openx/shared";
import {
  CoachExecutionMetaSchema,
  DispatchContextSchema,
  GoalDeliverableSchema,
  GOAL_PRIORITY_WEIGHT,
  RefinedGoalSchema,
  WorkOrderToolResultSchema,
  CONNECT_ANY_EXECUTOR_ID,
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
  ensureColumn(database, "coach_messages", "conversation_id", "TEXT");
  ensureColumn(database, "coach_messages", "kind", "TEXT NOT NULL DEFAULT 'text'");
  ensureColumn(database, "coach_messages", "meta_json", "TEXT");
  database.exec(
    "CREATE INDEX IF NOT EXISTS idx_goals_conversation ON goals(conversation_id)",
  );
  database.exec(
    "CREATE INDEX IF NOT EXISTS idx_coach_messages_conversation ON coach_messages(conversation_id)",
  );
}

type ProjectRow = {
  id: string;
  name: string;
  workspace_dir: string;
  created_at: string;
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
  created_at: string;
  updated_at: string;
};

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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type ListGoalsFilter = {
  status?: GoalStatus;
  conversationId?: string;
  projectId?: string;
};

export function listGoals(filter?: GoalStatus | ListGoalsFilter): Goal[] {
  const database = getDb();
  const f: ListGoalsFilter =
    typeof filter === "string" ? { status: filter } : (filter ?? {});
  const conditions: string[] = ["conversation_id IS NOT NULL"];
  const params: unknown[] = [];
  if (f.status) {
    conditions.push("status = ?");
    params.push(f.status);
  }
  if (f.conversationId) {
    conditions.push("conversation_id = ?");
    params.push(f.conversationId);
  }
  if (f.projectId) {
    conditions.push(
      `conversation_id IN (SELECT id FROM conversations WHERE project_id = ?)`,
    );
    params.push(f.projectId);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return database
    .prepare(`SELECT * FROM goals ${where} ORDER BY updated_at DESC`)
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
        id, conversation_id, title, acceptance, user_draft, execution_prompt, constraints_json,
        executor_id, status, progress, result_summary, deliverables_json, effect_status, rework_reason,
        parent_goal_id, depends_on_json, priority, auto_review, max_iterations,
        iteration_count, dispatch_context_json, created_at, updated_at
      ) VALUES (
        @id, @conversationId, @title, @acceptance, @userDraft, @executionPrompt, @constraintsJson,
        @executorId, @status, @progress, @resultSummary, @deliverablesJson, @effectStatus, @reworkReason,
        @parentGoalId, @dependsOnJson, @priority, @autoReview, @maxIterations,
        @iterationCount, @dispatchContextJson, @createdAt, @updatedAt
      )`,
    )
    .run({
      id: goal.id,
      conversationId: goal.conversationId,
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
        result_summary = @resultSummary, deliverables_json = @deliverablesJson,
        effect_status = @effectStatus,
        rework_reason = @reworkReason, parent_goal_id = @parentGoalId,
        depends_on_json = @dependsOnJson, priority = @priority,
        auto_review = @autoReview, max_iterations = @maxIterations,
        iteration_count = @iterationCount, dispatch_context_json = @dispatchContextJson,
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
    return {
      id: row.id,
      conversationId: row.conversationId,
      kind: "refined",
      timestamp: row.timestamp,
      refined,
      linkedGoalId: row.goal_id ?? undefined,
    };
  }
  if (row.kind === "tool_result" && row.meta_json) {
    const toolResult = WorkOrderToolResultSchema.parse(JSON.parse(row.meta_json));
    return {
      id: row.id,
      conversationId: row.conversationId,
      kind: "tool_result",
      timestamp: row.timestamp,
      toolResult,
    };
  }
  return {
    id: row.id,
    conversationId: row.conversationId,
    kind: "text",
    role: row.role as "user" | "coach",
    text: row.text,
    timestamp: row.timestamp,
  };
}

export function saveCoachMessage(
  conversationId: string,
  role: "user" | "coach",
  text: string,
): CoachTextMessage {
  const timestamp = new Date().toISOString();
  const result = getDb()
    .prepare(
      `INSERT INTO coach_messages (conversation_id, goal_id, role, text, kind, meta_json, created_at)
       VALUES (?, NULL, ?, ?, 'text', NULL, ?)`,
    )
    .run(conversationId, role, text, timestamp);
  touchConversation(conversationId);
  return {
    id: Number(result.lastInsertRowid),
    conversationId,
    kind: "text",
    role,
    text,
    timestamp,
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
         AND json_extract(meta_json, '$.refinedMessageId') = ?
       LIMIT 1`,
    )
    .get(conversationId, refinedMessageId) as { id: number } | undefined;
  return Boolean(row);
}

export function saveCoachToolResultMessage(
  conversationId: string,
  toolResult: WorkOrderToolResult,
): CoachToolResultMessage {
  const timestamp = new Date().toISOString();
  const metaJson = JSON.stringify({
    ...toolResult,
    dismissed: toolResult.outcome === "dismissed",
  });
  const result = getDb()
    .prepare(
      `INSERT INTO coach_messages (conversation_id, goal_id, role, text, kind, meta_json, created_at)
       VALUES (?, ?, 'coach', '', 'tool_result', ?, ?)`,
    )
    .run(
      conversationId,
      toolResult.goalId ?? null,
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

export function saveCoachRefinedMessage(
  conversationId: string,
  refined: CoachRefinedMessage["refined"],
): CoachRefinedMessage {
  const timestamp = new Date().toISOString();
  const metaJson = JSON.stringify(refined);
  const result = getDb()
    .prepare(
      `INSERT INTO coach_messages (conversation_id, goal_id, role, text, kind, meta_json, created_at)
       VALUES (?, NULL, 'coach', '', 'refined', ?, ?)`,
    )
    .run(conversationId, metaJson, timestamp);
  touchConversation(conversationId);
  return {
    id: Number(result.lastInsertRowid),
    conversationId,
    kind: "refined",
    timestamp,
    refined,
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

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    workspaceDir: row.workspace_dir,
    createdAt: row.created_at,
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
      "INSERT INTO projects (id, name, workspace_dir, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(project.id, project.name, project.workspaceDir, project.createdAt);
  return project;
}

export function updateProject(project: Project): Project {
  getDb()
    .prepare("UPDATE projects SET name = ?, workspace_dir = ? WHERE id = ?")
    .run(project.name, project.workspaceDir, project.id);
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
        return {
          round,
          roundLabel: `第 ${round + 1} 轮`,
          verdict: data.verdict ?? "fail",
          reason: data.reason ?? "",
          reworkInstruction: data.reworkInstruction,
          reworkTargets: data.reworkTargets,
          verifyResults: data.verifyResults,
          timestamp: l.timestamp,
        } satisfies ReviewRoundEntry;
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
