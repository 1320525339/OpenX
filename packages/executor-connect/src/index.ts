import type { ExecutorAdapter, ExecutorContext } from "@openx/executor-core";

export type ConnectExecutorDeps = {
  getConnection: (executorId: string) => { agentName: string; toolName: string } | undefined;
  listConnections: () => Array<{ executorId: string; agentName: string; toolName: string }>;
};

export function createConnectExecutor(deps: ConnectExecutorDeps): ExecutorAdapter {
  return {
    id: "connect",
    displayName: "Connect Agent（拉取式）",

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

    async run(ctx: ExecutorContext) {
      const { goal, callbacks } = ctx;
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
