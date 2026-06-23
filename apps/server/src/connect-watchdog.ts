import { listGoals } from "./db.js";
import {
  isConnectAnyExecutorId,
  isConnectExecutorId,
} from "@openx/shared";
import {
  getConnectionByExecutorId,
  isGoalCancelledForConnect,
  pruneStaleConnections,
  clearGoalCancelledForConnect,
} from "./connect-store.js";
import { markGoalFailed } from "./goal-lifecycle.js";
import { appendLog } from "./db.js";

const CONNECT_DISPATCH_TIMEOUT_MS = 5 * 60 * 1000;
const CONNECT_POOL_FAIL_TIMEOUT_MS = 30 * 60 * 1000;
const CONNECT_GOAL_TIMEOUT_MS = 30 * 60 * 1000;
const CONNECT_HEARTBEAT_STALE_MS = 5 * 60 * 1000;
const WATCHDOG_INTERVAL_MS = 60 * 1000;

let timer: ReturnType<typeof setInterval> | undefined;
const warnedConnectAnyGoalIds = new Set<string>();

function checkConnectGoals(): void {
  pruneStaleConnections(CONNECT_HEARTBEAT_STALE_MS);
  const now = Date.now();

  for (const goal of listGoals("running")) {
    if (!isConnectExecutorId(goal.executorId)) continue;
    if (isGoalCancelledForConnect(goal.id)) continue;

    const updatedAt = Date.parse(goal.updatedAt);
    const ageMs = Number.isFinite(updatedAt) ? now - updatedAt : 0;

    if (
      isConnectAnyExecutorId(goal.executorId) &&
      goal.progress <= 10 &&
      ageMs > CONNECT_POOL_FAIL_TIMEOUT_MS
    ) {
      warnedConnectAnyGoalIds.delete(goal.id);
      markGoalFailed(
        goal.id,
        `任务池任务超过 ${Math.round(CONNECT_POOL_FAIL_TIMEOUT_MS / 60_000)} 分钟未被认领`,
      );
      clearGoalCancelledForConnect(goal.id);
      continue;
    }

    if (
      isConnectAnyExecutorId(goal.executorId) &&
      goal.progress <= 10 &&
      ageMs > CONNECT_DISPATCH_TIMEOUT_MS
    ) {
      if (!warnedConnectAnyGoalIds.has(goal.id)) {
        warnedConnectAnyGoalIds.add(goal.id);
        appendLog(
          goal.id,
          "warn",
          `任务池任务仍在等待 Connect CLI 认领（已 ${Math.round(ageMs / 60_000)} 分钟）`,
        );
      }
      continue;
    }
    warnedConnectAnyGoalIds.delete(goal.id);

    if (goal.progress <= 10 && ageMs > CONNECT_DISPATCH_TIMEOUT_MS) {
      markGoalFailed(
        goal.id,
        `Connect Agent 未在 ${Math.round(CONNECT_DISPATCH_TIMEOUT_MS / 60_000)} 分钟内拉取任务`,
      );
      clearGoalCancelledForConnect(goal.id);
      continue;
    }

    const conn = getConnectionByExecutorId(goal.executorId);
    if (!conn) {
      if (ageMs > CONNECT_GOAL_TIMEOUT_MS) {
        markGoalFailed(
          goal.id,
          `Connect Agent 离线超过 ${Math.round(CONNECT_GOAL_TIMEOUT_MS / 60_000)} 分钟，任务已标记失败`,
        );
        clearGoalCancelledForConnect(goal.id);
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
        `Connect Agent 心跳超时：${conn.agentName}`,
      );
      clearGoalCancelledForConnect(goal.id);
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

/** 娴嬭瘯鐢?*/
export function runConnectWatchdogOnce(): void {
  checkConnectGoals();
}
