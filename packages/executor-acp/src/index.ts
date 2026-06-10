import { spawn, type ChildProcess } from "node:child_process";

import { Readable, Writable } from "node:stream";

import { dirname, join } from "node:path";

import { fileURLToPath } from "node:url";

import {
  type Client,
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from "@agentclientprotocol/sdk";

import {
  ACP_RUNTIMES,
  type AcpRuntimeId,
  parseAcpRuntimeId,
} from "@openx/shared";

import {
  buildExecutionPrompt,
  createRunEmitter,
  type ExecutorAdapter,
  type ExecutorContext,
  type RunEventEmitter,
} from "@openx/executor-core";
import { handleAcpSessionUpdate } from "./session-updates.js";
import { acpSpawnOptions } from "./spawn-win.js";

type ActiveRun = {
  proc: ChildProcess;
  abortSent: boolean;
};

type ParkedSession = {
  sessionId: string;
  runtimeId: AcpRuntimeId;
};

const activeRuns = new Map<string, ActiveRun>();
const parkedSessions = new Map<string, ParkedSession>();

const MOCK_AGENT_PATH = join(dirname(fileURLToPath(import.meta.url)), "mock-agent.js");

function resolveAcpSpawn(runtimeId: AcpRuntimeId) {
  const config = ACP_RUNTIMES[runtimeId];
  if (process.env.OPENX_ACP_MOCK === "1") {
    return {
      command: process.execPath,
      args: [MOCK_AGENT_PATH],
      label: `Mock ACP (${config.label})`,
    };
  }
  return {
    command: config.command,
    args: [...config.args],
    label: config.label,
  };
}

function autoApprove(
  params: RequestPermissionRequest,
): RequestPermissionResponse["outcome"] {
  const allow =
    params.options.find((o) => o.kind === "allow_once") ??
    params.options.find((o) => o.kind === "allow_always");
  if (allow) return { outcome: "selected", optionId: allow.optionId };
  return { outcome: "cancelled" };
}

async function terminateProcess(proc: ChildProcess): Promise<void> {
  if (proc.exitCode !== null || proc.killed) return;
  proc.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve();
    }, 3000);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function buildSessionClient(
  runtimeId: AcpRuntimeId,
  callbacks: ExecutorContext["callbacks"],
  state: { assistantText: string; toolCount: number; toolNames: Map<string, string> },
  run: RunEventEmitter | null,
): Client {
  return {
    async writeTextFile() {
      throw new Error("fs.write_text_file not supported");
    },
    async readTextFile() {
      throw new Error("fs.read_text_file not supported");
    },
    async createTerminal() {
      throw new Error("terminal.create not supported");
    },
    async killTerminal() {
      throw new Error("terminal.kill not supported");
    },
    async terminalOutput() {
      throw new Error("terminal.output not supported");
    },
    async waitForTerminalExit() {
      throw new Error("terminal.wait_for_exit not supported");
    },
    async releaseTerminal() {
      throw new Error("terminal.release not supported");
    },
    async sessionUpdate(params: SessionNotification) {
      await handleAcpSessionUpdate(runtimeId, params.update, {
        callbacks,
        state,
        run,
      });
    },
    async requestPermission(params) {
      return { outcome: autoApprove(params) };
    },
  };
}

