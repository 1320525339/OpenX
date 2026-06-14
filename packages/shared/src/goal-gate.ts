import type { Goal } from "./goal.js";

export type GoalGateReasonCode =
  | "child_not_complete"
  | "pending_clarify"
  | "auto_review_required";

export type GoalGateReason = {
  code: GoalGateReasonCode;
  message: string;
  childGoalIds?: string[];
  clarifyMessageIds?: number[];
};

export type GoalApprovalGateInput = {
  goal: Pick<Goal, "id" | "title" | "autoReview" | "conversationId">;
  children: Array<Pick<Goal, "id" | "title" | "status" | "waived">>;
  pendingClarifyIds: number[];
  hasReviewPass: boolean;
  source: "user" | "auto";
};

export type GoalCompleteGateInput = {
  children: Array<Pick<Goal, "id" | "title" | "status" | "waived">>;
};

/** 子目标是否视为已完成（含豁免） */
export function isChildGoalComplete(
  child: Pick<Goal, "status" | "waived">,
): boolean {
  return child.status === "done" || child.waived === true;
}

/** 依赖目标是否满足启动条件（done 或豁免） */
export function isDependencyGoalSatisfied(
  dep: Pick<Goal, "status" | "waived"> | undefined,
): boolean {
  if (!dep) return false;
  return isChildGoalComplete(dep);
}

export function evaluateGoalCompleteGate(
  input: GoalCompleteGateInput,
): { ok: true } | { ok: false; reasons: GoalGateReason[] } {
  const blocking = input.children.filter((c) => !isChildGoalComplete(c));
  if (blocking.length === 0) return { ok: true };
  return {
    ok: false,
    reasons: [
      {
        code: "child_not_complete",
        message: `仍有 ${blocking.length} 个子任务未完成：${blocking.map((c) => `「${c.title}」`).join("、")}`,
        childGoalIds: blocking.map((c) => c.id),
      },
    ],
  };
}

export function evaluateGoalApprovalGate(
  input: GoalApprovalGateInput,
): { ok: true } | { ok: false; reasons: GoalGateReason[] } {
  const reasons: GoalGateReason[] = [];

  const childGate = evaluateGoalCompleteGate({ children: input.children });
  if (!childGate.ok) reasons.push(...childGate.reasons);

  if (input.pendingClarifyIds.length > 0) {
    reasons.push({
      code: "pending_clarify",
      message: `对话中仍有 ${input.pendingClarifyIds.length} 条待回答澄清，请先处理后再确认完成`,
      clarifyMessageIds: input.pendingClarifyIds,
    });
  }

  if (
    input.goal.autoReview &&
    input.source === "user" &&
    !input.hasReviewPass
  ) {
    reasons.push({
      code: "auto_review_required",
      message: `目标「${input.goal.title}」已开启自动审查，需审查通过或先触发审查后再确认完成`,
    });
  }

  if (reasons.length > 0) return { ok: false, reasons };
  return { ok: true };
}

export function formatGoalGateReasons(reasons: GoalGateReason[]): string {
  return reasons.map((r) => r.message).join("；");
}
