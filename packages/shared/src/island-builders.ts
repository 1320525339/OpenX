import {
  DEFAULT_MAX_ITERATIONS,
  type Goal,
  type GoalStatus,
} from "./goal.js";
import type { DynamicIslandPayload, IslandSeverity } from "./island.js";

/** 稳定 id：待验收用 iteration，其它 durable 用 goalId+kind */
export function islandForAwaitingReview(goal: Goal): DynamicIslandPayload {
  return {
    id: `await-review-${goal.id}-${goal.iterationCount ?? 0}`,
    kind: "goal.awaiting_review",
    severity: "info",
    title: goal.title.slice(0, 120),
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
      resultPreview: goal.resultSummary?.trim()?.slice(0, 2000) || undefined,
      deliverables: goal.deliverables,
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

export function islandForReviewLimit(
  goal: Goal,
  reason: string,
  iteration: number,
): DynamicIslandPayload {
  const max = goal.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  return {
    id: `review-limit-${goal.id}-${iteration}`,
    kind: "goal.review_limit",
    severity: "warning",
    title: goal.title.slice(0, 120),
    message: `审查已进行 ${max} 轮仍未通过，需要你人工处理`.slice(0, 2000),
    goalId: goal.id,
    expanded: true,
    autoDismissMs: 0,
    allowFeedback: true,
    feedbackPlaceholder: "指出问题或补充验收要求…",
    meta: {
      status: goal.status,
      iterationCount: iteration,
      maxIterations: max,
      reviewReason: reason.slice(0, 2000),
      resultPreview: goal.resultSummary?.trim()?.slice(0, 2000) || undefined,
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
    id: `review-blocked-${goal.id}`,
    kind: "goal.review_fail",
    severity: "warning",
    title: goal.title.slice(0, 120),
    message: `审查员判定验收标准当前不可达：${reason}`.slice(0, 2000),
    goalId: goal.id,
    expanded: true,
    autoDismissMs: 0,
    allowFeedback: true,
    feedbackPlaceholder: "调整验收标准、拆分任务或补充说明…",
    meta: {
      status: goal.status,
      reviewReason: reason.slice(0, 2000),
      resultPreview: goal.resultSummary?.trim()?.slice(0, 2000) || undefined,
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
    id: `review-unavail-${goal.id}`,
    kind: "goal.review_unavailable",
    severity: "error",
    title: goal.title.slice(0, 120),
    message: (error ? `审查员不可用：${error}` : "审查员不可用，请人工验收").slice(0, 2000),
    goalId: goal.id,
    expanded: true,
    autoDismissMs: 0,
    allowFeedback: true,
    feedbackPlaceholder: "补充反馈或指出问题…",
    meta: {
      status: goal.status,
      reviewReason: error?.slice(0, 2000),
      resultPreview: goal.resultSummary?.trim()?.slice(0, 2000) || undefined,
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

export function islandForFailed(goal: Goal, message?: string): DynamicIslandPayload {
  return {
    id: `failed-${goal.id}`,
    kind: "goal.failed",
    severity: "error",
    title: goal.title.slice(0, 120),
    message: (message ?? "执行失败").slice(0, 2000),
    goalId: goal.id,
    expanded: true,
    autoDismissMs: 0,
    meta: {
      status: goal.status,
      resultPreview: goal.resultSummary?.trim()?.slice(0, 2000) || undefined,
    },
    actions: [
      {
        id: "retry",
        label: "重试",
        variant: "primary",
        action: { type: "retry", goalId: goal.id },
      },
      {
        id: "navigate",
        label: "查看",
        variant: "default",
        action: { type: "navigate", goalId: goal.id },
      },
    ],
  };
}

export function islandForGateBlocked(
  goal: Goal,
  message: string,
  gateReasons?: NonNullable<DynamicIslandPayload["meta"]>["gateReasons"],
): DynamicIslandPayload {
  return {
    id: `gate-block-${goal.id}`,
    kind: "goal.gate_blocked",
    severity: "warning",
    title: goal.title.slice(0, 120),
    message: message.slice(0, 2000),
    goalId: goal.id,
    expanded: true,
    autoDismissMs: 0,
    meta: {
      status: goal.status,
      gateReasons,
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
  };
}

export function islandForGoalStatusChange(
  goal: Goal,
  from: GoalStatus,
): DynamicIslandPayload | null {
  if (goal.status === "awaiting_review") {
    return islandForAwaitingReview(goal);
  }
  if (goal.status === "failed") {
    return islandForFailed(goal, "执行失败");
  }
  if (goal.status === "done") {
    return {
      id: `${goal.id}-done-${goal.revision ?? 0}`,
      kind: "goal.done",
      severity: "success",
      title: goal.title.slice(0, 120),
      message: "已达标",
      goalId: goal.id,
      autoDismissMs: 10_000,
      meta: {
        status: goal.status,
        resultPreview: goal.resultSummary?.trim()?.slice(0, 2000) || undefined,
        deliverables: goal.deliverables,
      },
      actions: [
        {
          id: "navigate",
          label: "查看",
          variant: "default",
          action: { type: "navigate", goalId: goal.id },
        },
      ],
    };
  }
  if (goal.status === "running") {
    const message = from === "failed" ? "已重新执行" : "开始执行";
    return {
      id: `${goal.id}-running-${goal.revision ?? 0}`,
      kind: "goal.running",
      severity: "info",
      title: goal.title.slice(0, 120),
      message,
      goalId: goal.id,
      autoDismissMs: from === "failed" ? 5000 : 8000,
      meta: { status: goal.status },
      actions: [
        {
          id: "navigate",
          label: "查看任务",
          variant: "default",
          action: { type: "navigate", goalId: goal.id },
        },
      ],
    };
  }
  if (goal.status === "cancelled") {
    return {
      id: `${goal.id}-cancelled-${goal.revision ?? 0}`,
      kind: "broadcast",
      severity: "warning",
      title: goal.title.slice(0, 120),
      message: "已取消",
      goalId: goal.id,
      autoDismissMs: 8000,
      meta: { status: goal.status },
      actions: [
        {
          id: "navigate",
          label: "查看任务",
          variant: "default",
          action: { type: "navigate", goalId: goal.id },
        },
      ],
    };
  }
  return null;
}

export function islandFromSimpleBroadcast(
  id: string,
  message: string,
  opts?: {
    title?: string;
    goalId?: string;
    severity?: IslandSeverity;
    autoDismissMs?: number;
  },
): DynamicIslandPayload {
  return {
    id: id.slice(0, 128),
    kind: "broadcast",
    severity: opts?.severity ?? "info",
    title: (opts?.title ?? "通知").slice(0, 120),
    message: message.slice(0, 2000),
    goalId: opts?.goalId,
    autoDismissMs: opts?.autoDismissMs ?? 6000,
    actions: opts?.goalId
      ? [
          {
            id: "navigate",
            label: "查看",
            variant: "default",
            action: { type: "navigate", goalId: opts.goalId },
          },
        ]
      : undefined,
  };
}
