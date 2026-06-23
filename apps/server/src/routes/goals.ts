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
  canMutateGoal,
  DEFAULT_AUTO_REVIEW,
  goalMutationDeniedMessage,
  resolveSubGoalDependsOn,
  MAX_PARALLEL_SUB_GOAL_STARTS,
  mergeDispatchContext,
  normalizeDispatchContext,
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
  listGoalsPage,
  countGoalsByDisplay,
  buildGoalFeedback,
  listChildGoals,
  listReviewRoundEntries,
  listCrewExchanges,
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
  resumeCrewAfterUserDecision,
} from "../orchestrator.js";
import { narrateGoalChange } from "../narration.js";
import { recommendExecutorForGoal, resolveGoalExecutorId } from "../executor-recommend-service.js";
import { cancelGoalStatus, claimGoalForDispatch } from "../goal-lifecycle.js";
import { approveGoal, reworkGoal, waiveChildGoal } from "../goal-actions.js";
import { checkGoalApprovalGate } from "../goal-completion-gate.js";
import { buildGoalDispatchContext } from "../goal-dispatch.js";
import { goalMutationForbidden, parseGoalAccessActor } from "../goal-access-http.js";

export const goalsRoutes = new Hono();

function hasCompleteGoalDraft(input: {
  title?: string;
  acceptance?: string;
  executionPrompt?: string;
}): boolean {
  return Boolean(
    input.title?.trim() && input.acceptance?.trim() && input.executionPrompt?.trim(),
  );
}

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
  const displayFilter = c.req.query("displayFilter");
  const limitRaw = c.req.query("limit");
  const offsetRaw = c.req.query("offset");
  const filter: ListGoalsFilter = {};
  if (status) filter.status = status;
  if (conversationId) filter.conversationId = conversationId;
  if (projectId) filter.projectId = projectId;
  if (displayFilter) filter.displayFilter = displayFilter;
  if (limitRaw != null || offsetRaw != null) {
    const limit = Math.min(Math.max(Number(limitRaw ?? 80) || 80, 1), 500);
    const offset = Math.max(Number(offsetRaw ?? 0) || 0, 0);
    const page = listGoalsPage(filter, { limit, offset });
    return c.json(page);
  }
  const goals = Object.keys(filter).length > 0 ? listGoals(filter) : listGoals();
  return c.json({ goals });
});

goalsRoutes.get("/counts", (c) => {
  const conversationId = c.req.query("conversationId");
  const projectId = c.req.query("projectId");
  const filter: ListGoalsFilter = {};
  if (conversationId) filter.conversationId = conversationId;
  if (projectId) filter.projectId = projectId;
  return c.json({ counts: countGoalsByDisplay(filter) });
});

