import type { ExecutorAdapter, ExecutorContext, ExecutorDetectEntry } from "@openx/executor-core";
import { CONNECT_ANY_EXECUTOR_ID } from "@openx/shared";

export type ConnectCliProfile = {
  executorId: string;
  displayName: string;
  kind: "connect" | "acp";
};

function isOfflineProfileCandidate(executorId: string): boolean {
  return executorId !== "pi" && executorId !== "auto" && !executorId.startsWith("acp:");
}

export type ConnectExecutorDeps = {
  getConnection: (executorId: string) => { agentName: string; toolName: string } | undefined;
  listConnections: () => Array<{ executorId: string; agentName: string; toolName: string }>;
  listCliProfiles?: () => ConnectCliProfile[];
};

export function createConnectExecutor(deps: ConnectExecutorDeps): ExecutorAdapter {
  return {
    id: "connect",
    displayName: "Connect Agent（拉取式）",
    executionModel: "pull",
    matchExecutorId: (goalExecutorId) =>
      goalExecutorId !== "pi" &&
      goalExecutorId !== "auto" &&
      !goalExecutorId.startsWith("acp:"),

    async detect() {
      const conns = deps.listConnections();
      if (conns.length === 0) {
        return {
          available: false,
          hint: "无在线 Connect Agent（POST /api/connect 注册）",
        };
      }
      return {
        available: true,
        hint: `${conns.length} 个 Agent 在线：${conns.map((c) => `${c.agentName}(${c.executorId})`).join(", ")}`,
      };
    },

    async detectEntries() {
      const entries: ExecutorDetectEntry[] = [];
      const onlineIds = new Set<string>();
      const conns = deps.listConnections();

      for (const conn of conns) {
        onlineIds.add(conn.executorId);
        entries.push({
          id: conn.executorId,
          displayName: `Connect: ${conn.agentName}`,
          available: true,
          hint: `${conn.toolName} · 在线`,
        });
      }

      for (const profile of deps.listCliProfiles?.() ?? []) {
        if (onlineIds.has(profile.executorId)) continue;
        if (!isOfflineProfileCandidate(profile.executorId)) continue;
        entries.push({
          id: profile.executorId,
          displayName: profile.displayName,
          available: false,
          bootstrappable: profile.kind === "connect",
          hint:
            profile.kind === "connect"
              ? "已配置 · 未在线（派单时自动自举）"
              : "已配置 · 未在线",
        });
      }

      entries.unshift({
        id: CONNECT_ANY_EXECUTOR_ID,
        displayName: "Connect: 任意在线 CLI",
        available: conns.length > 0,
        hint:
          conns.length > 0
            ? `${conns.length} 个在线 CLI 可认领任务池任务`
            : "无在线 CLI，任务将等待认领",
      });

      return entries;
    },

    async run(ctx: ExecutorContext) {
      const { goal, callbacks } = ctx;

      if (goal.executorId === CONNECT_ANY_EXECUTOR_ID) {
        await callbacks.onLog(
          "info",
          "[connect] 已发布到任务池（connect:any），等待任意在线 Connect CLI 通过心跳认领",
        );
        await callbacks.onProgress(10, "等待 Connect CLI 认领…");
        return;
      }

      const conn = deps.getConnection(goal.executorId);
      if (!conn) {
        await callbacks.onFail(
          `Connect Agent 未注册或离线：executorId=${goal.executorId}`,
        );
        return;
      }

      await callbacks.onLog(
        "info",
        `[connect] 已派单至「${conn.agentName}」（${conn.toolName}），等待心跳拉取`,
      );
      await callbacks.onProgress(10, "等待 Connect Agent 通过心跳拉取…");
    },

    cancel() {
      /* Connect Agent 在外部进程自行处理取消 */
    },
  };
}
