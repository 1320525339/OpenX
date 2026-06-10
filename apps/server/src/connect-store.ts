import { nanoid } from "nanoid";
import type { AgentConnection, ConnectInput } from "@openx/shared";

const connections = new Map<string, AgentConnection>();
const cancelledGoalIds = new Set<string>();

export function registerConnection(input: ConnectInput): AgentConnection {
  const now = new Date().toISOString();
  const connectionId = nanoid();
  const conn: AgentConnection = {
    connectionId,
    toolName: input.toolName,
    agentName: input.agentName,
    executorId: input.executorId ?? input.toolName,
    connectedAt: now,
    lastHeartbeatAt: now,
  };
  connections.set(connectionId, conn);
  return conn;
}

export function getConnection(connectionId: string): AgentConnection | undefined {
  return connections.get(connectionId);
}

export function touchConnection(connectionId: string): AgentConnection | undefined {
  const conn = connections.get(connectionId);
  if (!conn) return undefined;
  conn.lastHeartbeatAt = new Date().toISOString();
  connections.set(connectionId, conn);
  return conn;
}

export function removeConnection(connectionId: string): boolean {
  return connections.delete(connectionId);
}

export function listConnections(): AgentConnection[] {
  return [...connections.values()];
}

export function getConnectionByExecutorId(executorId: string): AgentConnection | undefined {
  return [...connections.values()].find((c) => c.executorId === executorId);
}

export function removeConnectionByExecutorId(executorId: string): boolean {
  const conn = getConnectionByExecutorId(executorId);
  if (!conn) return false;
  return connections.delete(conn.connectionId);
}

/** 标记 Connect 目标已取消，心跳不再下发 */
export function markGoalCancelledForConnect(goalId: string): void {
  cancelledGoalIds.add(goalId);
}

export function clearGoalCancelledForConnect(goalId: string): void {
  cancelledGoalIds.delete(goalId);
}

export function isGoalCancelledForConnect(goalId: string): boolean {
  return cancelledGoalIds.has(goalId);
}

/** 移除心跳超时的僵尸连接 */
export function pruneStaleConnections(maxAgeMs: number): string[] {
  const now = Date.now();
  const removed: string[] = [];
  for (const [id, conn] of connections) {
    const last = Date.parse(conn.lastHeartbeatAt);
    if (Number.isFinite(last) && now - last > maxAgeMs) {
      connections.delete(id);
      removed.push(conn.executorId);
    }
  }
  return removed;
}

/** 测试用 */
export function resetConnections(): void {
  connections.clear();
  cancelledGoalIds.clear();
}
