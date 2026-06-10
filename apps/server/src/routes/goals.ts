import { Hono } from "hono";
import { nanoid } from "nanoid";
import { refineGoal } from "@openx/coach";
import {
  CreateGoalSchema,
  AddSubGoalsSchema,
  UpdateGoalSchema,
  ReworkSchema,
  BatchGoalsSchema,
  RecommendExecutorInputSchema,
  canTransition,
  type Goal,
} from "@openx/shared";
import {
  listGoals,
  getGoalById,
  insertGoal,
  updateGoal,
  appendLog,
  listLogs,
  buildGoalFeedback,
  listChildGoals,
  areDependenciesMet,
  deleteGoals,
} from "../db.js";
import { loadSettings } from "../settings-store.js";
import { broadcast } from "../sse.js";
import { buildRunStateFromDb } from "../run-service.js";
import { autoDraftNextSubGoals, createSubGoalsUnderParent } from "../sub-goals.js";
import {
  dispatchGoal,
  detectExecutors,
  cancelRunning,
  steerReworkGoal,
  tryDispatchDependents,
} from "../orchestrator.js";
import { narrateGoalChange } from "../narration.js";
import { recommendExecutorForGoal, resolveGoalExecutorId } from "../executor-recommend-service.js";
import { cancelGoalStatus } from "../goal-lifecycle.js";

export const goalsRoutes = new Hono();

goalsRoutes.post("/recommend-executor", async (c) => {
  const input = RecommendExecutorInputSchema.parse(await c.req.json());
  const executors = await detectExecutors();
  const recommendation = await recommendExecutorForGoal(input, executors);
  if (!recommendation) {
    return c.json({ recommendation: null });
  }
  return c.json({ recommendation });
});

goalsRoutes.get("/", (c) => {
  const status = c.req.query("status") as Goal["status"] | undefined;
  return c.json({ goals: listGoals(status) });
});

goalsRoutes.post("/", async (c) => {
  const input = CreateGoalSchema.parse(await c.req.json());
  const settings = loadSettings();
  const executors = await detectExecutors();
  const { refined, llmError } = await refineGoal(
    { userDraft: input.userDraft, constraints: input.constraints },
    settings,
    settings.defaultConstraints,
  );
  if (llmError) {
    console.warn("[coach] createGoal refine fallback:", llmError);
  }

  const title = input.title ?? refined.title;
  const acceptance = input.acceptance ?? refined.acceptance;
  const executionPrompt = input.executionPrompt ?? refined.executionPrompt;

  const mainExec = await resolveGoalExecutorId(
    {
      executorId: input.executorId,
      title,
      acceptance,
      executionPrompt,
      userDraft: input.userDraft,
    },
    settings,
    executors,
  );

  const now = new Date().toISOString();
  const goal: Goal = {
    id: nanoid(),
    title,
    acceptance,
    userDraft: input.userDraft,
    executionPrompt,
    constraints: input.constraints ?? refined.constraints,
    executorId: mainExec.executorId,
    parentGoalId: input.parentGoalId,
    dependsOn: input.dependsOn ?? [],
    priority: input.priority ?? "medium",
    status: "draft",
    progress: 0,
    createdAt: now,
    updatedAt: now,
  };
  insertGoal(goal);
  broadcast({ type: "goal.updated", goal });
  if (mainExec.recommendReason) {
    appendLog(goal.id, "info", `推荐执行器：${goal.executorId}（${mainExec.recommendReason}）`);
  }

  const children: Goal[] = [];
  let chainPrevId = goal.id;
  for (const sub of input.subGoals ?? []) {
    const { refined: subRefined } = await refineGoal(
      { userDraft: sub.userDraft, constraints: sub.constraints },
      settings,
      settings.defaultConstraints,
    );
    const subTitle = sub.title ?? subRefined.title;
    const subAcceptance = sub.acceptance ?? subRefined.acceptance;
    const subPrompt = sub.executionPrompt ?? subRefined.executionPrompt;
    const subExec = await resolveGoalExecutorId(
      {
        executorId: sub.executorId,
        title: subTitle,
        acceptance: subAcceptance,
        executionPrompt: subPrompt,
        userDraft: sub.userDraft,
      },
      settings,
      executors,
    );
    const childNow = new Date().toISOString();
    const child: Goal = {
      id: nanoid(),
      title: subTitle,
      acceptance: subAcceptance,
      userDraft: sub.userDraft,
      executionPrompt: subPrompt,
      constraints: sub.constraints ?? subRefined.constraints,
      executorId: subExec.executorId,
      parentGoalId: goal.id,
      dependsOn: sub.dependsOn ?? [chainPrevId],
      priority: sub.priority ?? "medium",
      status: "draft",
      progress: 0,
      createdAt: childNow,
      updatedAt: childNow,
    };
    insertGoal(child);
    broadcast({ type: "goal.updated", goal: child });
    if (subExec.recommendReason) {
      appendLog(child.id, "info", `推荐执行器：${child.executorId}（${subExec.recommendReason}）`);
    }
    children.push(child);
    chainPrevId = child.id;
  }

  const shouldStart = input.autoStart ?? settings.autoExecute;
  if (shouldStart && canTransition(goal.status, "running") && areDependenciesMet(goal)) {
    goal.status = "running";
    goal.progress = 0;
    goal.updatedAt = new Date().toISOString();
    updateGoal(goal);
    broadcast({ type: "goal.updated", goal });
    narrateGoalChange(goal, "start");
    appendLog(goal.id, "info", `任务启动，执行器：${goal.executorId}`);
    void dispatchGoal(goal.id);
  }

  return c.json({ goal, children }, 201);
});

