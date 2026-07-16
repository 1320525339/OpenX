/**
 * 目标审批/返工动作服务：供 HTTP 路由与 auto-review 自动验收循环共用。
 */
import { canTransition, type Goal } from "@openx/shared";
import { refineGoal } from "@openx/coach";
import {
  appendLog,
  buildGoalFeedback,
  casUpdateGoal,
  getGoalById,
  GoalRevisionConflictError,
  listReviewRounds,
  runGoalDbTransaction,
} from "./db.js";
import { loadSettings } from "./settings-store.js";
import { broadcast, fanoutSse, persistSseEvent } from "./sse.js";
import { narrateGoalChange } from "./narration.js";
import {
  cancelRunning,
  dispatchGoal,
  steerReworkGoal,
  tryDispatchDependents,
} from "./orchestrator.js";
import { autoDraftNextSubGoals } from "./sub-goals.js";
import { maybeRollUpParentGoal } from "./parent-goal-rollup.js";
import { checkGoalApprovalGate } from "./goal-completion-gate.js";
import { islandForGateBlocked, pushIsland } from "./island-push.js";
import { resolveAttentionsForGoal } from "./attention-store.js";

export type ActionResult =
  | { ok: true; goal: Goal; mode?: "steer" | "restart" }
  | {
      ok: false;
      status: 400 | 404 | 409;
      error: string;
      gateReasons?: import("@openx/shared").GoalGateReason[];
      currentRevision?: number;
    };

export type ApproveGoalOptions = {
  source?: "user" | "auto";
};

/** 父目标合成验收打回：将已 done 的子任务重新打开并 steer 返工 */
export async function reopenChildGoalForReview(
  childId: string,
  parent: Goal,
  instruction: string,
  parentReason: string,
): Promise<boolean> {
  const child = getGoalById(childId);
  if (!child || child.status !== "done") return false;

  const priorRounds = listReviewRounds(childId, 8);
  const reworkReason = [
    `【父目标合成验收打回】父目标「${parent.title}」`,
    `集成问题：${parentReason}`,
    `本子任务修改要求：${instruction}`,
    priorRounds.length > 0
      ? `【本任务历史审查】\n${priorRounds.join("\n\n")}`
      : "",
    child.resultSummary?.trim()
      ? `【你上次交付摘要】\n${child.resultSummary.trim()}`
      : "",
    "请逐条落实修改要求，并在结果摘要中给出可验证证据。",
  ]
    .filter(Boolean)
    .join("\n\n");

  child.status = "running";
  child.effectStatus = "rework";
  child.progress = 0;
  child.iterationCount = (child.iterationCount ?? 0) + 1;
  child.reworkReason = reworkReason;
  child.updatedAt = new Date().toISOString();
  try {
    const saved = casUpdateGoal(child, { expectedStatuses: ["done"] });
    broadcast({ type: "goal.updated", goal: saved });
    appendLog(childId, "warn", `父目标合成验收打回，重新打开执行`);
    narrateGoalChange(saved, "rework");

    const steered = await steerReworkGoal(childId);
    if (steered) return true;

    if (saved.executorId.startsWith("acp:")) {
      appendLog(
        childId,
        "info",
        "ACP steer 会话不可用，将 loadSession 续跑或重启（保留审查反馈）",
      );
    }
    cancelRunning(childId);
    void dispatchGoal(childId);
    return true;
  } catch (err) {
    if (err instanceof GoalRevisionConflictError) return false;
    throw err;
  }
}

export function approveGoal(
  goalId: string,
  opts?: ApproveGoalOptions,
): ActionResult {
  const goal = getGoalById(goalId);
  if (!goal) return { ok: false, status: 404, error: "Not found" };
  if (!canTransition(goal.status, "done")) {
    return { ok: false, status: 400, error: "Not awaiting review" };
  }

  const gate = checkGoalApprovalGate(goalId, { source: opts?.source ?? "user" });
  if (!gate.ok) {
    if (opts?.source !== "auto") {
      pushIsland(islandForGateBlocked(goal, gate.error, gate.reasons));
    }
    return {
      ok: false,
      status: 400,
      error: gate.error,
      gateReasons: gate.reasons,
    };
  }

  goal.status = "done";
  goal.effectStatus = "approved";
  goal.updatedAt = new Date().toISOString();
  try {
    const pending: ReturnType<typeof persistSseEvent>[] = [];
    const saved = runGoalDbTransaction(() => {
      const next = casUpdateGoal(goal, { expectedStatuses: ["awaiting_review"] });
      pending.push(persistSseEvent({ type: "goal.updated", goal: next }));
      return next;
    });
    for (const stored of pending) fanoutSse(stored);
    resolveAttentionsForGoal(saved.id);
    narrateGoalChange(saved, "done");
    tryDispatchDependents(saved.id);
    void autoDraftNextSubGoals(saved.id, "approve");
    void maybeRollUpParentGoal(saved.id);
    return { ok: true, goal: saved };
  } catch (err) {
    if (err instanceof GoalRevisionConflictError) {
      return {
        ok: false,
        status: 409,
        error: "Goal revision conflict",
        currentRevision: err.currentRevision,
      };
    }
    throw err;
  }
}

