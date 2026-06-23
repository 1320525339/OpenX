import { spawn, type ChildProcess } from "node:child_process";

import { Readable, Writable } from "node:stream";

import { dirname, join } from "node:path";

import { fileURLToPath } from "node:url";

import {
  type Client,
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
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
  dispositionForemanManagedLoop,
  runCrewDialogueLoop,
  type ExecutorAdapter,
  type ExecutorContext,
  type ExecutorDetectEntry,
  type ForemanManagedLoopResult,
  type RunEventEmitter,
} from "@openx/executor-core";
import {
  CREW_FOREMAN_PROMPT_APPENDIX,
  buildAcpCrewSessionKey,
} from "@openx/shared";
import { handleAcpSessionUpdate, type AcpSessionState } from "./session-updates.js";
import { acpSpawnOptions } from "./spawn-win.js";
import {
  parseStoredAcpSessionId,
  resolvePermissionViaForeman,
} from "./acp-crew.js";
import {
  buildCodexAcpSpawnArgs,
  buildCodexAcpSpawnEnv,
} from "./codex-spawn.js";

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
  state: AcpSessionState,
  run: RunEventEmitter | null,
  workspaceRoot: string,
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
        workspaceRoot,
      });
    },
    async requestPermission(params) {
      const outcome = await resolvePermissionViaForeman(params, callbacks);
      return { outcome };
    },
  };
}

async function finalizeAcpForemanLoop(
  loop: ForemanManagedLoopResult,
  callbacks: ExecutorContext["callbacks"],
  runtimeId: AcpRuntimeId,
): Promise<"complete" | "parked" | "failed"> {
  const disposition = dispositionForemanManagedLoop(loop);

  if (disposition.action === "tool_budget_exceeded") {
    await callbacks.onFail(`ACP 工具调用达到上限（${runtimeId}）`);
    return "failed";
  }
  if (disposition.action === "failed") {
    await callbacks.onFail(disposition.message);
    return "failed";
  }
  if (disposition.action === "dialogue_exhausted") {
    await callbacks.onFail("工头编排循环达到轮次上限，任务未完成");
    return "failed";
  }
  if (disposition.action === "awaiting_user") {
    await callbacks.onProgress(95, "等待开发商决策…");
    if (callbacks.onParkAwaitingUser) {
      await callbacks.onParkAwaitingUser(loop.summary);
    }
    return "parked";
  }

  await callbacks.onProgress(100, "ACP 完成");
  await callbacks.onComplete(
    loop.summary,
    loop.deliverables.length > 0 ? loop.deliverables : undefined,
  );
  return "complete";
}

