import type { GoalDeliverable } from "./deliverable.js";

/**
 * 执行器向工头报告的结构化结果。
 * 成功/失败/阻塞不得从自然语言摘要推断，必须由执行器显式声明。
 */
export type ExecutionOutcome =
  | {
      status: "completed";
      summary: string;
      deliverables?: GoalDeliverable[];
    }
  | {
      status: "blocked";
      reason: string;
    }
  | {
      status: "failed";
      error: string;
    };

export type GoalCompletionRejectReason =
  | "empty_summary"
  | "incomplete_claim";

export type GoalCompletionValidation =
  | { ok: true }
  | { ok: false; reason: GoalCompletionRejectReason; message: string };

/** 明显自述未完成的交差摘要（防御性门禁；主路径应走 failed outcome） */
const INCOMPLETE_CLAIM_RE =
  /任务未完成|未完成[。．]?$|tool(?:s)?\s*budget|工具调用达到上限/i;

/**
 * 校验「交差」是否可推进到 awaiting_review。
 * - 空摘要且无交付物 → 拒绝
 * - 摘要自述未完成 → 拒绝（防止执行器误调 completed）
 */
export function validateGoalCompletion(
  summary: string,
  deliverables?: GoalDeliverable[],
): GoalCompletionValidation {
  const trimmed = summary.trim();
  const hasDeliverables = Boolean(deliverables && deliverables.length > 0);

  if (!trimmed && !hasDeliverables) {
    return {
      ok: false,
      reason: "empty_summary",
      message: "执行结果摘要为空，不能标记为完成",
    };
  }

  if (trimmed && INCOMPLETE_CLAIM_RE.test(trimmed)) {
    return {
      ok: false,
      reason: "incomplete_claim",
      message: "执行结果自述任务未完成，不能标记为完成",
    };
  }

  return { ok: true };
}
