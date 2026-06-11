import { appendLog, getGoalById, listGoals, listLogs } from "./db.js";
import { markGoalFailed } from "./goal-lifecycle.js";
import { cancelPiChild } from "./pi-isolated-run.js";
import { getExecutor } from "@openx/executor-core";
import { endGoalRun } from "./run-service.js";
import { broadcast } from "./sse.js";
import { narrate } from "./narration.js";
import { loadSettings } from "./settings-store.js";
import { DEFAULT_PI_MAX_TOOL_CALLS } from "@openx/shared";

const WATCHDOG_INTERVAL_MS = 30_000;
/** 进度 ≥85% 且超过此时间无状态变化 → 判定挂起 */
const PI_STALL_MS = 4 * 60_000;
/** 工具日志条数超过此值且仍在 running → 判定死循环 */
const PI_TOOL_LOG_CEILING = 14;

let timer: ReturnType<typeof setInterval> | undefined;

function countPiToolLogs(goalId: string): number {
  return listLogs(goalId, 200).filter((l) => /\[pi\] 工具 #\d+/.test(l.message)).length;
}

function failStuckPiGoal(goalId: string, reason: string): void {
  const goal = getGoalById(goalId);
  if (!goal || goal.status !== "running" || goal.executorId !== "pi") return;

  cancelPiChild(goalId);
  getExecutor("pi")?.cancel?.(goalId);
  endGoalRun(goalId, "failed", reason);
  const log = appendLog(goalId, "error", reason);
  broadcast({ type: "log.append", goalId, ...log });
  markGoalFailed(goalId, reason);
  narrate(`「${goal.title}」Pi 执行异常：${reason}`);
}

function checkPiGoals(): void {
  const settings = loadSettings();
  const maxTools =
    settings.executors.pi?.maxToolCalls ??
    Number.parseInt(
      process.env.OPENX_PI_MAX_TOOLS ?? String(DEFAULT_PI_MAX_TOOL_CALLS),
      10,
    );
  const toolCeiling = Math.max(maxTools + 2, PI_TOOL_LOG_CEILING);
  const now = Date.now();

  for (const goal of listGoals("running")) {
    if (goal.executorId !== "pi") continue;

    const toolCount = countPiToolLogs(goal.id);
    if (toolCount >= toolCeiling) {
      failStuckPiGoal(
        goal.id,
        `Pi 工具调用过多（${toolCount} 次），疑似死循环，已强制终止`,
      );
      continue;
    }

    const updatedAt = Date.parse(goal.updatedAt);
    if (!Number.isFinite(updatedAt)) continue;

    if (goal.progress >= 85 && now - updatedAt > PI_STALL_MS) {
      failStuckPiGoal(
        goal.id,
        `Pi 在 ${goal.progress}% 停留超过 ${Math.round(PI_STALL_MS / 60_000)} 分钟，已强制终止`,
      );
    }
  }
}

export function startPiWatchdog(): void {
  if (timer) return;
  timer = setInterval(checkPiGoals, WATCHDOG_INTERVAL_MS);
  if (typeof timer === "object" && "unref" in timer) {
    timer.unref();
  }
}

export function stopPiWatchdog(): void {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
}

/** 测试用 */
export function runPiWatchdogOnce(): void {
  checkPiGoals();
}
