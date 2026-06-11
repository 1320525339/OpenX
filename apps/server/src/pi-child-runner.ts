/**
 * Pi 子进程入口：由 pi-isolated-run fork 启动，避免阻塞主进程事件循环。
 */
import { piExecutor } from "@openx/executor-pi";
import type { ExecutorContext } from "@openx/executor-core";

type RunMsg = {
  type: "run";
  payload: Omit<ExecutorContext, "callbacks">;
};

process.on("message", (msg: RunMsg) => {
  if (msg.type !== "run") return;

  void (async () => {
    const {
      goal,
      workspaceRoot,
      settings,
      priorLogs,
      priorSummaries,
      priorReviewRounds,
      isRework,
      enabledSkills,
    } = msg.payload;

    const send = (payload: unknown) => {
      if (process.send) process.send(payload);
    };

    try {
      await piExecutor.run({
        goal,
        workspaceRoot,
        settings,
        priorLogs,
        priorSummaries,
        priorReviewRounds,
        isRework,
        enabledSkills,
        callbacks: {
          onProgress: async (progress, message) => {
            send({ type: "progress", progress, message });
          },
          onLog: async (level, message) => {
            send({ type: "log", level, message });
          },
          onRunEvent: async (event) => {
            send({ type: "runEvent", event });
          },
          onComplete: async (summary, deliverables) => {
            send({ type: "complete", summary, deliverables });
          },
          onFail: async (message) => {
            send({ type: "fail", message });
          },
        },
      });
    } catch (err) {
      send({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  })();
});