async function runAcpTurn(
  ctx: ExecutorContext,
  runtimeId: AcpRuntimeId,
  opts?: { resumeSessionId?: string; steer?: boolean },
): Promise<{
  loop: ForemanManagedLoopResult;
  sessionId: string;
}> {
  const { goal, callbacks, workspaceRoot } = ctx;
  const spawnCfg = resolveAcpSpawn(runtimeId);
  const continuation = ctx.crewContinuationPrompt?.trim();
  const promptText = continuation
    ? continuation
    : [
        buildExecutionPrompt(goal, ctx.priorLogs ?? [], ctx.enabledSkills, {
          isRework: ctx.isRework,
          priorSummaries: ctx.priorSummaries,
          priorReviewRounds: ctx.priorReviewRounds,
          agentRole: ctx.agentRole,
          workspaceRoot: ctx.workspaceRoot,
          llmContext: ctx.llmContext,
          projectKnowledge: (ctx as { projectKnowledge?: string }).projectKnowledge,
        }),
        CREW_FOREMAN_PROMPT_APPENDIX,
      ].join("\n\n");
  const mcpServers = ctx.mcpServers ?? [];
  const spawnCreds =
    runtimeId === "acp:codex" &&
    ctx.spawnEnv?.OPENAI_API_KEY &&
    ctx.spawnEnv.OPENAI_BASE_URL &&
    ctx.spawnEnv.OPENAI_MODEL
      ? {
          apiKey: ctx.spawnEnv.OPENAI_API_KEY,
          baseUrl: ctx.spawnEnv.OPENAI_BASE_URL,
          model: ctx.spawnEnv.OPENAI_MODEL,
        }
      : runtimeId === "acp:claude" &&
          ctx.spawnEnv?.ANTHROPIC_MODEL &&
          (ctx.spawnEnv.ANTHROPIC_API_KEY || ctx.spawnEnv.ANTHROPIC_AUTH_TOKEN) &&
          ctx.spawnEnv.ANTHROPIC_BASE_URL
        ? {
            apiKey:
              ctx.spawnEnv.ANTHROPIC_AUTH_TOKEN ??
              ctx.spawnEnv.ANTHROPIC_API_KEY ??
              "",
            baseUrl: ctx.spawnEnv.ANTHROPIC_BASE_URL,
            model: ctx.spawnEnv.ANTHROPIC_MODEL,
          }
        : null;

  const extraArgs =
    runtimeId === "acp:codex" && spawnCreds ? buildCodexAcpSpawnArgs(spawnCreds) : [];

  const procEnv =
    runtimeId === "acp:codex" && spawnCreds
      ? { ...process.env, ...ctx.spawnEnv, ...buildCodexAcpSpawnEnv(spawnCreds) }
      : runtimeId === "acp:claude" && ctx.spawnEnv
        ? { ...process.env, ...ctx.spawnEnv }
        : ctx.spawnEnv
          ? { ...process.env, ...ctx.spawnEnv }
          : undefined;

  const state: AcpSessionState = {
    assistantText: "",
    toolCount: 0,
    toolNames: new Map<string, string>(),
    pendingTools: new Map(),
    deliverables: [],
  };
  const run = createRunEmitter(ctx);

  const proc = spawn(
    spawnCfg.command,
    [...spawnCfg.args, ...extraArgs],
    acpSpawnOptions({
      cwd: workspaceRoot,
      stdio: ["pipe", "pipe", "pipe"],
      forceShell: process.env.OPENX_ACP_MOCK === "1" ? false : undefined,
      env: procEnv,
    }),
  );
  activeRuns.set(goal.id, { proc, abortSent: false });

  proc.stderr?.on("data", (buf: Buffer) => {
    const line = buf.toString().trim().slice(0, 240);
    if (line) void callbacks.onLog("debug", `[${runtimeId}] ${line}`);
  });

  const client = buildSessionClient(runtimeId, callbacks, state, run, workspaceRoot);
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
    const resumeId =
      opts?.resumeSessionId ?? parseStoredAcpSessionId(goal.crewSessionId, runtimeId);

    if (resumeId) {
      sessionId = resumeId;
      await conn.loadSession({ sessionId, cwd: workspaceRoot, mcpServers });
      await callbacks.onProgress(22, "ACP 会话已恢复");
      await callbacks.onLog("info", `[${runtimeId}] loadSession 续跑 ${sessionId}`);
    } else {
      const opened = await conn.newSession({ cwd: workspaceRoot, mcpServers });
      sessionId = opened.sessionId;
      await callbacks.onProgress(22, "ACP 会话已创建");
      const crewKey = buildAcpCrewSessionKey(goal.id, runtimeId);
      await callbacks.onCrewSession?.(`${runtimeId}:${sessionId}`);
      await callbacks.onLog("info", `[${runtimeId}] crewSession ${crewKey} → ${sessionId}`);
    }

    const runOnePrompt = async (prompt: string) => {
      const resp = await conn.prompt({
        sessionId,
        prompt: [{ type: "text", text: prompt }],
      });
      return resp;
    };

    const loop = await runCrewDialogueLoop(
      { conn, sessionId, state },
      promptText,
      ctx,
      async (_handle, followPrompt) => {
        state.assistantText = "";
        const resp = await runOnePrompt(followPrompt);
        return {
          summary:
            state.assistantText.trim() ||
            `ACP 任务完成（${runtimeId}，stopReason=${resp.stopReason ?? "unknown"}）`,
          assistantText: state.assistantText,
          park: true,
          toolBudgetExceeded: false,
          deliverables: state.deliverables,
        };
      },
      { initialSteer: Boolean(opts?.steer && resumeId), logTag: runtimeId },
    );
    return {
      loop,
      sessionId,
    };
  } finally {
    await run?.finish();
    activeRuns.delete(goal.id);
    await terminateProcess(proc);
  }
}