goalsRoutes.post("/", async (c) => {
  const rawBody = await c.req.json();
  const parsedInput = CreateGoalSchema.safeParse(rawBody);
  if (!parsedInput.success) {
    return c.json(
      {
        error: "Invalid goal payload",
        issues: parsedInput.error.issues.map((issue) => ({
          path: issue.path.join("."),
          code: issue.code,
          message: issue.message,
        })),
      },
      400,
    );
  }
  const input = parsedInput.data;
  if (!getConversationById(input.conversationId)) {
    return c.json({ error: "Conversation not found" }, 404);
  }
  const settings = loadSettings();
  const executors = await detectExecutors();
  const skipMainRefine =
    input.refinedMessageId != null || hasCompleteGoalDraft(input);
  let refined = {
    title: input.title ?? "",
    acceptance: input.acceptance ?? "",
    executionPrompt: input.executionPrompt ?? "",
    constraints: input.constraints ?? [],
  };
  let llmError: string | undefined;
  if (!skipMainRefine) {
    const result = await refineGoal(
      { userDraft: input.userDraft, constraints: input.constraints },
      settings,
      settings.defaultConstraints,
    );
    refined = result.refined;
    llmError = result.llmError;
    if (llmError) {
      console.warn("[coach] createGoal refine fallback:", llmError);
    }
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
    orderNo: 0,
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
    foremanThreadId: input.conversationId,
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
  const batchInputs = input.subGoals ?? [];
  for (let subIndex = 0; subIndex < batchInputs.length; subIndex += 1) {
    const sub = batchInputs[subIndex]!;
    let subRefined = {
      title: sub.title ?? "",
      acceptance: sub.acceptance ?? "",
      executionPrompt: sub.executionPrompt ?? "",
      constraints: sub.constraints ?? [],
    };
    if (!hasCompleteGoalDraft(sub)) {
      const result = await refineGoal(
        { userDraft: sub.userDraft, constraints: sub.constraints },
        settings,
        settings.defaultConstraints,
      );
      subRefined = result.refined;
    }
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
    const dependsOn = resolveSubGoalDependsOn(
      subIndex,
      batchInputs,
      children.map((c) => c.id),
      chainPrevId,
    );
    const child: Goal = {
      id: nanoid(),
      orderNo: 0,
      conversationId: input.conversationId,
      title: subTitle,
      acceptance: subAcceptance,
      userDraft: sub.userDraft,
      executionPrompt: subPrompt,
      constraints: sub.constraints ?? subRefined.constraints,
      executorId: subExec.executorId,
      parentGoalId: goal.id,
      dependsOn,
      priority: sub.priority ?? "medium",
      autoReview: goal.autoReview ?? false,
      maxIterations: goal.maxIterations,
      iterationCount: 0,
      dispatchContext: normalizeDispatchContext(
        mergeDispatchContext(
          goal.dispatchContext,
          sub.dispatchContext,
          {
            agentId: sub.agentId,
            mcpIds: sub.mcpIds,
            skillIds: sub.skillIds,
            permissionMode: sub.permissionMode,
          },
        ),
      ),
      foremanThreadId: input.conversationId,
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
    const runnableChildren = children.filter((child) => areDependenciesMet(child));
    for (const child of runnableChildren.slice(0, MAX_PARALLEL_SUB_GOAL_STARTS)) {
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

  const responseGoal = getGoalById(goal.id) ?? goal;
  return c.json({ goal: responseGoal, children }, 201);
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

goalsRoutes.get("/:id/crew-messages", (c) => {
  const goal = getGoalById(c.req.param("id"));
  if (!goal) return c.json({ error: "Not found" }, 404);
  return c.json({ messages: listCrewExchanges(goal.id) });
});

goalsRoutes.post("/:id/crew/resume", async (c) => {
  const goalId = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as { message?: string };
  const message = typeof body.message === "string" ? body.message : "";
  const result = await resumeCrewAfterUserDecision(goalId, message);
  if (!result.ok) {
    return c.json({ error: result.error ?? "续跑失败" }, 400);
  }
  const goal = getGoalById(goalId);
  return c.json({ ok: true, goal });
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
  const actor = parseGoalAccessActor(c);
  const denied = goalMutationForbidden(c, actor, goal);
  if (denied) return denied;
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
  const actor = parseGoalAccessActor(c);
  const denied = goalMutationForbidden(c, actor, goal);
  if (denied) return denied;
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
  const actor = parseGoalAccessActor(c);
  const denied = goalMutationForbidden(c, actor, goal);
  if (denied) return denied;
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
  const actor = parseGoalAccessActor(c);
  const denied = goalMutationForbidden(c, actor, goal);
  if (denied) return denied;
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
  const goal = getGoalById(c.req.param("id"));
  if (!goal) return c.json({ error: "Not found" }, 404);
  const actor = parseGoalAccessActor(c);
  const denied = goalMutationForbidden(c, actor, goal);
  if (denied) return denied;
  const result = approveGoal(c.req.param("id"), { source: "user" });
  if (!result.ok) {
    return c.json(
      { error: result.error, gateReasons: result.gateReasons },
      result.status,
    );
  }
  return c.json({ goal: result.goal });
});

goalsRoutes.get("/:id/approval-gate", (c) => {
  const gate = checkGoalApprovalGate(c.req.param("id"), { source: "user" });
  if (!gate.ok && gate.error === "Not found") {
    return c.json({ error: gate.error }, 404);
  }
  return c.json(gate.ok ? { ok: true } : { ok: false, reasons: gate.reasons });
});

goalsRoutes.post("/:id/waive", (c) => {
  const goal = getGoalById(c.req.param("id"));
  if (!goal) return c.json({ error: "Not found" }, 404);
  const actor = parseGoalAccessActor(c);
  const denied = goalMutationForbidden(c, actor, goal);
  if (denied) return denied;
  const result = waiveChildGoal(c.req.param("id"));
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json({ goal: result.goal });
});

goalsRoutes.post("/:id/rework", async (c) => {
  const goal = getGoalById(c.req.param("id"));
  if (!goal) return c.json({ error: "Not found" }, 404);
  const actor = parseGoalAccessActor(c);
  const denied = goalMutationForbidden(c, actor, goal);
  if (denied) return denied;
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
  const actor = parseGoalAccessActor(c);
  const denied = goalMutationForbidden(c, actor, goal);
  if (denied) return denied;
  cancelRunning(goal.id);
  const result = cancelGoalStatus(goal.id);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json({ goal: result.goal });
});

goalsRoutes.delete("/:id", (c) => {
  const id = c.req.param("id");
  const goal = getGoalById(id);
  if (!goal) return c.json({ error: "Not found" }, 404);
  const actor = parseGoalAccessActor(c);
  const denied = goalMutationForbidden(c, actor, goal);
  if (denied) return denied;
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
  const actor = parseGoalAccessActor(c);
  const ok: string[] = [];
  const failed: { id: string; error: string }[] = [];

  if (action === "delete") {
    for (const id of ids) {
      const goal = getGoalById(id);
      if (!goal) {
        failed.push({ id, error: "Not found" });
        continue;
      }
      const denied = goalMutationForbidden(c, actor, goal);
      if (denied) {
        failed.push({ id, error: goalMutationDeniedMessage() });
        continue;
      }
      if (goal.status === "running") {
        cancelRunning(goal.id);
      }
    }
    const allowedIds = ids.filter((id) => !failed.some((f) => f.id === id));
    const result = deleteGoals(allowedIds);
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
    if (!canMutateGoal(actor, goal)) {
      failed.push({ id, error: goalMutationDeniedMessage() });
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
