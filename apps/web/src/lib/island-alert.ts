import type { Goal, GoalStatus } from "@openx/shared";
import {
  deliverableSummaryLabel,
  resolveGoalDeliverables,
  type GoalDeliverable,
} from "./goal-deliverables";

export type IslandAlertKind = "success" | "warning" | "info" | "error";

export type IslandAlert = {
  id: string;
  message: string;
  goalId?: string;
  kind?: IslandAlertKind;
  status?: GoalStatus;
  /** 任务交差时的结构化交付物 */
  deliverables?: GoalDeliverable[];
  /** 结果摘要全文（展开态展示） */
  resultPreview?: string;
  /** 是否默认展开（待验收） */
  expanded?: boolean;
  /** 自动收起毫秒；0 = 不自动消失 */
  autoDismissMs?: number;
};

const NOTIFY_STATUSES: GoalStatus[] = [
  "running",
  "awaiting_review",
  "done",
  "failed",
  "cancelled",
];

export function islandAlertFromGoalChange(prev: Goal, next: Goal): IslandAlert | null {
  if (prev.status !== next.status && NOTIFY_STATUSES.includes(next.status)) {
    const deliverables = resolveGoalDeliverables(next);
    const deliveryHint = deliverableSummaryLabel(deliverables);
    const base = statusChangeMessage(next, prev.status);
    return {
      id: `${next.id}-${next.status}-${Date.now()}`,
      message: deliveryHint ? `${base}（${deliveryHint}）` : base,
      goalId: next.id,
      kind: statusKind(next.status),
      status: next.status,
      deliverables: deliverables.length > 0 ? deliverables : undefined,
      resultPreview: next.resultSummary?.trim() || undefined,
      expanded: next.status === "awaiting_review",
      autoDismissMs:
        next.status === "awaiting_review"
          ? 0
          : next.status === "done"
            ? 10_000
            : 6000,
    };
  }

  if (next.effectStatus === "rework" && prev.effectStatus !== "rework") {
    return {
      id: `${next.id}-rework-${Date.now()}`,
      message: `「${next.title}」已返工，点击查看`,
      goalId: next.id,
      kind: "warning",
      status: next.status,
    };
  }

  return null;
}

export function islandAlertFromMessage(
  message: string,
  opts?: { goalId?: string; kind?: IslandAlertKind },
): IslandAlert {
  return {
    id: `msg-${Date.now()}`,
    message,
    goalId: opts?.goalId,
    kind: opts?.kind ?? "info",
  };
}

function statusKind(status: GoalStatus): IslandAlertKind {
  if (status === "awaiting_review" || status === "done") return "success";
  if (status === "failed") return "error";
  if (status === "cancelled") return "warning";
  return "info";
}

function statusChangeMessage(goal: Goal, from: GoalStatus): string {
  const title = goal.title;
  switch (goal.status) {
    case "awaiting_review":
      return `「${title}」已交差，待你验收`;
    case "done":
      return `「${title}」已达标，点击查看`;
    case "failed":
      return `「${title}」执行失败，点击查看`;
    case "running":
      return from === "failed"
        ? `「${title}」已重新执行`
        : `「${title}」开始执行`;
    case "cancelled":
      return `「${title}」已取消`;
    default:
      return `「${title}」状态已更新`;
  }
}