async function runAcpGoal(ctx: ExecutorContext, runtimeId: AcpRuntimeId): Promise<void> {
  const parked = parkedSessions.get(ctx.goal.id);
  const hasContinuation = Boolean(ctx.crewContinuationPrompt?.trim());
  const resumeSteer =
    (ctx.isRework || hasContinuation) &&
    parked?.runtimeId === runtimeId &&
    Boolean(parked.sessionId);
  if (!resumeSteer) {
    parkedSessions.delete(ctx.goal.id);
  }
  const { callbacks } = ctx;
  try {
    if (resumeSteer && parked) {
      await callbacks.onLog(
        "info",
        hasContinuation
          ? `[${runtimeId}] 开发商确认后续跑`
          : `[${runtimeId}] 返工续跑：loadSession + steer（保留 ACP 上下文）`,
      );
    }
    const storedSession = parseStoredAcpSessionId(ctx.goal.crewSessionId, runtimeId);
    const { loop, sessionId } = await runAcpTurn(
      ctx,
      runtimeId,
      resumeSteer && parked
        ? { resumeSessionId: parked.sessionId, steer: true }
        : storedSession
          ? { resumeSessionId: storedSession, steer: Boolean(ctx.isRework) }
          : undefined,
    );
    const outcome = await finalizeAcpForemanLoop(loop, callbacks, runtimeId);
    if (outcome === "failed") {
      return;
    }
    parkedSessions.set(ctx.goal.id, { sessionId, runtimeId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await callbacks.onFail(message);
  }
}

export async function detectAcpRuntime(
  runtimeId: AcpRuntimeId,
): Promise<{ available: boolean; hint?: string }> {
  const cfg = ACP_RUNTIMES[runtimeId];
  const probeArgs = [...cfg.args, "--help"];
  return new Promise((resolve) => {
    const proc = spawn(
      cfg.command,
      probeArgs,
      acpSpawnOptions({ stdio: "ignore", forceShell: true }),
    );
    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      resolve({ available: false, hint: `${cfg.label} 检测超时` });
    }, 45_000);
    proc.on("error", () => {
      clearTimeout(timer);
      resolve({ available: false, hint: `${cfg.label} 未安装（${cfg.command}）` });
    });
    proc.on("exit", (code) => {
      clearTimeout(timer);
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
  displayName: "外部 CLI 施工队",
  executionModel: "push",
  matchExecutorId: (goalExecutorId) => goalExecutorId.startsWith("acp:"),

  async detect() {
    return { available: true, hint: "按 acp:* runtime 单独检测" };
  },

  async detectEntries() {
    const entries: ExecutorDetectEntry[] = [];
    for (const runtimeId of Object.keys(ACP_RUNTIMES) as AcpRuntimeId[]) {
      const cfg = ACP_RUNTIMES[runtimeId];
      const det = await detectAcpRuntime(runtimeId);
      entries.push({ id: runtimeId, displayName: cfg.label, ...det });
    }
    return entries;
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
      const { loop, sessionId } = await runAcpTurn(ctx, runtimeId, {
        resumeSessionId: parked.sessionId,
        steer: true,
      });
      const outcome = await finalizeAcpForemanLoop(loop, callbacks, runtimeId);
      if (outcome !== "failed") {
        parkedSessions.set(ctx.goal.id, { sessionId, runtimeId });
      } else {
        parkedSessions.delete(ctx.goal.id);
      }
      return outcome !== "failed";
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
