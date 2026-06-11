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
  DEFAULT_AUTO_REVIEW,
  type Goal,
} from "@openx/shared";
import {
  listGoals,
  type ListGoalsFilter,
  getGoalById,
  getConversationById,
  insertGoal,
  linkCoachRefinedMessage,
  updateGoal,
  appendLog,
  listLogs,
  buildGoalFeedback,
  listChildGoals,
  listReviewRoundEntries,
  areDependenciesMet,
  deleteGoals,
} from "../db.js";
import { triggerGoalReview } from "../auto-review.js";
import { loadSettings } from "../settings-store.js";
import { broadcast } from "../sse.js";
import { buildRunStateFromDb } from "../run-service.js";
import { createSubGoalsUnderParent } from "../sub-goals.js";
import {
  dispatchGoal,
  detectExecutors,
  cancelRunning,
} from "../orchestrator.js";
import { narrateGoalChange } from "../narration.js";
import { recommendExecutorForGoal, resolveGoalExecutorId } from "../executor-recommend-service.js";
import { cancelGoalStatus, claimGoalForDispatch } from "../goal-lifecycle.js";
import { approveGoal, reworkGoal } from "../goal-actions.js";
import { buildGoalDispatchContext } from "../goal-dispatch.js";

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
  const conversationId = c.req.query("conversationId");
  const projectId = c.req.query("projectId");
  const filter: ListGoalsFilter = {};
  if (status) filter.status = status;
  if (conversationId) filter.conversationId = conversationId;
  if (projectId) filter.projectId = projectId;
  const goals = Object.keys(filter).length > 0 ? listGoals(filter) : listGoals();
  return c.json({ goals });
});

