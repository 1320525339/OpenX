/**
 * 在子进程中运行 Pi，避免 session.prompt() 阻塞主进程事件循环。
 * 设置 OPENX_PI_WORKER=1 启用（默认关闭；Mock 测试仍走主进程）。
 */
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { GoalDeliverable } from "@openx/shared";
import type { ExecutorContext } from "@openx/executor-core";

type ChildOutMsg =
  | { type: "progress"; progress: number; message?: string }
  | { type: "log"; level: string; message: string }
  | { type: "runEvent"; event: unknown }
  | { type: "complete"; summary: string; deliverables?: GoalDeliverable[] }
  | { type: "fail"; message: string }
  | { type: "error"; message: string };

function childScriptPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "pi-child-runner.ts");
}

const activeChildren = new Map<string, ChildProcess>();

export function cancelPiChild(goalId: string): void {
  const child = activeChildren.get(goalId);
  if (!child) return;
  try {
    child.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  activeChildren.delete(goalId);
}

export function shouldRunPiInWorker(): boolean {
  return process.env.OPENX_PI_WORKER === "1" && process.env.OPENX_MOCK_PI !== "1";
}

export function runPiInWorker(ctx: ExecutorContext): Promise<void> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = fork(childScriptPath(), [], {
        execArgv: ["--import", "tsx"],
        stdio: ["pipe", "pipe", "inherit", "ipc"],
        env: { ...process.env, OPENX_PI_CHILD: "1" },
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      if (err) reject(err);
      else resolve();
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
            case "complete":
              await ctx.callbacks.onComplete(raw.summary, raw.deliverables);
              finish();
              break;
            case "fail":
              await ctx.callbacks.onFail(raw.message);
              finish();
              break;
            case "error":
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
      activeChildren.delete(ctx.goal.id);
      if (!settled && code !== 0) {
        finish(new Error(`Pi 子进程异常退出（code ${code ?? "null"}）`));
      }
    });

    activeChildren.set(ctx.goal.id, child);

    child.send({
      type: "run",
      payload: {
        goal: ctx.goal,
        workspaceRoot: ctx.workspaceRoot,
        settings: ctx.settings,
        priorLogs: ctx.priorLogs,
        priorSummaries: ctx.priorSummaries,
        priorReviewRounds: ctx.priorReviewRounds,
        isRework: ctx.isRework,
        enabledSkills: ctx.enabledSkills,
      },
    });
  });
}
