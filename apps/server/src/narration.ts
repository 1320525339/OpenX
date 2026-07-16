import type { Goal } from "@openx/shared";
import { broadcast } from "./sse.js";

export type NarrationEvent =
  | "start"
  | "review"
  | "done"
  | "fail"
  | "rework"
  | "cancel"
  | "pause"
  | "resume";

export function narrate(message: string): void {
  broadcast({
    type: "narration.append",
    message,
    timestamp: new Date().toISOString(),
  });
}

export function narrateGoalChange(goal: Goal, event: NarrationEvent): void {
  const map: Record<NarrationEvent, string> = {
    start: `已开始处理：「${goal.title}」（${goal.executorId}）`,
    review: `「${goal.title}」已交差，请确认是否达标。`,
    done: `「${goal.title}」已达标。`,
    fail: `「${goal.title}」未完成，请查看日志。`,
    rework: `「${goal.title}」已返工，重新执行中。`,
    cancel: `「${goal.title}」已终止。`,
    pause: `「${goal.title}」已暂停，等待开发商决策。`,
    resume: `「${goal.title}」已按开发商决策继续执行。`,
  };
  narrate(map[event] ?? `「${goal.title}」状态更新`);
}