goalsRoutes.post("/", async (c) => {
  const input = CreateGoalSchema.parse(await c.req.json());
  if (!getConversationById(input.conversationId)) {
    return c.json({ error: "Conversation not found" }, 404);
  }
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

  const dispatchContext = buildGoalDispatchContext(input);

  const now = new Date().toISOString();
  const goal: Goal = {
    id: nanoid(),
    conversationId: input.conversationId,
    title,
    acceptance,
    userDraft: input.userDraft,
    executionPrompt,
    constraints: input.constraints ?? refined.constraints,
    executorId: mainExec.executorId,
    parentGoalId: input.parentGoalId,
    dependsOn: input.dependsOn ?? [],
    priority: input.priority ?? "medium",
    autoReview: input.autoReview ?? DEFAULT_AUTO_REVIEW,
    maxIterations: input.maxIterations,
    iterationCount: 0,
    dispatchContext,
    status: "draft",
    progress: 0,
    createdAt: now,
    updatedAt: now,
  };
  insertGoal(goal);
  if (input.refinedMessageId != null) {
    linkCoachRefinedMessage(input.refinedMessageId, goal.id);
  }
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
      conversationId: input.conversationId,
      title: subTitle,
      acceptance: subAcceptance,
      userDraft: sub.userDraft,
      executionPrompt: subPrompt,
      constraints: sub.constraints ?? subRefined.constraints,
      executorId: subExec.executorId,
      parentGoalId: goal.id,
      dependsOn: sub.dependsOn ?? (children.length === 0 ? [] : [chainPrevId]),
      priority: sub.priority ?? "medium",
      autoReview: goal.autoReview ?? false,
      maxIterations: goal.maxIterations,
      iterationCount: 0,
      dispatchContext: buildGoalDispatchContext(sub, undefined, goal),
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
  if (shouldStart && areDependenciesMet(goal)) {
    const claimed = claimGoalForDispatch(goal.id, ["draft"]);
    if (claimed) {
      claimed.progress = 0;
      claimed.updatedAt = new Date().toISOString();
      updateGoal(claimed);
      broadcast({ type: "goal.updated", goal: claimed });
      narrateGoalChange(claimed, "start");
      appendLog(claimed.id, "info", `任务启动，执行器：${claimed.executorId}`);
      void dispatchGoal(claimed.id);
    }
  }

  if (shouldStart) {
    for (const child of children) {
      if (!areDependenciesMet(child)) continue;
      const claimedChild = claimGoalForDispatch(child.id, ["draft"]);
      if (!claimedChild) continue;
      claimedChild.progress = 0;
      claimedChild.updatedAt = new Date().toISOString();
      updateGoal(claimedChild);
      broadcast({ type: "goal.updated", goal: claimedChild });
      narrateGoalChange(claimedChild, "start");
      appendLog(claimedChild.id, "info", `任务启动，执行器：${claimedChild.executorId}`);
      void dispatchGoal(claimedChild.id);
    }
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

goalsRoutes.get("/:id/review-rounds", (c) => {
  const goal = getGoalById(c.req.param("id"));
  if (!goal) return c.json({ error: "Not found" }, 404);
  return c.json({ rounds: listReviewRoundEntries(goal.id) });
});

goalsRoutes.post("/:id/trigger-review", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { force?: boolean };
  const goalId = c.req.param("id");
  const result = await triggerGoalReview(goalId, { force: body.force ?? true });
  if (!result.ok) {
    return c.json({ error: result.error ?? "审查失败" }, 400);
  }
  const goal = getGoalById(goalId);
  return c.json({
    ok: true,
    goal,
    rounds: goal ? listReviewRoundEntries(goal.id) : [],
  });
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
  if (!areDependenciesMet(goal)) {
    return c.json({ error: "Dependencies not completed", dependsOn: goal.dependsOn }, 409);
  }
  const claimed = claimGoalForDispatch(goal.id, ["draft", "failed"]);
  if (!claimed) {
    return c.json({ error: `Cannot start from ${goal.status}` }, 400);
  }
  claimed.progress = 0;
  claimed.updatedAt = new Date().toISOString();
  updateGoal(claimed);
  broadcast({ type: "goal.updated", goal: claimed });
  narrateGoalChange(claimed, "start");
  appendLog(claimed.id, "info", `任务启动，执行器：${claimed.executorId}`);
  void dispatchGoal(claimed.id);
  return c.json({ goal: claimed });
});

/** failed 任务重试（等价于 start，语义更明确） */
goalsRoutes.post("/:id/retry", async (c) => {
  const goal = getGoalById(c.req.param("id"));
  if (!goal) return c.json({ error: "Not found" }, 404);
  if (goal.status !== "failed") {
    return c.json({ error: "Only failed goals can be retried" }, 400);
  }
  if (!areDependenciesMet(goal)) {
    return c.json({ error: "Dependencies not completed", dependsOn: goal.dependsOn }, 409);
  }
  const claimed = claimGoalForDispatch(goal.id, ["failed"]);
  if (!claimed) {
    return c.json({ error: "Cannot retry goal" }, 400);
  }
  claimed.progress = 0;
  claimed.effectStatus = undefined;
  claimed.reworkReason = undefined;
  claimed.updatedAt = new Date().toISOString();
  updateGoal(claimed);
  broadcast({ type: "goal.updated", goal: claimed });
  narrateGoalChange(claimed, "start");
  appendLog(claimed.id, "info", `失败任务重试，执行器：${claimed.executorId}`);
  void dispatchGoal(claimed.id);
  return c.json({ goal: claimed });
});

goalsRoutes.post("/:id/approve", (c) => {
  const result = approveGoal(c.req.param("id"));
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json({ goal: result.goal });
});

goalsRoutes.post("/:id/rework", async (c) => {
  const body = ReworkSchema.parse(await c.req.json().catch(() => ({})));
  const result = await reworkGoal(c.req.param("id"), body.reason, {
    source: "user",
  });
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json({ goal: result.goal, mode: result.mode });
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
        if (!areDependenciesMet(goal)) {
          failed.push({ id, error: "前置目标未完成" });
          continue;
        }
        const claimed = claimGoalForDispatch(goal.id, ["draft", "failed"]);
        if (!claimed) {
          failed.push({ id, error: `无法从 ${goal.status} 启动` });
          continue;
        }
        claimed.progress = 0;
        claimed.updatedAt = new Date().toISOString();
        updateGoal(claimed);
        broadcast({ type: "goal.updated", goal: claimed });
        narrateGoalChange(claimed, "start");
        appendLog(claimed.id, "info", `任务启动，执行器：${claimed.executorId}`);
        void dispatchGoal(claimed.id);
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
        const approved = approveGoal(goal.id);
        if (!approved.ok) {
          failed.push({ id, error: approved.error });
          continue;
        }
        ok.push(id);
      }
    } catch (err) {
      failed.push({ id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return c.json({ ok, failed });
});