/** 豁免子任务：父目标完成门禁视同已完成 */
export function waiveChildGoal(goalId: string): ActionResult {
  const goal = getGoalById(goalId);
  if (!goal) return { ok: false, status: 404, error: "Not found" };
  if (!goal.parentGoalId) {
    return { ok: false, status: 400, error: "Only child goals can be waived" };
  }
  if (goal.status === "running") {
    cancelRunning(goal.id);
  }
  goal.waived = true;
  goal.status = "cancelled";
  goal.updatedAt = new Date().toISOString();
  try {
    const saved = casUpdateGoal(goal);
    broadcast({ type: "goal.updated", goal: saved });
    appendLog(saved.id, "info", "子任务已豁免，父目标完成门禁将视同已完成");
    void maybeRollUpParentGoal(saved.id);
    return { ok: true, goal: saved };
  } catch (err) {
    if (err instanceof GoalRevisionConflictError) {
      return {
        ok: false,
        status: 409,
        error: "Goal revision conflict",
        currentRevision: err.currentRevision,
      };
    }
    throw err;
  }
}

export async function reworkGoal(
  goalId: string,
  reason?: string,
  opts?: { source?: "user" | "auto" },
): Promise<ActionResult> {
  const goal = getGoalById(goalId);
  if (!goal) return { ok: false, status: 404, error: "Not found" };
  if (goal.status !== "awaiting_review") {
    return {
      ok: false,
      status: 400,
      error: "Only awaiting_review goals can be reworked",
    };
  }
  if (!canTransition(goal.status, "running")) {
    return { ok: false, status: 400, error: "Cannot rework from current status" };
  }
  // 保存必要字段用于 refineGoal（此时 goal 仍为最新）
  const userDraft = goal.userDraft ?? `${goal.title}\n验收：${goal.acceptance}`;
  const constraints = goal.constraints;

  const settings = loadSettings();
  const feedback = buildGoalFeedback(goalId);
  const { refined, llmError } = await refineGoal(
    {
      userDraft,
      constraints,
      feedback,
    },
    settings,
    settings.defaultConstraints,
  );

  // TOCTOU 防护：refineGoal 耗时（LLM 调用），期间目标状态可能被并发请求修改
  // 必须重新从 DB 读取，确保不覆盖并发 approve/cancel 的结果
  const fresh = getGoalById(goalId);
  if (!fresh) return { ok: false, status: 404, error: "Not found" };
  if (fresh.status !== "awaiting_review") {
    return {
      ok: false,
      status: 400,
      error: `目标状态已在返工期间变更为 ${fresh.status}，放弃返工`,
    };
  }

  fresh.executionPrompt = refined.executionPrompt;
  fresh.effectStatus = "rework";
  fresh.reworkReason = reason;
  if (opts?.source === "auto") {
    fresh.iterationCount = (fresh.iterationCount ?? 0) + 1;
  }
  appendLog(fresh.id, "info", "Coach 已根据返工反馈优化执行提示词");
  if (llmError) {
    appendLog(fresh.id, "warn", `Coach refine 降级：${llmError}`);
  }

  fresh.status = "running";
  fresh.progress = 0;
  fresh.updatedAt = new Date().toISOString();
  let saved: Goal;
  try {
    saved = casUpdateGoal(fresh, { expectedStatuses: ["awaiting_review"] });
  } catch (err) {
    if (err instanceof GoalRevisionConflictError) {
      return {
        ok: false,
        status: 409,
        error: "Goal revision conflict",
        currentRevision: err.currentRevision,
      };
    }
    throw err;
  }
  broadcast({ type: "goal.updated", goal: saved });
  resolveAttentionsForGoal(saved.id, [
    "goal.awaiting_review",
    "goal.review_limit",
    "goal.review_unavailable",
    "goal.review_fail",
    "goal.gate_blocked",
  ]);
  const reasonText = reason?.trim() || "（未填写原因）";
  const prefix = opts?.source === "auto" ? "自动验收未通过，返工" : "工头返工";
  appendLog(saved.id, "warn", `${prefix}：${reasonText}`);
  narrateGoalChange(saved, "rework");

  const steered = await steerReworkGoal(saved.id);
  if (steered) {
    if (opts?.source !== "auto") {
      void autoDraftNextSubGoals(saved.id, "rework");
    }
    return { ok: true, goal: saved, mode: "steer" };
  }

  if (saved.executorId.startsWith("acp:")) {
    appendLog(
      saved.id,
      "info",
      "ACP steer 会话不可用，将 loadSession 续跑或重启执行（保留返工说明）",
    );
  }
  cancelRunning(saved.id);
  void dispatchGoal(saved.id);
  if (opts?.source !== "auto") {
    void autoDraftNextSubGoals(saved.id, "rework");
  }
  return { ok: true, goal: saved, mode: "restart" };
}
