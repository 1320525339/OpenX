import {
  CONNECT_ANY_EXECUTOR_ID,
  GOAL_PRIORITY_WEIGHT,
  type Goal,
} from "@openx/shared";
import { appendLog, claimConnectPoolGoal, listGoals } from "./db.js";
import { isGoalCancelledForConnect } from "./connect-store.js";
import { broadcast } from "./sse.js";

function sortPoolGoals(goals: Goal[]): Goal[] {
  return [...goals].sort(
    (a, b) =>
      GOAL_PRIORITY_WEIGHT[a.priority] - GOAL_PRIORITY_WEIGHT[b.priority] ||
      a.createdAt.localeCompare(b.createdAt),
  );
}

export function listConnectPoolGoals(): Goal[] {
  return sortPoolGoals(
    listGoals("running")
      .filter((g) => g.executorId === CONNECT_ANY_EXECUTOR_ID)
      .filter((g) => !isGoalCancelledForConnect(g.id)),
  );
}

/** 原子认领一条 connect:any 任务；goalId 未传时按优先级取最早一条 */
export function claimOneConnectPoolGoal(
  executorId: string,
  agentName: string,
  goalId?: string,
): Goal | null {
  const candidates = listConnectPoolGoals();
  const ordered = goalId
    ? candidates.filter((g) => g.id === goalId)
    : candidates;

  for (const candidate of ordered) {
    const claimed = claimConnectPoolGoal(candidate.id, executorId);
    if (!claimed) continue;
    appendLog(
      claimed.id,
      "info",
      `Connect 任务池认领：${agentName} (${executorId})`,
    );
    broadcast({ type: "goal.updated", goal: claimed });
    return claimed;
  }
  return null;
}