async function runAcpTurn(
  ctx: ExecutorContext,
  runtimeId: AcpRuntimeId,
  opts?: { resumeSessionId?: string; steer?: boolean },
): Promise<{ summary: string; sessionId: string }> {
  const { goal, callbacks, workspaceRoot } = ctx;
  const spawnCfg = resolveAcpSpawn(runtimeId);
  const promptText = buildExecutionPrompt(goal, ctx.priorLogs ?? [], ctx.enabledSkills, {
    isRework: ctx.isRework,
    priorSummaries: ctx.priorSummaries,
  });
  const state = { assistantText: "", toolCount: 0, toolNames: new Map<string, string>() };
  const run = createRunEmitter(ctx);

  const proc = spawn(
    spawnCfg.command,
    spawnCfg.args,
    acpSpawnOptions({
      cwd: workspaceRoot,
      stdio: ["pipe", "pipe", "pipe"],
      forceShell: process.env.OPENX_ACP_MOCK === "1" ? false : undefined,
    }),
  );
  activeRuns.set(goal.id, { proc, abortSent: false });

  proc.stderr?.on("data", (buf: Buffer) => {
    const line = buf.toString().trim().slice(0, 240);
    if (line) void callbacks.onLog("debug", `[${runtimeId}] ${line}`);
  });

  const client = buildSessionClient(runtimeId, callbacks, state, run);
  const input = Writable.toWeb(proc.stdin!);
  const output = Readable.toWeb(proc.stdout!) as ReadableStream<Uint8Array>;
  const conn = new ClientSideConnection(() => client, ndJsonStream(input, output));

  try {
    if (opts?.steer && opts.resumeSessionId) {
      await callbacks.onLog("info", `[${runtimeId}] 返工 steer：loadSession 续跑`);
    } else {
      await callbacks.onLog(
        "info",
        `[${runtimeId}] 启动 ${spawnCfg.command} ${spawnCfg.args.join(" ")}`,
      );
    }
    await callbacks.onProgress(8, `初始化 ${spawnCfg.label}…`);
    await run?.status(`初始化 ${spawnCfg.label}…`);
    await conn.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} });

    let sessionId: string;
    if (opts?.resumeSessionId) {
      sessionId = opts.resumeSessionId;
      await conn.loadSession({ sessionId, cwd: workspaceRoot, mcpServers: [] });
      await callbacks.onProgress(22, "ACP 会话已恢复");
    } else {
      const opened = await conn.newSession({ cwd: workspaceRoot, mcpServers: [] });
      sessionId = opened.sessionId;
      await callbacks.onProgress(22, "ACP 会话已创建");
    }

    const resp = await conn.prompt({
      sessionId,
      prompt: [{ type: "text", text: promptText }],
    });
    const summary =
      state.assistantText.trim() ||
      `ACP 任务完成（${runtimeId}，stopReason=${resp.stopReason ?? "unknown"}）`;
    return { summary, sessionId };
  } finally {
    await run?.finish();
    activeRuns.delete(goal.id);
    await terminateProcess(proc);
  }
}

async function runAcpGoal(ctx: ExecutorContext, runtimeId: AcpRuntimeId): Promise<void> {
  parkedSessions.delete(ctx.goal.id);
  const { callbacks } = ctx;
  try {
    const turn = await runAcpTurn(ctx, runtimeId);
    await callbacks.onProgress(100, "ACP 完成");
    await callbacks.onComplete(turn.summary);
    parkedSessions.set(ctx.goal.id, { sessionId: turn.sessionId, runtimeId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await callbacks.onFail(message);
  }
}

export async function detectAcpRuntime(
  runtimeId: AcpRuntimeId,
): Promise<{ available: boolean; hint?: string }> {
  const cfg = ACP_RUNTIMES[runtimeId];
  return new Promise((resolve) => {
    const proc = spawn(cfg.command, ["--version"], acpSpawnOptions({ stdio: "ignore", forceShell: true }));
    proc.on("error", () => {
      resolve({ available: false, hint: `${cfg.label} 未安装（${cfg.command}）` });
    });
    proc.on("exit", (code) => {
      resolve(
        code === 0
          ? { available: true }
          : { available: false, hint: `${cfg.label} 不可用（exit ${code}）` },
      );
    });
  });
}

export const acpExecutor: ExecutorAdapter = {
  id: "acp",
  displayName: "ACP CLI 执行器",

  async detect() {
    return { available: true, hint: "按 acp:* runtime 单独检测" };
  },

  async run(ctx: ExecutorContext) {
    const runtimeId = parseAcpRuntimeId(ctx.goal.executorId);
    if (!runtimeId) {
      await ctx.callbacks.onFail(`未知 ACP runtime：${ctx.goal.executorId}`);
      return;
    }
    await runAcpGoal(ctx, runtimeId);
  },

  async steerRework(ctx: ExecutorContext) {
    const parked = parkedSessions.get(ctx.goal.id);
    if (!parked) return false;
    const runtimeId = parseAcpRuntimeId(ctx.goal.executorId);
    if (!runtimeId || parked.runtimeId !== runtimeId) return false;

    const { callbacks } = ctx;
    await callbacks.onProgress(5, "ACP 返工 steer…");
    try {
      const turn = await runAcpTurn(ctx, runtimeId, {
        resumeSessionId: parked.sessionId,
        steer: true,
      });
      await callbacks.onProgress(100, "ACP 返工完成");
      await callbacks.onComplete(turn.summary);
      parkedSessions.set(ctx.goal.id, { sessionId: turn.sessionId, runtimeId });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await callbacks.onFail(message);
      parkedSessions.delete(ctx.goal.id);
      return false;
    }
  },

  cancel(goalId: string) {
    parkedSessions.delete(goalId);
    const run = activeRuns.get(goalId);
    if (!run) return;
    void terminateProcess(run.proc);
    activeRuns.delete(goalId);
  },
};

/** @internal 测试用 */
export function _clearAcpRunsForTest() {
  parkedSessions.clear();
  for (const [id, run] of activeRuns) {
    void terminateProcess(run.proc);
    activeRuns.delete(id);
  }
}

export function hasParkedAcpSession(goalId: string): boolean {
  return parkedSessions.has(goalId);
}
