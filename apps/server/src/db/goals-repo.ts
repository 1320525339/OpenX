import { clearGoalCancelledForConnect } from "../connect-store.js";
import type { Goal, GoalPriority, GoalStatus, LogLevel } from "@openx/shared";
import {
  CONNECT_ANY_EXECUTOR_ID,
  DispatchContextSchema,
  GoalDeliverableSchema,
  GOAL_PRIORITY_WEIGHT,
} from "@openx/shared";
import { getDb } from "./connection.js";
import { maybePruneRetention } from "./retention.js";

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
  revision: number | null;
  created_at: string;
  updated_at: string;
};


export function allocateWorkOrderNo(): number {
  const row = getDb()
    .prepare("SELECT COALESCE(MAX(order_no), 0) AS maxNo FROM goals")
    .get() as { maxNo: number };
  return row.maxNo + 1;
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
    revision: row.revision ?? 0,
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
  const record: Goal = {
    ...goal,
    orderNo,
    revision: goal.revision ?? 0,
  };
  getDb()
    .prepare(
      `INSERT INTO goals (
        id, order_no, conversation_id, title, acceptance, user_draft, execution_prompt, constraints_json,
        executor_id, status, progress, result_summary, deliverables_json, effect_status, rework_reason,
        parent_goal_id, depends_on_json, priority, auto_review, max_iterations,
        iteration_count, dispatch_context_json, waived,
        foreman_thread_id, crew_session_id, crew_status, revision,
        created_at, updated_at
      ) VALUES (
        @id, @orderNo, @conversationId, @title, @acceptance, @userDraft, @executionPrompt, @constraintsJson,
        @executorId, @status, @progress, @resultSummary, @deliverablesJson, @effectStatus, @reworkReason,
        @parentGoalId, @dependsOnJson, @priority, @autoReview, @maxIterations,
        @iterationCount, @dispatchContextJson, @waived,
        @foremanThreadId, @crewSessionId, @crewStatus, @revision,
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
      revision: record.revision ?? 0,
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

export class GoalRevisionConflictError extends Error {
  readonly currentRevision: number;
  readonly goalId: string;
  constructor(goalId: string, currentRevision: number) {
    super(`Goal revision conflict: ${goalId} (current=${currentRevision})`);
    this.name = "GoalRevisionConflictError";
    this.goalId = goalId;
    this.currentRevision = currentRevision;
  }
}

/** 在同一 SQLite 连接上执行事务 */
export function runGoalDbTransaction<T>(fn: () => T): T {
  return getDb().transaction(fn)();
}

/**
 * CAS 全字段更新：WHERE id + revision 匹配才写入，成功后 revision+1。
 * expectedStatuses 可选，用于状态机门禁与 revision 同条原子。
 */
export function casUpdateGoal(
  goal: Goal,
  opts?: { expectedStatuses?: GoalStatus[]; baseRevision?: number },
): Goal {
  const baseRevision = opts?.baseRevision ?? goal.revision ?? 0;
  const updatedAt = goal.updatedAt || new Date().toISOString();
  const expected = opts?.expectedStatuses;
  const params: Record<string, unknown> = {
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
    updatedAt,
    baseRevision,
  };

  let sql = `UPDATE goals SET
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
        revision = revision + 1,
        updated_at = @updatedAt
      WHERE id = @id AND revision = @baseRevision`;

  if (expected && expected.length > 0) {
    const placeholders = expected.map((_, i) => `@es${i}`).join(", ");
    sql += ` AND status IN (${placeholders})`;
    expected.forEach((s, i) => {
      params[`es${i}`] = s;
    });
  }

  const info = getDb().prepare(sql).run(params);
  if (info.changes === 0) {
    const current = getGoalById(goal.id);
    throw new GoalRevisionConflictError(goal.id, current?.revision ?? baseRevision);
  }
  const next = getGoalById(goal.id);
  if (!next) throw new Error(`Goal missing after CAS update: ${goal.id}`);
  return next;
}

export function updateGoal(goal: Goal): Goal {
  return casUpdateGoal(goal);
}

/** CAS：将 connect:any 任务认领给指定 executor（单条，revision+1） */
export function claimConnectPoolGoal(goalId: string, executorId: string): Goal | null {
  const now = new Date().toISOString();
  const info = getDb()
    .prepare(
      `UPDATE goals SET executor_id = @executorId, updated_at = @updatedAt,
         revision = revision + 1
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

/**
 * CAS 式状态迁移：仅当当前状态在 fromStatuses 中时才更新；revision+1。
 * extras 可把 progress 等并入同条 UPDATE，避免二次盲写。
 */
export function transitionGoalStatus(
  goalId: string,
  fromStatuses: GoalStatus[],
  to: GoalStatus,
  extras?: { progress?: number; effectStatus?: Goal["effectStatus"] | null; reworkReason?: string | null },
): Goal | null {
  if (fromStatuses.length === 0) return null;
  const placeholders = fromStatuses.map(() => "?").join(", ");
  const now = new Date().toISOString();
  const sets = ["status = ?", "updated_at = ?", "revision = revision + 1"];
  const params: unknown[] = [to, now];
  if (extras?.progress !== undefined) {
    sets.push("progress = ?");
    params.push(extras.progress);
  }
  if (extras && "effectStatus" in extras) {
    sets.push("effect_status = ?");
    params.push(extras.effectStatus ?? null);
  }
  if (extras && "reworkReason" in extras) {
    sets.push("rework_reason = ?");
    params.push(extras.reworkReason ?? null);
  }
  params.push(goalId, ...fromStatuses);
  const result = getDb()
    .prepare(
      `UPDATE goals SET ${sets.join(", ")} WHERE id = ? AND status IN (${placeholders})`,
    )
    .run(...params);
  if (result.changes === 0) return null;
  return getGoalById(goalId) ?? null;
}

function purgeGoalRecords(id: string): void {
  const database = getDb();
  database.prepare("DELETE FROM goal_logs WHERE goal_id = ?").run(id);
  database.prepare("DELETE FROM coach_messages WHERE goal_id = ?").run(id);
  database.prepare("DELETE FROM execution_summaries WHERE goal_id = ?").run(id);
  database.prepare("DELETE FROM run_events WHERE goal_id = ?").run(id);
  database.prepare("DELETE FROM crew_messages WHERE goal_id = ?").run(id);
  database.prepare("DELETE FROM dispatch_receipts WHERE goal_id = ?").run(id);
  database.prepare("DELETE FROM token_usage_events WHERE goal_id = ?").run(id);
  database.prepare("DELETE FROM attention_records WHERE goal_id = ?").run(id);
  database
    .prepare("UPDATE integration_runs SET goal_id = NULL WHERE goal_id = ?")
    .run(id);
  database.prepare("DELETE FROM goals WHERE id = ?").run(id);
  // 清理 Connect 取消标记，避免 cancelledGoalIds Set 无限增长
  clearGoalCancelledForConnect(id);
}

function goalDepthInSet(id: string, idSet: Set<string>): number {
  const goal = getGoalById(id);
  if (!goal?.parentGoalId || !idSet.has(goal.parentGoalId)) return 0;
  return 1 + goalDepthInSet(goal.parentGoalId, idSet);
}

/** 硬删除目标（含子目标级联）；返回 deleted / failed。force 时忽略外部依赖阻挡（项目级联删除用）。 */
export function deleteGoals(
  ids: string[],
  opts?: { force?: boolean },
): {
  deleted: string[];
  failed: { id: string; error: string }[];
} {
  const deleted: string[] = [];
  const failed: { id: string; error: string }[] = [];
  const toDelete = new Set<string>();
  const force = opts?.force === true;

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
  if (!force) {
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
  }

  const sorted = [...toDelete].sort(
    (a, b) => goalDepthInSet(b, toDelete) - goalDepthInSet(a, toDelete),
  );

  const runPurge = getDb().transaction(() => {
    for (const id of sorted) {
      if (blocked.has(id)) {
        failed.push({ id, error: blocked.get(id)! });
        continue;
      }
      if (!getGoalById(id)) continue;
      purgeGoalRecords(id);
      deleted.push(id);
    }
  });
  runPurge();

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
  maybePruneRetention();
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
