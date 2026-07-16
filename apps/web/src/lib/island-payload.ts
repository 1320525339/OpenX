import type { DynamicIslandPayload, Goal, GoalStatus } from "@openx/shared";
import {
  islandForGoalStatusChange,
  islandFromSimpleBroadcast,
} from "@openx/shared";
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
      id: `${next.id}-rework-${next.revision ?? Date.now()}`.slice(0, 128),
      kind: "goal.rework",
      severity: "warning",
      title: next.title.slice(0, 120),
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
  return islandFromSimpleBroadcast(id, message, opts);
}

export function islandFromBroadcast(
  message: string,
  opts?: { goalId?: string; severity?: DynamicIslandPayload["severity"] },
): DynamicIslandPayload {
  return islandFromSimpleBroadcast(`broadcast-${Date.now()}`, message, opts);
}

function islandForGoalStatus(goal: Goal, from: GoalStatus): DynamicIslandPayload | null {
  const base = islandForGoalStatusChange(goal, from);
  if (!base) return null;

  const deliverables = resolveGoalDeliverables(goal);
  const deliveryHint = deliverableSummaryLabel(deliverables);
  if (!deliveryHint) return base;

  const message = `${base.message}（${deliveryHint}）`.slice(0, 2000);
  return {
    ...base,
    message,
    meta: {
      ...base.meta,
      deliverables: deliverables.length > 0 ? deliverables : base.meta?.deliverables,
    },
  };
}
