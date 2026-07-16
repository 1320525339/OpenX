/**
 * Pi 子进程入口：由 pi-isolated-run fork 启动，避免阻塞主进程事件循环。
 * 支持 run / resume（park 后续跑，session 留在本进程）。
 */
import { piExecutor } from "@openx/executor-pi";
import type { ExecutorContext } from "@openx/executor-core";

type CtxPayload = Omit<ExecutorContext, "callbacks">;

type InMsg =
  | { type: "run"; payload: CtxPayload }
  | { type: "resume"; payload: CtxPayload };

function send(payload: unknown) {
  if (process.send) process.send(payload);
}

function buildCallbacks(): ExecutorContext["callbacks"] {
  return {
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
    onParkAwaitingUser: async (checkpointSummary) => {
      send({ type: "park", checkpointSummary });
    },
    onCrewSession: async (crewSessionId) => {
      send({ type: "log", level: "info", message: `[pi-child] crewSession=${crewSessionId}` });
    },
  };
}

function toContext(payload: CtxPayload): ExecutorContext {
  return {
    ...payload,
    callbacks: buildCallbacks(),
  };
}

process.on("message", (msg: InMsg) => {
  if (msg.type === "run") {
    void (async () => {
      try {
        await piExecutor.run(toContext(msg.payload));
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return;
  }

  if (msg.type === "resume") {
    void (async () => {
      try {
        if (!piExecutor.steerRework) {
          send({ type: "fail", message: "Pi 子进程不支持 steerRework" });
          return;
        }
        const ok = await piExecutor.steerRework(toContext(msg.payload));
        if (!ok) {
          send({ type: "fail", message: "施工队 session 不可用，请重新派发" });
        }
        // complete/fail/park 已由 callbacks 发出；ok=true 且 parked 时也会发 park
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  }
});
