import type { Goal } from "@openx/shared";
import { api } from "../api";

export type TaskActionResult =
  | { ok: true }
  | { ok: false; error: string };

export type TaskActionType = "approve" | "rework" | "start" | "cancel";

export type TaskActionInput = {
  type: TaskActionType;
  goalId: string;
  reason?: string;
  /** start 时若为 failed 则走 retryGoal */
  goalStatus?: Goal["status"];
};

/** 任务动作回调：true=成功，false=失败（勿再吞异常伪造成功） */
export type GoalActionHandler = (id: string) => Promise<boolean>;
export type GoalReworkHandler = (id: string, reason?: string) => Promise<boolean>;

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * 客户端任务动作唯一成功语义：API 失败返回 ok:false，绝不吞成成功。
 */
export async function runTaskAction(input: TaskActionInput): Promise<TaskActionResult> {
  const { type, goalId, reason, goalStatus } = input;
  try {
    switch (type) {
      case "approve":
        await api.approveGoal(goalId);
        break;
      case "rework":
        await api.reworkGoal(goalId, reason);
        break;
      case "start":
        if (goalStatus === "failed") {
          await api.retryGoal(goalId);
        } else {
          await api.startGoal(goalId);
        }
        break;
      case "cancel":
        await api.cancelGoal(goalId);
        break;
      default: {
        const _exhaustive: never = type;
        return { ok: false, error: `未知动作：${String(_exhaustive)}` };
      }
    }
    return { ok: true };
  } catch (err) {
    const fallback =
      type === "approve"
        ? "确认失败"
        : type === "rework"
          ? "返工失败"
          : type === "start"
            ? "启动失败"
            : "取消失败";
    return { ok: false, error: errorMessage(err, fallback) };
  }
}
