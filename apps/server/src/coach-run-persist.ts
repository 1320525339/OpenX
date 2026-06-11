import type { CoachExecutionMessage, GoalRunState } from "@openx/shared";
import {
  getGoalById,
  hasCoachExecutionMessage,
  saveCoachExecutionMessage,
} from "./db.js";
import { broadcast } from "./sse.js";

/** run 结束后将执行快照写入对话线程（幂等） */
export function persistCoachRunMessage(
  goalId: string,
  run: GoalRunState,
): CoachExecutionMessage | null {
  const goal = getGoalById(goalId);
  if (!goal?.conversationId) return null;
  const hasContent =
    run.events.length > 0 ||
    run.liveText.length > 0 ||
    (run.thinkingText?.length ?? 0) > 0;
  if (!hasContent) return null;

  const runId = run.runId ?? `ended-${goalId}`;
  if (hasCoachExecutionMessage(goal.conversationId, goalId, runId)) {
    return null;
  }

  const saved = saveCoachExecutionMessage(goal.conversationId, {
    goalId,
    goalTitle: goal.title,
    goalStatus: goal.status,
    runId,
    run: {
      ...run,
      goalId,
      runId,
      active: false,
      thinkingText: run.thinkingText ?? "",
    },
  });

  broadcast({
    type: "coach.message",
    conversationId: goal.conversationId,
    message: saved,
  });

  return saved;
}
