/**
 * 目标审批/返工动作服务：供 HTTP 路由与 auto-review 自动验收循环共用。
 */
import { canTransition, type Goal } from "@openx/shared";
import { refineGoal } from "@openx/coach";
import {
  appendLog,
  buildGoalFeedback,
  getGoalById,
  listReviewRounds,
  updateGoal,
} from "./db.js";
import { loadSettings } from "./settings-store.js";
import { broadcast } from "./sse.js";
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
import { pushIsland } from "./island-push.js";

export type ActionResult =
  | { ok: true; goal: Goal; mode?: "steer" | "restart" }
  | { ok: false; status: 400 | 404; error: string; gateReasons?: import("@openx/shared").GoalGateReason[] };

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
  updateGoal(child);
  broadcast({ type: "goal.updated", goal: child });
  appendLog(childId, "warn", `父目标合成验收打回，重新打开执行`);
  narrateGoalChange(child, "rework");

  const steered = await steerReworkGoal(childId);
  if (steered) return true;

  if (child.executorId.startsWith("acp:")) {
    appendLog(
      childId,
      "info",
      "ACP steer 会话不可用，将 loadSession 续跑或重启（保留审查反馈）",
    );
  }
  cancelRunning(childId);
  void dispatchGoal(childId);
  return true;
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
      pushIsland({
        id: `gate-block-${goal.id}-${Date.now()}`,
        kind: "goal.gate_blocked",
        severity: "warning",
        title: goal.title,
        message: gate.error,
        goalId: goal.id,
        expanded: true,
        autoDismissMs: 0,
        meta: {
          status: goal.status,
          gateReasons: gate.reasons,
        },
        actions: [
          {
            id: "review",
            label: "触发审查",
            variant: "primary",
            action: { type: "trigger_review", goalId: goal.id },
          },
          {
            id: "dismiss",
            label: "知道了",
            variant: "ghost",
            action: { type: "dismiss" },
          },
        ],
      });
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
  updateGoal(goal);
  broadcast({ type: "goal.updated", goal });
  narrateGoalChange(goal, "done");
  tryDispatchDependents(goal.id);
  void autoDraftNextSubGoals(goal.id, "approve");
  void maybeRollUpParentGoal(goal.id);
  return { ok: true, goal };
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
  updateGoal(goal);
  broadcast({ type: "goal.updated", goal });
  appendLog(goal.id, "info", "子任务已豁免，父目标完成门禁将视同已完成");
  void maybeRollUpParentGoal(goal.id);
  return { ok: true, goal };
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
  goal.effectStatus = "rework";
  goal.reworkReason = reason;
  if (opts?.source === "auto") {
    goal.iterationCount = (goal.iterationCount ?? 0) + 1;
  }
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
  const reasonText = reason?.trim() || "（未填写原因）";
  const prefix = opts?.source === "auto" ? "自动验收未通过，返工" : "工头返工";
  appendLog(goal.id, "warn", `${prefix}：${reasonText}`);
  narrateGoalChange(goal, "rework");

  const steered = await steerReworkGoal(goal.id);
  if (steered) {
    if (opts?.source !== "auto") {
      void autoDraftNextSubGoals(goal.id, "rework");
    }
    return { ok: true, goal, mode: "steer" };
  }

  if (goal.executorId.startsWith("acp:")) {
    appendLog(
      goal.id,
      "info",
      "ACP steer 会话不可用，将 loadSession 续跑或重启执行（保留返工说明）",
    );
  }
  cancelRunning(goal.id);
  void dispatchGoal(goal.id);
  if (opts?.source !== "auto") {
    void autoDraftNextSubGoals(goal.id, "rework");
  }
  return { ok: true, goal, mode: "restart" };
}
