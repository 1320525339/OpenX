/**
 * pkg 桌面包主进程用 Pi 桩：避免 pi-ai / pi-coding-agent 的 dynamic import 在 snapshot 中崩溃。
 * 实际 Pi 执行由 pi-child-runner.cjs 子进程承担（见 pi-isolated-run.ts）。
 */
import type { ExecutorAdapter } from "@openx/executor-core";
import { EXECUTOR_AUTO } from "@openx/shared";
import { cancelPiChild, runPiInWorker, shouldRunPiInWorker } from "./pi-isolated-run.js";

export type ExecutorCandidate = {
  id: string;
  label: string;
  hint?: string;
  available: boolean;
};

export type PickExecutorInput = {
  title: string;
  acceptance: string;
  executionPrompt: string;
  workspaceRoot: string;
  candidates: ExecutorCandidate[];
  settings: {
    pi?: { runTimeoutMs?: number; noSession?: boolean };
    model?: unknown;
    providers?: unknown;
  };
  llmContextSettings?: unknown;
};

function fallbackExecutor(candidates: ExecutorCandidate[]): string {
  const available = candidates.filter((c) => c.available && c.id !== EXECUTOR_AUTO);
  const pi = available.find((c) => c.id === "pi");
  if (pi) return "pi";
  return available[0]?.id ?? "pi";
}

/** auto 路由：sidecar 主进程不做 Pi LLM 选型，走启发式 fallback */
export async function pickExecutorWithPi(input: PickExecutorInput): Promise<string> {
  const available = input.candidates.filter((c) => c.available && c.id !== EXECUTOR_AUTO);
  if (available.length === 0) return "pi";
  if (available.length === 1) return available[0]!.id;
  return fallbackExecutor(input.candidates);
}

export const piExecutor: ExecutorAdapter = {
  id: "pi",
  displayName: "Pi 施工队（工头班底）",
  executionModel: "push",
  matchExecutorId: (goalExecutorId) => goalExecutorId === "pi",

  async detect() {
    return {
      available: true,
      hint: "Pi（sidecar 子进程）",
    };
  },

  async run(ctx) {
    if (!shouldRunPiInWorker()) {
      throw new Error("Pi sidecar 需 OPENX_PI_WORKER=1");
    }
    await runPiInWorker(ctx);
  },

  cancel(goalId) {
    cancelPiChild(goalId);
  },
};