goalsRoutes.get("/:id/children", (c) => {
  const goal = getGoalById(c.req.param("id"));
  if (!goal) return c.json({ error: "Not found" }, 404);
  return c.json({ children: listChildGoals(goal.id) });
});

goalsRoutes.post("/:id/sub-goals", async (c) => {
  const parent = getGoalById(c.req.param("id"));
  if (!parent) return c.json({ error: "Not found" }, 404);
  const body = AddSubGoalsSchema.parse(await c.req.json());
  const children = await createSubGoalsUnderParent(
    parent.id,
    body.subGoals,
    body.autoStart,
  );
  return c.json({ children }, 201);
});

goalsRoutes.get("/:id", (c) => {
  const goal = getGoalById(c.req.param("id"));
  if (!goal) return c.json({ error: "Not found" }, 404);
  const logs = listLogs(goal.id);
  const run = buildRunStateFromDb(goal.id);
  return c.json({ goal, logs, run });
});

goalsRoutes.get("/:id/run", (c) => {
  const goal = getGoalById(c.req.param("id"));
  if (!goal) return c.json({ error: "Not found" }, 404);
  return c.json({ run: buildRunStateFromDb(goal.id) });
});

goalsRoutes.patch("/:id", async (c) => {
  const goal = getGoalById(c.req.param("id"));
  if (!goal) return c.json({ error: "Not found" }, 404);
  const patch = UpdateGoalSchema.parse(await c.req.json());
  if (
    (goal.status === "running" || goal.status === "awaiting_review") &&
    (patch.executorId !== undefined || patch.dependsOn !== undefined)
  ) {
    return c.json(
      { error: "进行中的目标不可修改执行器或依赖关系" },
      409,
    );
  }
  Object.assign(goal, patch, { updatedAt: new Date().toISOString() });
  updateGoal(goal);
  broadcast({ type: "goal.updated", goal });
  return c.json({ goal });
});

goalsRoutes.post("/:id/refine", async (c) => {
  const goal = getGoalById(c.req.param("id"));
  if (!goal) return c.json({ error: "Not found" }, 404);
  const settings = loadSettings();
  const draft = goal.userDraft ?? goal.title;
  const { refined, llmError, quotaExceeded } = await refineGoal(
    {
      userDraft: draft,
      constraints: goal.constraints,
      feedback: buildGoalFeedback(goal.id),
    },
    settings,
    settings.defaultConstraints,
  );
  goal.title = refined.title;
  goal.acceptance = refined.acceptance;
  goal.executionPrompt = refined.executionPrompt;
  goal.constraints = refined.constraints;
  goal.updatedAt = new Date().toISOString();
  updateGoal(goal);
  broadcast({ type: "goal.updated", goal });
  return c.json({ goal, refined, meta: { llmError, quotaExceeded } });
});

goalsRoutes.post("/:id/start", async (c) => {
  const goal = getGoalById(c.req.param("id"));
  if (!goal) return c.json({ error: "Not found" }, 404);
  if (goal.status === "running") {
    return c.json({ goal });
  }
  if (!canTransition(goal.status, "running")) {
    return c.json({ error: `Cannot start from ${goal.status}` }, 400);
  }
  if (!areDependenciesMet(goal)) {
    return c.json({ error: "Dependencies not completed", dependsOn: goal.dependsOn }, 409);
  }
  goal.status = "running";
  goal.progress = 0;
  goal.updatedAt = new Date().toISOString();
  updateGoal(goal);
  broadcast({ type: "goal.updated", goal });
  narrateGoalChange(goal, "start");
  appendLog(goal.id, "info", `任务启动，执行器：${goal.executorId}`);
  void dispatchGoal(goal.id);
  return c.json({ goal });
});

goalsRoutes.post("/:id/approve", (c) => {
  const goal = getGoalById(c.req.param("id"));
  if (!goal) return c.json({ error: "Not found" }, 404);
  if (!canTransition(goal.status, "done")) {
    return c.json({ error: "Not awaiting review" }, 400);
  }
  goal.status = "done";
  goal.effectStatus = "approved";
  goal.updatedAt = new Date().toISOString();
  updateGoal(goal);
  broadcast({ type: "goal.updated", goal });
  narrateGoalChange(goal, "done");
  tryDispatchDependents(goal.id);
  void autoDraftNextSubGoals(goal.id, "approve");
  return c.json({ goal });
});

