/**
 * 在子进程中运行 Pi，避免 session.prompt() 阻塞主进程事件循环。
 * 设置 OPENX_PI_WORKER=1 启用（默认关闭；Mock 测试仍走主进程）。
 * park 后子进程保活，由 resumePiChild 续跑。
 */
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { GoalDeliverable } from "@openx/shared";
import type { ExecutorContext } from "@openx/executor-core";

declare global {
  namespace NodeJS {
    interface Process {
      pkg?: unknown;
    }
  }
}

type ChildOutMsg =
  | { type: "progress"; progress: number; message?: string }
  | { type: "log"; level: string; message: string }
  | { type: "runEvent"; event: unknown }
  | { type: "complete"; summary: string; deliverables?: GoalDeliverable[] }
  | { type: "fail"; message: string }
  | { type: "park"; checkpointSummary: string }
  | { type: "error"; message: string };

function childScriptPath(): string {
  if (process.pkg) {
    return join(dirname(process.execPath), "pi-child-runner.cjs");
  }
  return join(dirname(fileURLToPath(import.meta.url)), "pi-child-runner.ts");
}

function forkExecArgv(): string[] {
  return process.pkg ? [] : ["--import", "tsx"];
}

function serializeCtxPayload(ctx: ExecutorContext) {
  return {
    goal: ctx.goal,
    workspaceRoot: ctx.workspaceRoot,
    settings: ctx.settings,
    priorLogs: ctx.priorLogs,
    priorSummaries: ctx.priorSummaries,
    priorReviewRounds: ctx.priorReviewRounds,
    isRework: ctx.isRework,
    enabledSkills: ctx.enabledSkills,
    mcpServers: ctx.mcpServers,
    agentRole: ctx.agentRole,
    llmContext: ctx.llmContext,
    projectKnowledge: ctx.projectKnowledge,
    crewContinuationPrompt: ctx.crewContinuationPrompt,
  };
}

const activeChildren = new Map<string, ChildProcess>();
const parkedChildren = new Map<string, ChildProcess>();

export function hasParkedPiChild(goalId: string): boolean {
  return parkedChildren.has(goalId);
}

export function cancelPiChild(goalId: string): void {
  for (const map of [activeChildren, parkedChildren]) {
    const child = map.get(goalId);
    if (!child) continue;
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    map.delete(goalId);
  }
}

export function shouldRunPiInWorker(): boolean {
  return process.env.OPENX_PI_WORKER === "1" && process.env.OPENX_MOCK_PI !== "1";
}

function attachChildHandlers(
  goalId: string,
  child: ChildProcess,
  ctx: ExecutorContext,
  settle: {
    resolve: () => void;
    reject: (err: Error) => void;
    /** park 时 resolve 但不杀进程 */
    onPark?: () => void;
  },
): void {
  let settled = false;
  const finish = (err?: Error, opts?: { kill?: boolean }) => {
    if (settled) return;
    settled = true;
    activeChildren.delete(goalId);
    if (opts?.kill !== false) {
      parkedChildren.delete(goalId);
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }
    if (err) settle.reject(err);
    else settle.resolve();
  };

  child.on("message", (raw: ChildOutMsg) => {
    void (async () => {
      try {
        switch (raw.type) {
          case "progress":
            await ctx.callbacks.onProgress(raw.progress, raw.message);
            break;
          case "log":
            await ctx.callbacks.onLog(
              raw.level as "info" | "warn" | "error" | "debug",
              raw.message,
            );
            break;
          case "runEvent":
            if (ctx.callbacks.onRunEvent) {
              await ctx.callbacks.onRunEvent(raw.event as never);
            }
            break;
          case "park":
            activeChildren.delete(goalId);
            parkedChildren.set(goalId, child);
            if (ctx.callbacks.onParkAwaitingUser) {
              await ctx.callbacks.onParkAwaitingUser(raw.checkpointSummary);
            }
            settle.onPark?.();
            finish(undefined, { kill: false });
            break;
          case "complete":
            parkedChildren.delete(goalId);
            await ctx.callbacks.onComplete(raw.summary, raw.deliverables);
            finish();
            break;
          case "fail":
            parkedChildren.delete(goalId);
            await ctx.callbacks.onFail(raw.message);
            finish();
            break;
          case "error":
            parkedChildren.delete(goalId);
            finish(new Error(raw.message));
            break;
        }
      } catch (err) {
        finish(err instanceof Error ? err : new Error(String(err)));
      }
    })();
  });

  child.on("error", (err) => finish(err));
  child.on("exit", (code) => {
    activeChildren.delete(goalId);
    const wasParked = parkedChildren.delete(goalId);
    if (!settled && !wasParked && code !== 0 && code !== null) {
      finish(new Error(`Pi 子进程异常退出（code ${code}）`));
    } else if (!settled && !wasParked) {
      finish();
    }
  });
}

export function runPiInWorker(ctx: ExecutorContext): Promise<void> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = fork(childScriptPath(), [], {
        execArgv: forkExecArgv(),
        stdio: ["pipe", "pipe", "inherit", "ipc"],
        env: { ...process.env, OPENX_PI_CHILD: "1" },
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    attachChildHandlers(ctx.goal.id, child, ctx, { resolve, reject });
    activeChildren.set(ctx.goal.id, child);

    child.send({
      type: "run",
      payload: serializeCtxPayload(ctx),
    });
  });
}

/** 向已 park 的 Pi 子进程发送续跑指令（含权限提升后的 goal） */
export function resumePiChild(ctx: ExecutorContext): Promise<boolean> {
  const child = parkedChildren.get(ctx.goal.id);
  if (!child || !child.connected) {
    parkedChildren.delete(ctx.goal.id);
    return Promise.resolve(false);
  }

  return new Promise((resolve, reject) => {
    parkedChildren.delete(ctx.goal.id);
    activeChildren.set(ctx.goal.id, child);

    child.removeAllListeners("message");
    child.removeAllListeners("error");
    child.removeAllListeners("exit");

    attachChildHandlers(ctx.goal.id, child, ctx, {
      resolve: () => resolve(true),
      reject,
      onPark: () => resolve(true),
    });

    child.send({
      type: "resume",
      payload: serializeCtxPayload(ctx),
    });
  });
}
