import { listGoals } from "./db.js";
import { isConnectExecutorId } from "@openx/shared";
import {
  getConnectionByExecutorId,
  isGoalCancelledForConnect,
  pruneStaleConnections,
} from "./connect-store.js";
import { markGoalFailed } from "./goal-lifecycle.js";
import { appendLog } from "./db.js";

const CONNECT_GOAL_TIMEOUT_MS = 30 * 60 * 1000;
const CONNECT_HEARTBEAT_STALE_MS = 5 * 60 * 1000;
const WATCHDOG_INTERVAL_MS = 60 * 1000;

let timer: ReturnType<typeof setInterval> | undefined;

function checkConnectGoals(): void {
  pruneStaleConnections(CONNECT_HEARTBEAT_STALE_MS);
  const now = Date.now();

  for (const goal of listGoals("running")) {
    if (!isConnectExecutorId(goal.executorId)) continue;
    if (isGoalCancelledForConnect(goal.id)) continue;

    const conn = getConnectionByExecutorId(goal.executorId);
    if (!conn) {
      const updatedAt = Date.parse(goal.updatedAt);
      if (Number.isFinite(updatedAt) && now - updatedAt > CONNECT_GOAL_TIMEOUT_MS) {
        markGoalFailed(
          goal.id,
          `Connect Agent 离线超过 ${Math.round(CONNECT_GOAL_TIMEOUT_MS / 60_000)} 分钟，任务已标记失败`,
        );
      }
      continue;
    }

    const lastHb = Date.parse(conn.lastHeartbeatAt);
    if (Number.isFinite(lastHb) && now - lastHb > CONNECT_GOAL_TIMEOUT_MS) {
      appendLog(
        goal.id,
        "warn",
        `Connect Agent「${conn.agentName}」心跳超时，任务标记失败`,
      );
      markGoalFailed(
        goal.id,
        `Connect Agent 心跳超时（${conn.agentName}）`,
      );
    }
  }
}

export function startConnectWatchdog(): void {
  if (timer) return;
  timer = setInterval(checkConnectGoals, WATCHDOG_INTERVAL_MS);
  if (typeof timer === "object" && "unref" in timer) {
    timer.unref();
  }
}

export function stopConnectWatchdog(): void {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
}