goalsRoutes.post("/:id/rework", async (c) => {
  const goal = getGoalById(c.req.param("id"));
  if (!goal) return c.json({ error: "Not found" }, 404);
  if (goal.status !== "awaiting_review") {
    return c.json({ error: "Only awaiting_review goals can be reworked" }, 400);
  }
  const body = ReworkSchema.parse(await c.req.json().catch(() => ({})));
  goal.effectStatus = "rework";
  goal.reworkReason = body.reason;
  goal.updatedAt = new Date().toISOString();

  const settings = loadSettings();
  const feedback = buildGoalFeedback(goal.id);
  const { refined, llmError } = await refineGoal(
    {
      userDraft: goal.userDraft ?? `${goal.title}\n验收：${goal.acceptance}`,
      constraints: goal.constraints,
      feedback,
    },
    settings,
    settings.defaultConstraints,
  );
  goal.executionPrompt = refined.executionPrompt;
  appendLog(goal.id, "info", "Coach 已根据返工反馈优化执行提示词");
  if (llmError) {
    appendLog(goal.id, "warn", `Coach refine 降级：${llmError}`);
  }

  goal.status = "running";
  goal.progress = 0;
  updateGoal(goal);
  broadcast({ type: "goal.updated", goal });
  const reasonText = body.reason?.trim() || "（未填写原因）";
  appendLog(goal.id, "warn", `工头返工：${reasonText}`);
  narrateGoalChange(goal, "rework");

  const steered = await steerReworkGoal(goal.id);
  if (steered) {
    void autoDraftNextSubGoals(goal.id, "rework");
    return c.json({ goal, mode: "steer" as const });
  }

  cancelRunning(goal.id);
  void dispatchGoal(goal.id);
  void autoDraftNextSubGoals(goal.id, "rework");
  return c.json({ goal, mode: "restart" as const });
});

goalsRoutes.post("/:id/cancel", (c) => {
  const goal = getGoalById(c.req.param("id"));
  if (!goal) return c.json({ error: "Not found" }, 404);
  cancelRunning(goal.id);
  const result = cancelGoalStatus(goal.id);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json({ goal: result.goal });
});

goalsRoutes.delete("/:id", (c) => {
  const id = c.req.param("id");
  const goal = getGoalById(id);
  if (!goal) return c.json({ error: "Not found" }, 404);
  if (goal.status === "running") {
    cancelRunning(goal.id);
  }
  const result = deleteGoals([id]);
  if (result.deleted.length === 0) {
    return c.json({ error: result.failed[0]?.error ?? "Cannot delete" }, 409);
  }
  for (const deletedId of result.deleted) {
    broadcast({ type: "goal.deleted", goalId: deletedId });
  }
  return c.json({ deleted: result.deleted, failed: result.failed });
});

goalsRoutes.post("/batch", async (c) => {
  const { action, ids } = BatchGoalsSchema.parse(await c.req.json());
  const ok: string[] = [];
  const failed: { id: string; error: string }[] = [];

  if (action === "delete") {
    for (const id of ids) {
      const goal = getGoalById(id);
      if (goal?.status === "running") {
        cancelRunning(goal.id);
      }
    }
    const result = deleteGoals(ids);
    for (const deletedId of result.deleted) {
      broadcast({ type: "goal.deleted", goalId: deletedId });
    }
    return c.json({ ok: result.deleted, failed: result.failed });
  }

  for (const id of ids) {
    const goal = getGoalById(id);
    if (!goal) {
      failed.push({ id, error: "Not found" });
      continue;
    }
    try {
      if (action === "start") {
        if (goal.status === "running") {
          ok.push(id);
          continue;
        }
        if (!canTransition(goal.status, "running")) {
          failed.push({ id, error: `无法从 ${goal.status} 启动` });
          continue;
        }
        if (!areDependenciesMet(goal)) {
          failed.push({ id, error: "前置目标未完成" });
          continue;
        }
        goal.status = "running";
        goal.progress = 0;
        goal.updatedAt = new Date().toISOString();
        updateGoal(goal);
        broadcast({ type: "goal.updated", goal });
        narrateGoalChange(goal, "start");
        appendLog(goal.id, "info", `任务启动，执行器：${goal.executorId}`);
        void dispatchGoal(goal.id);
        ok.push(id);
      } else if (action === "cancel") {
        if (!canTransition(goal.status, "cancelled")) {
          failed.push({ id, error: `无法从 ${goal.status} 取消` });
          continue;
        }
        cancelRunning(goal.id);
        const cancelled = cancelGoalStatus(goal.id);
        if (!cancelled.ok) {
          failed.push({ id, error: cancelled.error });
          continue;
        }
        ok.push(id);
      } else if (action === "approve") {
        if (!canTransition(goal.status, "done")) {
          failed.push({ id, error: "非待确认状态" });
          continue;
        }
        goal.status = "done";
        goal.effectStatus = "approved";
        goal.updatedAt = new Date().toISOString();
        updateGoal(goal);
        broadcast({ type: "goal.updated", goal });
        narrateGoalChange(goal, "done");
        tryDispatchDependents(goal.id);
        void autoDraftNextSubGoals(goal.id, "approve");
        ok.push(id);
      }
    } catch (err) {
      failed.push({ id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return c.json({ ok, failed });
});
