/**
 * Pi 子进程入口：由 pi-isolated-run fork 启动，避免阻塞主进程事件循环。
 * 支持 run / resume（park 后续跑，session 留在本进程）。
 * 工头回调（onCrewQuestion / onCrewTurnReview）经 IPC 转发到主进程处理。
 */
import { piExecutor } from "@openx/executor-pi";
import type { ExecutorContext } from "@openx/executor-core";
import type {
  CrewDirective,
  CrewQuestion,
  ForemanTurnDecision,
  ForemanTurnReviewInput,
} from "@openx/shared";
import { randomUUID } from "node:crypto";

type CtxPayload = Omit<ExecutorContext, "callbacks">;

type InMsg =
  | { type: "run"; payload: CtxPayload }
  | { type: "resume"; payload: CtxPayload }
  | { type: "crewQuestionReply"; ipcRequestId: string; directive: CrewDirective }
  | {
      type: "crewTurnReviewReply";
      ipcRequestId: string;
      decision: ForemanTurnDecision;
    }
  | { type: "crewCallbackError"; ipcRequestId: string; message: string };

type PendingReply =
  | { kind: "crewQuestion"; resolve: (v: CrewDirective) => void; reject: (e: Error) => void }
  | {
      kind: "crewTurnReview";
      resolve: (v: ForemanTurnDecision) => void;
      reject: (e: Error) => void;
    };

const pendingReplies = new Map<string, PendingReply>();

function send(payload: unknown) {
  if (process.send) process.send(payload);
}

function awaitParentReply<T>(
  ipcRequestId: string,
  kind: PendingReply["kind"],
  sendMsg: unknown,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    pendingReplies.set(ipcRequestId, {
      kind,
      resolve: resolve as (v: never) => void,
      reject,
    } as PendingReply);
    send(sendMsg);
  });
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
      send({ type: "crewSession", crewSessionId });
    },
    onCrewQuestion: async (question: CrewQuestion): Promise<CrewDirective> => {
      const ipcRequestId = randomUUID();
      return awaitParentReply<CrewDirective>(ipcRequestId, "crewQuestion", {
        type: "crewQuestion",
        ipcRequestId,
        question,
      });
    },
    onCrewTurnReview: async (
      turn: ForemanTurnReviewInput,
    ): Promise<ForemanTurnDecision> => {
      const ipcRequestId = randomUUID();
      return awaitParentReply<ForemanTurnDecision>(ipcRequestId, "crewTurnReview", {
        type: "crewTurnReview",
        ipcRequestId,
        turn,
      });
    },
  };
}

function toContext(payload: CtxPayload): ExecutorContext {
  return {
    ...payload,
    callbacks: buildCallbacks(),
  };
}

function resolvePending(msg: InMsg): void {
  if (msg.type === "crewQuestionReply") {
    const pending = pendingReplies.get(msg.ipcRequestId);
    pendingReplies.delete(msg.ipcRequestId);
    if (pending?.kind === "crewQuestion") {
      pending.resolve(msg.directive);
    }
    return;
  }
  if (msg.type === "crewTurnReviewReply") {
    const pending = pendingReplies.get(msg.ipcRequestId);
    pendingReplies.delete(msg.ipcRequestId);
    if (pending?.kind === "crewTurnReview") {
      pending.resolve(msg.decision);
    }
    return;
  }
  if (msg.type === "crewCallbackError") {
    const pending = pendingReplies.get(msg.ipcRequestId);
    pendingReplies.delete(msg.ipcRequestId);
    if (pending) {
      pending.reject(new Error(msg.message));
    }
  }
}

process.on("message", (msg: InMsg) => {
  if (
    msg.type === "crewQuestionReply" ||
    msg.type === "crewTurnReviewReply" ||
    msg.type === "crewCallbackError"
  ) {
    resolvePending(msg);
    return;
  }

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
