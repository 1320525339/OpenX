import type { DynamicIslandPayload, Goal, GoalStatus } from "@openx/shared";
import {
  deliverableSummaryLabel,
  resolveGoalDeliverables,
} from "./goal-deliverables";

export type { DynamicIslandPayload, IslandAction } from "@openx/shared";

export function islandFromGoalChange(prev: Goal, next: Goal): DynamicIslandPayload | null {
  if (prev.status !== next.status) {
    return islandForGoalStatus(next, prev.status);
  }
  if (next.effectStatus === "rework" && prev.effectStatus !== "rework") {
    return {
      id: `${next.id}-rework-${Date.now()}`,
      kind: "goal.rework",
      severity: "warning",
      title: next.title,
      message: "任务已返工，执行器将按反馈修改",
      goalId: next.id,
      expanded: false,
      autoDismissMs: 8000,
      meta: { status: next.status },
      actions: [
        {
          id: "navigate",
          label: "查看任务",
          variant: "default",
          action: { type: "navigate", goalId: next.id },
        },
      ],
    };
  }
  return null;
}

export function islandFromSimpleMessage(
  id: string,
  message: string,
  opts?: {
    title?: string;
    goalId?: string;
    severity?: DynamicIslandPayload["severity"];
  },
): DynamicIslandPayload {
  return {
    id,
    kind: "broadcast",
    severity: opts?.severity ?? "info",
    title: opts?.title ?? "通知",
    message,
    goalId: opts?.goalId,
    autoDismissMs: 6000,
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

export function islandFromBroadcast(
  message: string,
  opts?: { goalId?: string; severity?: DynamicIslandPayload["severity"] },
): DynamicIslandPayload {
  return {
    id: `broadcast-${Date.now()}`,
    kind: "broadcast",
    severity: opts?.severity ?? "info",
    title: "通知",
    message,
    goalId: opts?.goalId,
    autoDismissMs: 6000,
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

function islandForGoalStatus(goal: Goal, from: GoalStatus): DynamicIslandPayload | null {
  const deliverables = resolveGoalDeliverables(goal);
  const deliveryHint = deliverableSummaryLabel(deliverables);
  const base = statusChangeMessage(goal, from);
  const message = deliveryHint ? `${base}（${deliveryHint}）` : base;

  if (goal.status === "awaiting_review") {
    return {
      id: `await-review-${goal.id}-${Date.now()}`,
      kind: "goal.awaiting_review",
      severity: "info",
      title: goal.title,
      message,
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
        deliverables: deliverables.length > 0 ? deliverables : undefined,
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

  if (goal.status === "done") {
    return {
      id: `${goal.id}-done-${Date.now()}`,
      kind: "goal.done",
      severity: "success",
      title: goal.title,
      message,
      goalId: goal.id,
      autoDismissMs: 10_000,
      meta: {
        status: goal.status,
        resultPreview: goal.resultSummary?.trim() || undefined,
        deliverables: deliverables.length > 0 ? deliverables : undefined,
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

  if (goal.status === "failed") {
    return {
      id: `${goal.id}-failed-${Date.now()}`,
      kind: "goal.failed",
      severity: "error",
      title: goal.title,
      message,
      goalId: goal.id,
      expanded: true,
      autoDismissMs: 0,
      meta: { status: goal.status, resultPreview: goal.resultSummary?.trim() || undefined },
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

  if (goal.status === "running" && from === "failed") {
    return {
      id: `${goal.id}-retry-${Date.now()}`,
      kind: "goal.running",
      severity: "info",
      title: goal.title,
      message,
      goalId: goal.id,
      autoDismissMs: 5000,
      meta: { status: goal.status },
    };
  }

  if (["running", "cancelled"].includes(goal.status)) {
    return {
      id: `${goal.id}-${goal.status}-${Date.now()}`,
      kind: goal.status === "cancelled" ? "broadcast" : "goal.running",
      severity: goal.status === "cancelled" ? "warning" : "info",
      title: goal.title,
      message,
      goalId: goal.id,
      autoDismissMs: 5000,
      meta: { status: goal.status },
    };
  }

  return null;
}

function statusChangeMessage(goal: Goal, from: GoalStatus): string {
  switch (goal.status) {
    case "awaiting_review":
      return "已交差，待验收";
    case "done":
      return "已达标";
    case "failed":
      return "执行失败";
    case "running":
      return from === "failed" ? "已重新执行" : "开始执行";
    case "cancelled":
      return "已取消";
    default:
      return "状态已更新";
  }
}
