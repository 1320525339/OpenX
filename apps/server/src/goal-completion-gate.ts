/**
 * 目标完成门禁：批准前检查子任务、澄清与自动审查。
 */
import {
  evaluateGoalApprovalGate,
  evaluateGoalCompleteGate,
  formatGoalGateReasons,
  type GoalGateReason,
} from "@openx/shared";
import {
  getGoalById,
  hasLatestReviewPass,
  listChildGoals,
  listPendingClarifyIdsForConversation,
} from "./db.js";

export type GoalGateResult =
  | { ok: true }
  | { ok: false; reasons: GoalGateReason[]; error: string };

export type GoalApprovalGateOptions = {
  source?: "user" | "auto";
};

export function checkGoalApprovalGate(
  goalId: string,
  opts?: GoalApprovalGateOptions,
): GoalGateResult {
  const goal = getGoalById(goalId);
  if (!goal) {
    return { ok: false, reasons: [], error: "Not found" };
  }

  const result = evaluateGoalApprovalGate({
    goal,
    children: listChildGoals(goalId),
    pendingClarifyIds: listPendingClarifyIdsForConversation(goal.conversationId),
    hasReviewPass: hasLatestReviewPass(goalId),
    source: opts?.source ?? "user",
  });

  if (!result.ok) {
    return {
      ok: false,
      reasons: result.reasons,
      error: formatGoalGateReasons(result.reasons),
    };
  }
  return { ok: true };
}

export function checkGoalCompleteGate(goalId: string): GoalGateResult {
  const goal = getGoalById(goalId);
  if (!goal) {
    return { ok: false, reasons: [], error: "Not found" };
  }

  const children = listChildGoals(goalId);
  if (children.length === 0) return { ok: true };

  const result = evaluateGoalCompleteGate({ children });
  if (!result.ok) {
    return {
      ok: false,
      reasons: result.reasons,
      error: formatGoalGateReasons(result.reasons),
    };
  }
  return { ok: true };
}
