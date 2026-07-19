import { getExecutor } from "@openx/executor-core";
import { isAcpExecutorId } from "@openx/shared";
import { appendLog, getGoalById, listGoals, listLogs } from "./db.js";
import { markGoalFailed } from "./goal-lifecycle.js";
import { endGoalRun } from "./run-service.js";
import { broadcast } from "./sse.js";
import { narrate } from "./narration.js";
import { tryWithGoalLock } from "./goal-lock.js";

const WATCHDOG_INTERVAL_MS = 30_000;
/** 进度 ≥85% 且超过此时间无状态变化 → 判定挂起 */
const ACP_STALL_MS = 4 * 60_000;
/** 初始化阶段（progress ≤25）超过此时间 → 判定启动挂起 */
const ACP_INIT_STALL_MS = 10 * 60_000;
/** 工具日志条数超过此值且仍在 running → 判定死循环 */
const ACP_TOOL_LOG_CEILING = 14;

let timer: ReturnType<typeof setInterval> | undefined;

function countAcpToolLogs(goalId: string): number {
  return listLogs(goalId, 200).filter((l) =>
    /\[(acp:[^\]]+)\] 工具 #\d+/.test(l.message),
  ).length;
}

function failStuckAcpGoal(goalId: string, reason: string): void {
  void tryWithGoalLock(goalId, () => {
    const goal = getGoalById(goalId);
    if (!goal || goal.status !== "running" || !isAcpExecutorId(goal.executorId)) return;

    getExecutor("acp")?.cancel?.(goalId);
    endGoalRun(goalId, "failed", reason);
    const log = appendLog(goalId, "error", reason);
    broadcast({ type: "log.append", goalId, ...log });
    markGoalFailed(goalId, reason);
    narrate(`「${goal.title}」ACP 执行异常：${reason}`);
  });
}

function checkAcpGoals(): void {
  const now = Date.now();

  for (const goal of listGoals("running")) {
    if (!isAcpExecutorId(goal.executorId)) continue;

    const toolCount = countAcpToolLogs(goal.id);
    if (toolCount >= ACP_TOOL_LOG_CEILING) {
      failStuckAcpGoal(
        goal.id,
        `ACP 工具调用过多（${toolCount} 次），疑似死循环，已强制终止`,
      );
      continue;
    }

    const updatedAt = Date.parse(goal.updatedAt);
    if (!Number.isFinite(updatedAt)) continue;

    if (goal.progress <= 25 && now - updatedAt > ACP_INIT_STALL_MS) {
      failStuckAcpGoal(
        goal.id,
        `ACP 初始化超过 ${Math.round(ACP_INIT_STALL_MS / 60_000)} 分钟无进展，已强制终止`,
      );
      continue;
    }

    if (goal.progress >= 85 && now - updatedAt > ACP_STALL_MS) {
      failStuckAcpGoal(
        goal.id,
        `ACP 在 ${goal.progress}% 停留超过 ${Math.round(ACP_STALL_MS / 60_000)} 分钟，已强制终止`,
      );
    }
  }
}

export function startAcpWatchdog(): void {
  if (timer) return;
  timer = setInterval(checkAcpGoals, WATCHDOG_INTERVAL_MS);
  if (typeof timer === "object" && "unref" in timer) {
    timer.unref();
  }
}

export function stopAcpWatchdog(): void {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
}

/** 测试用 */
export function runAcpWatchdogOnce(): void {
  checkAcpGoals();
}
