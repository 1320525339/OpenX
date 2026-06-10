import type { Goal } from "@openx/shared";
import { broadcast } from "./sse.js";

export function narrate(message: string): void {
  broadcast({
    type: "narration.append",
    message,
    timestamp: new Date().toISOString(),
  });
}

export function narrateGoalChange(goal: Goal, event: "start" | "review" | "done" | "fail" | "rework"): void {
  const map: Record<string, string> = {
    start: `已开始处理：「${goal.title}」（${goal.executorId}）`,
    review: `「${goal.title}」已交差，请确认是否达标。`,
    done: `「${goal.title}」已达标。`,
    fail: `「${goal.title}」未完成，请查看日志。`,
    rework: `「${goal.title}」已返工，重新执行中。`,
  };
  narrate(map[event] ?? `「${goal.title}」状态更新`);
}
