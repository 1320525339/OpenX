import type { Goal, GoalRunState } from "@openx/shared";

export type ForemanManagedStatus = {
  primary: string;
  secondary: string;
};

/** 对话流任务单底栏：工头托管执行状态文案 */
export function describeForemanManagedStatus(
  goal: Goal,
  run?: GoalRunState,
): ForemanManagedStatus | null {
  if (goal.status !== "running") return null;

  switch (goal.crewStatus) {
    case "awaiting_foreman":
      return {
        primary: "工头状态：托管执行中",
        secondary: "工头判定下一步",
      };
    case "awaiting_user":
      return {
        primary: "工头状态：等待开发商",
        secondary: "施工队已暂停，待你决策",
      };
    default:
      if (run?.active) {
        return {
          primary: "工头状态：托管执行中",
          secondary: "等待施工队继续返回",
        };
      }
      if (run && (run.events.length > 0 || run.liveText || run.thinkingText)) {
        return {
          primary: "工头状态：托管执行中",
          secondary: "施工队本轮已返回",
        };
      }
      return {
        primary: "工头状态：托管执行中",
        secondary: "等待施工队执行",
      };
  }
}
