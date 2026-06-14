import type { DynamicIslandPayload, Goal } from "@openx/shared";
import { DEFAULT_MAX_ITERATIONS } from "@openx/shared";
import { broadcast } from "./sse.js";

export function pushIsland(payload: DynamicIslandPayload): void {
  broadcast({ type: "island.push", payload });
}

export function islandForReviewLimit(
  goal: Goal,
  reason: string,
  iteration: number,
): DynamicIslandPayload {
  const max = goal.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  return {
    id: `review-limit-${goal.id}-${Date.now()}`,
    kind: "goal.review_limit",
    severity: "warning",
    title: goal.title,
    message: `审查已进行 ${max} 轮仍未通过，需要你人工处理`,
    goalId: goal.id,
    expanded: true,
    autoDismissMs: 0,
    allowFeedback: true,
    feedbackPlaceholder: "指出问题或补充验收要求…",
    meta: {
      status: goal.status,
      iterationCount: iteration,
      maxIterations: max,
      reviewReason: reason,
      resultPreview: goal.resultSummary?.trim() || undefined,
    },
    actions: [
      {
        id: "approve",
        label: "确认完成",
        variant: "primary",
        action: { type: "approve", goalId: goal.id },
      },
      {
        id: "rework",
        label: "提交返工",
        variant: "danger",
        action: { type: "rework", goalId: goal.id },
      },
      {
        id: "review",
        label: "再跑审查",
        variant: "default",
        action: { type: "trigger_review", goalId: goal.id },
      },
    ],
  };
}

export function islandForReviewBlocked(
  goal: Goal,
  reason: string,
): DynamicIslandPayload {
  return {
    id: `review-blocked-${goal.id}-${Date.now()}`,
    kind: "goal.review_fail",
    severity: "warning",
    title: goal.title,
    message: `审查员判定验收标准当前不可达：${reason}`,
    goalId: goal.id,
    expanded: true,
    autoDismissMs: 0,
    allowFeedback: true,
    feedbackPlaceholder: "调整验收标准、拆分任务或补充说明…",
    meta: {
      status: goal.status,
      reviewReason: reason,
      resultPreview: goal.resultSummary?.trim() || undefined,
    },
    actions: [
      {
        id: "rework",
        label: "修改后返工",
        variant: "danger",
        action: { type: "rework", goalId: goal.id },
      },
      {
        id: "approve",
        label: "人工确认完成",
        variant: "primary",
        action: { type: "approve", goalId: goal.id },
      },
      {
        id: "navigate",
        label: "查看任务",
        variant: "default",
        action: { type: "navigate", goalId: goal.id },
      },
    ],
  };
}

export function islandForReviewUnavailable(
  goal: Goal,
  error?: string,
): DynamicIslandPayload {
  return {
    id: `review-unavail-${goal.id}-${Date.now()}`,
    kind: "goal.review_unavailable",
    severity: "error",
    title: goal.title,
    message: error ? `审查员不可用：${error}` : "审查员不可用，请人工验收",
    goalId: goal.id,
    expanded: true,
    autoDismissMs: 0,
    allowFeedback: true,
    feedbackPlaceholder: "补充反馈或指出问题…",
    meta: {
      status: goal.status,
      reviewReason: error,
      resultPreview: goal.resultSummary?.trim() || undefined,
    },
    actions: [
      {
        id: "approve",
        label: "确认完成",
        variant: "primary",
        action: { type: "approve", goalId: goal.id },
      },
      {
        id: "rework",
        label: "提交返工",
        variant: "danger",
        action: { type: "rework", goalId: goal.id },
      },
    ],
  };
}

export function islandForAwaitingReview(goal: Goal): DynamicIslandPayload {
  return {
    id: `await-review-${goal.id}-${Date.now()}`,
    kind: "goal.awaiting_review",
    severity: "info",
    title: goal.title,
    message: "任务已交差，待验收",
    goalId: goal.id,
    expanded: false,
    autoDismissMs: 0,
    allowFeedback: true,
    feedbackPlaceholder: "验收反馈、需修改处…",
    meta: {
      status: goal.status,
      iterationCount: goal.iterationCount,
      maxIterations: goal.maxIterations,
      resultPreview: goal.resultSummary?.trim() || undefined,
    },
    actions: [
      {
        id: "approve",
        label: "确认完成",
        variant: "primary",
        action: { type: "approve", goalId: goal.id },
      },
      {
        id: "rework",
        label: "还要修改",
        variant: "danger",
        action: { type: "rework", goalId: goal.id },
      },
      {
        id: "review",
        label: "触发审查",
        variant: "default",
        action: { type: "trigger_review", goalId: goal.id },
      },
    ],
  };
}
