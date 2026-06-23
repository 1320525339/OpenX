import { mkdirSync } from "node:fs";

import { join } from "node:path";

import { homedir } from "node:os";

import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";

import {

  VERSION,

  createAgentSession,

  SessionManager,

} from "@earendil-works/pi-coding-agent";

import { DEFAULT_PI_MAX_TOOL_CALLS, type PiExecutorSettings } from "@openx/shared";
import {
  CREW_FOREMAN_PROMPT_APPENDIX,
  buildPiCrewSessionId,
} from "@openx/shared";

import {
  buildExecutionPrompt,
  createRunEmitter,
  dispositionForemanManagedLoop,
  extractDeliverableFromTool,
  extractPathFromToolArgs,
  inferFileAction,
  mergeDeliverable,
  readWorkspaceFileBaseline,
  toolFileDiffFromDeliverable,
  type ExecutorAdapter,
  type ExecutorContext,
  type ForemanManagedLoopResult,
  type RunEventEmitter,
} from "@openx/executor-core";
import { languageFromPath, parseDeliverablesFromSummary, type GoalDeliverable } from "@openx/shared";

import { createPiModelRegistry, resolvePiModel } from "./model.js";

import { describePiModelRef, mergePiSettingsFromModel } from "./pi-bridge.js";
import { createOpenxResourceLoader } from "./pi-resource-loader.js";

import { summarizePiRun } from "./summary.js";
import { runPiCrewDialogueLoop } from "./crew-loop.js";



type ActiveRun = {

  session: AgentSession;

  abortSent: boolean;

};



type ParkedRun = {

  session: AgentSession;

};



const activeRuns = new Map<string, ActiveRun>();

const parkedRuns = new Map<string, ParkedRun>();



function resolvePiSettings(ctx: ExecutorContext): PiExecutorSettings {

  const base =

    ctx.settings.pi ?? {

      runTimeoutMs: 600_000,

      noSession: true,

    };

  return mergePiSettingsFromModel(base, {

    model: ctx.settings.model,

    providers: ctx.settings.providers,

  });

}



function defaultSessionDir(): string {

  const base = process.env.OPENX_DATA_DIR?.trim() || join(homedir(), ".openx");

  const dir = join(base, "pi-sessions");

  mkdirSync(dir, { recursive: true });

  return dir;

}



function buildSessionManager(pi: PiExecutorSettings, workspaceRoot: string): SessionManager {

  if (pi.noSession !== false) {

    return SessionManager.inMemory(workspaceRoot);

  }

  if (pi.sessionDir?.trim()) {

    return SessionManager.create(workspaceRoot, pi.sessionDir.trim());

  }

  return SessionManager.create(workspaceRoot, defaultSessionDir());

}



type ContentBlock = { type?: string; text?: string };

function extractContentText(payload: unknown): string | undefined {
  const partial = payload as { content?: ContentBlock[] } | undefined;
  const text = partial?.content
    ?.map((c) => (c.type === "text" ? c.text ?? "" : ""))
    .join("")
    .trim();
  return text || undefined;
}



type TurnState = {
  assistantText: string;
  toolCount: number;
  lastAgentEnd?: Record<string, unknown>;
  lastProgressAt: number;
  lastProgressPct: number;
  toolBudgetExceeded: boolean;
  deliverables: GoalDeliverable[];
  pendingTools: Map<
    string,
    { tool: string; path?: string; previousContent?: string; args?: unknown }
  >;
};

const PROGRESS_THROTTLE_MS = 2_500;

function resolveMaxToolCalls(pi: PiExecutorSettings): number {
  const env = process.env.OPENX_PI_MAX_TOOLS;
  if (env?.trim()) {
    const n = Number.parseInt(env, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return pi.maxToolCalls ?? DEFAULT_PI_MAX_TOOL_CALLS;
}

async function handlePiEvent(
  evt: AgentSessionEvent,
  ctx: {
    callbacks: ExecutorContext["callbacks"];
    state: TurnState;
    run: RunEventEmitter | null;
    session: AgentSession;
    maxToolCalls: number;
    workspaceRoot: string;
  },
): Promise<void> {
  const { callbacks, state, run, session, maxToolCalls, workspaceRoot } = ctx;

  if (evt.type === "agent_start") {
    await run?.status("Pi Agent 启动");
    await callbacks.onProgress(12, "Pi Agent 启动");
  }

  if (evt.type === "message_update") {
    const inner = evt.assistantMessageEvent;
    if (inner.type === "text_delta" && typeof inner.delta === "string") {
      state.assistantText += inner.delta;
      await run?.textDelta(inner.delta);
      const pct = Math.min(70, 20 + Math.floor(state.assistantText.length / 120));
      const now = Date.now();
      if (
        pct !== state.lastProgressPct ||
        now - state.lastProgressAt >= PROGRESS_THROTTLE_MS
      ) {
        state.lastProgressAt = now;
        state.lastProgressPct = pct;
        await callbacks.onProgress(pct, "Pi 生成中…");
      }
    }
    if (inner.type === "thinking_delta" && typeof inner.delta === "string") {
      await run?.thinkingDelta(inner.delta);
    }
    if (inner.type === "error") {
      await callbacks.onLog("error", `[pi] 流式错误：${String(inner.reason ?? "unknown")}`);
    }
  }

  if (evt.type === "tool_execution_start") {
    state.toolCount += 1;
    const tool = String(evt.toolName ?? "tool");
    const path = extractPathFromToolArgs(evt.args);
    const previousContent =
      path && workspaceRoot
        ? readWorkspaceFileBaseline(workspaceRoot, path)
        : undefined;
    if (evt.toolCallId) {
      state.pendingTools.set(evt.toolCallId, {
        tool,
        path,
        previousContent,
        args: evt.args,
      });
    }
    if (path) {
      mergeDeliverable(state.deliverables, {
        kind: "file",
        path,
        label: path.replace(/\\/g, "/").split("/").pop() ?? path,
        action: previousContent !== undefined ? "modified" : inferFileAction(tool),
        previousContent,
        language: languageFromPath(path),
      });
    }
    const argsPreview = evt.args ? JSON.stringify(evt.args).slice(0, 120) : "";
    await run?.toolStart(tool, argsPreview, evt.toolCallId);
    await callbacks.onLog("info", `[pi] 工具 #${state.toolCount}：${tool} ${argsPreview}`);
    await callbacks.onProgress(Math.min(88, 72 + state.toolCount * 3), `执行 ${tool}…`);

    if (state.toolCount >= maxToolCalls && !state.toolBudgetExceeded) {
      state.toolBudgetExceeded = true;
      await callbacks.onLog(
        "warn",
        `[pi] 工具调用已达上限（${maxToolCalls} 次），正在中止本轮…`,
      );
      void session.abort();
    }
  }



  if (evt.type === "tool_execution_update") {
    const text = extractContentText(evt.partialResult);
    if (text) {
      const tool = String(evt.toolName ?? "tool");
      await run?.toolUpdate(tool, evt.toolCallId, text.slice(-200));
      await callbacks.onLog("debug", `[pi] ${tool} › ${text.slice(-200)}`);
    }
  }



  if (evt.type === "tool_execution_end") {
    const tool = String(evt.toolName ?? "tool");
    const isError = evt.isError === true;
    const resultPreview = extractContentText(evt.result)?.slice(0, 160);
    const pending = evt.toolCallId
      ? state.pendingTools.get(evt.toolCallId)
      : undefined;
    if (evt.toolCallId) state.pendingTools.delete(evt.toolCallId);
    const item = extractDeliverableFromTool(
      tool,
      pending?.args ?? (pending?.path ? { path: pending.path } : undefined),
      evt.result,
      isError,
      { previousContent: pending?.previousContent },
    );
    if (item) mergeDeliverable(state.deliverables, item);
    const fileDiff = toolFileDiffFromDeliverable(item);
    await run?.toolEnd(tool, isError, evt.toolCallId, resultPreview, fileDiff);
    await callbacks.onLog(isError ? "warn" : "info", `[pi] 工具完成：${tool}`);
  }



  if (evt.type === "turn_end") {

    await run?.status("本轮收尾…");

    await callbacks.onProgress(92, "本轮收尾…");

  }

  if (evt.type === "compaction_start") {
    const reason =
      evt.reason === "overflow"
        ? "溢出"
        : evt.reason === "threshold"
          ? "阈值"
          : "手动";
    await run?.status(`上下文压缩中（${reason}）…`);
    await callbacks.onLog("info", `[pi] 上下文压缩开始（${reason}）`);
  }

  if (evt.type === "compaction_end") {
    if (evt.aborted) {
      await run?.status("上下文压缩已中止");
    } else if (evt.errorMessage) {
      await run?.status(`上下文压缩失败：${String(evt.errorMessage).slice(0, 80)}`);
    } else {
      await run?.status("上下文压缩完成");
    }
    if (evt.willRetry) {
      await run?.status("压缩后将重试…");
    }
    await callbacks.onLog(
      evt.errorMessage ? "warn" : "info",
      `[pi] 上下文压缩结束${evt.aborted ? "（已中止）" : ""}`,
    );
  }

  if (evt.type === "auto_retry_start") {
    await run?.status(
      `自动重试 ${evt.attempt}/${evt.maxAttempts}（${Math.round(evt.delayMs / 1000)}s 后）…`,
    );
    await callbacks.onLog(
      "warn",
      `[pi] 自动重试 ${evt.attempt}/${evt.maxAttempts}：${String(evt.errorMessage).slice(0, 120)}`,
    );
  }

  if (evt.type === "auto_retry_end") {
    if (evt.success) {
      await run?.status(`自动重试成功（第 ${evt.attempt} 次）`);
    } else {
      await run?.status(
        `自动重试失败：${String(evt.finalError ?? "未知错误").slice(0, 80)}`,
      );
    }
    await callbacks.onLog(
      evt.success ? "info" : "warn",
      `[pi] 自动重试结束：${evt.success ? "成功" : "失败"}`,
    );
  }

  if (evt.type === "agent_end") {

    state.lastAgentEnd = {

      type: "agent_end",

      messages: evt.messages,

      willRetry: evt.willRetry,

    };

    if (evt.willRetry) {
      await run?.status("Agent 将自动重试…");
    }

    await callbacks.onProgress(95, "Pi 收尾…");

  }

}



async function runSessionTurn(

  session: AgentSession,

  promptText: string,

  ctx: ExecutorContext,

  opts?: { steer?: boolean },

): Promise<{
  summary: string;
  assistantText: string;
  park: boolean;
  toolBudgetExceeded: boolean;
  deliverables: GoalDeliverable[];
}> {
  const { goal, callbacks, workspaceRoot } = ctx;
  const pi = resolvePiSettings(ctx);
  const timeoutMs = pi.runTimeoutMs ?? 600_000;
  const maxToolCalls = resolveMaxToolCalls(pi);
  const state: TurnState = {
    assistantText: "",
    toolCount: 0,
    lastProgressAt: 0,
    lastProgressPct: -1,
    toolBudgetExceeded: false,
    deliverables: [],
    pendingTools: new Map(),
  };

  let timedOut = false;

  const run = createRunEmitter(ctx);



  activeRuns.set(goal.id, { session, abortSent: false });



  const unsubscribe = session.subscribe((evt) => {
    handlePiEvent(evt, {
      callbacks,
      state,
      run,
      session,
      maxToolCalls,
      workspaceRoot,
    }).catch((err) => {
      // 捕获而非静默丢弃，避免 unhandled rejection 崩溃；
      // 事件流继续，不中断当前执行
      console.error("[pi] event handler error:", err);
    });
  });



  const timeoutHandle = setTimeout(() => {

    timedOut = true;

    void callbacks.onLog(

      "warn",

      `[pi] 运行超过 ${Math.round(timeoutMs / 1000)}s，正在中止…`,

    );

    void session.abort();

  }, timeoutMs);



  try {

    if (opts?.steer && session.isStreaming) {
      await session.steer(promptText);
    } else {
      await session.prompt(promptText);
    }

  } finally {

    clearTimeout(timeoutHandle);

    unsubscribe();

    await run?.finish();

    activeRuns.delete(goal.id);

  }



  const summary =
    summarizePiRun(
      state.lastAgentEnd ?? { type: "agent_end", messages: session.state.messages },
      state.assistantText,
      goal.title,
    ) +
    (state.toolBudgetExceeded
      ? `\n\n（工具调用已达上限 ${maxToolCalls} 次，已中止。请缩小任务范围、换执行器，或提高设置中的 maxToolCalls。）`
      : "") +
    (timedOut
      ? `\n\n（已超时 ${Math.round(timeoutMs / 1000)}s，请人工核对结果。）`
      : "");

  const fromSummary = parseDeliverablesFromSummary(summary);
  for (const item of fromSummary) {
    mergeDeliverable(state.deliverables, item);
  }

  return {
    summary,
    assistantText: state.assistantText,
    park: !timedOut && !state.toolBudgetExceeded,
    toolBudgetExceeded: state.toolBudgetExceeded,
    deliverables: state.deliverables,
  };
}



function parkSession(goalId: string, session: AgentSession) {

  parkedRuns.set(goalId, { session });

}

async function handlePiForemanLoopOutcome(
  crewResult: ForemanManagedLoopResult,
  callbacks: ExecutorContext["callbacks"],
  opts: {
    goalId: string;
    park: boolean;
    session?: AgentSession;
    toolBudgetFailMessage: string;
    completeLabel: string;
  },
): Promise<"complete" | "parked" | "failed"> {
  const { summary, park, deliverables } = crewResult;
  const disposition = dispositionForemanManagedLoop(crewResult);

  if (disposition.action === "tool_budget_exceeded") {
    await callbacks.onProgress(100, "Pi 已中止（工具上限）");
    await callbacks.onFail(opts.toolBudgetFailMessage);
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
    if (park && opts.session) {
      parkSession(opts.goalId, opts.session);
    }
    await callbacks.onProgress(95, "等待开发商决策…");
    if (callbacks.onParkAwaitingUser) {
      await callbacks.onParkAwaitingUser(summary);
    } else {
      await callbacks.onLog("warn", "[pi] 工头等待开发商，但 onParkAwaitingUser 未配置");
    }
    return "parked";
  }

  await callbacks.onProgress(100, opts.completeLabel);
  await callbacks.onComplete(summary, deliverables);
  if (park && opts.session) {
    parkSession(opts.goalId, opts.session);
  }
  return "complete";
}



function disposeParked(goalId: string) {

  const parked = parkedRuns.get(goalId);

  if (!parked) return;

  parkedRuns.delete(goalId);

  try {

    parked.session.dispose();

  } catch {

    /* ignore */

  }

}



export const piExecutor: ExecutorAdapter = {

  id: "pi",

  displayName: "Pi 施工队（工头班底）",

  executionModel: "push",

  matchExecutorId: (goalExecutorId) => goalExecutorId === "pi",



  async detect(settings) {

    try {

      const { modelRegistry } = await createPiModelRegistry({
        model: settings.model,
        providers: settings.providers,
      });

      const available = await modelRegistry.getAvailable();

      const pi = mergePiSettingsFromModel(

        settings.pi ?? { runTimeoutMs: 600_000, noSession: true },

        { model: settings.model, providers: settings.providers },

      );

      const resolved = await resolvePiModel(pi, modelRegistry);



      if (resolved.error) {

        return {

          available: false,

          hint: `Pi 内嵌底座 v${VERSION} · ${resolved.error}`,

        };

      }



      if (available.length === 0) {

        return {

          available: true,

          hint: `Pi 内嵌底座 v${VERSION} · 待配置 API 密钥（~/.pi/agent/auth.json）`,

        };

      }



      const openxLabel = describePiModelRef({

        model: settings.model,

        providers: settings.providers,

      });

      const modelLabel = openxLabel

        ? `OpenX ${openxLabel}`

        : resolved.model

          ? `${resolved.model.provider}/${resolved.model.id}`

          : `${available[0].provider}/${available[0].id}`;

      return {

        available: true,

        hint: `Pi 内嵌底座 v${VERSION} · ${modelLabel}`,

      };

    } catch (err) {

      return {

        available: false,

        hint: `Pi 内嵌底座加载失败：${err instanceof Error ? err.message : String(err)}`,

      };

    }

  },



  async run(ctx: ExecutorContext) {

    const { goal, callbacks, workspaceRoot } = ctx;

    const pi = resolvePiSettings(ctx);

    const promptText = [
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

    const crewSessionId = buildPiCrewSessionId(goal.id);
    if (callbacks.onCrewSession) {
      await callbacks.onCrewSession(crewSessionId);
    }



    if (ctx.isRework) {

      await callbacks.onLog("warn", `[pi] 返工续跑：${goal.reworkReason ?? "用户要求修改"}`);

    }



    await callbacks.onLog("info", `[pi] 内嵌 Pi SDK v${VERSION}`);

    const openxRef = describePiModelRef({

      model: ctx.settings.model,

      providers: ctx.settings.providers,

    });

    if (openxRef) {

      await callbacks.onLog("info", `[pi] OpenX 模型引用：${openxRef}`);

    }

    await callbacks.onLog("info", `[pi] 工作目录：${workspaceRoot}`);

    await callbacks.onProgress(8, "初始化 Pi 底座…");



    const { authStorage, modelRegistry } = await createPiModelRegistry({
      model: ctx.settings.model,
      providers: ctx.settings.providers,
    });

    const { model, error: modelError } = await resolvePiModel(pi, modelRegistry);

    if (modelError) {

      await callbacks.onFail(modelError);

      return;

    }



    const sessionManager = buildSessionManager(pi, workspaceRoot);

    let session: AgentSession | undefined;



    try {

      const githubSkillIds = ctx.enabledSkills
        ?.filter((s) => s.kind === "github")
        .map((s) => s.id);
      const resourceLoader = await createOpenxResourceLoader(workspaceRoot, githubSkillIds);

      const created = await createAgentSession({

        cwd: workspaceRoot,

        authStorage,

        modelRegistry,

        sessionManager,

        ...(model ? { model } : {}),

        ...(resourceLoader ? { resourceLoader } : {}),

      });

      session = created.session;

      if (created.modelFallbackMessage) {

        await callbacks.onLog("warn", `[pi] ${created.modelFallbackMessage}`);

      }



      await callbacks.onProgress(18, "Pi 已接受任务");

      const crewResult = await runPiCrewDialogueLoop(
        session,
        promptText,
        ctx,
        async (s, p, c, opts) => {
          const turn = await runSessionTurn(s, p, c, opts);
          return {
            summary: turn.summary,
            assistantText: turn.assistantText,
            park: turn.park,
            toolBudgetExceeded: turn.toolBudgetExceeded,
            deliverables: turn.deliverables,
          };
        },
      );

      const outcome = await handlePiForemanLoopOutcome(crewResult, callbacks, {
        goalId: goal.id,
        park: crewResult.park,
        session,
        toolBudgetFailMessage: `Pi 工具调用达到上限（${resolveMaxToolCalls(pi)} 次），任务未完成。摘要：${crewResult.summary.slice(0, 500)}`,
        completeLabel: "Pi 完成",
      });
      if (outcome !== "failed") {
        session = undefined;
      }

    } catch (err) {

      const message = err instanceof Error ? err.message : String(err);

      await callbacks.onFail(message);

    } finally {

      session?.dispose();

    }

  },



  async steerRework(ctx: ExecutorContext) {

    const parked = parkedRuns.get(ctx.goal.id);

    if (!parked) return false;



    const { callbacks } = ctx;

    const continuation = ctx.crewContinuationPrompt?.trim();
    const promptText = continuation
      ? continuation
      : [
          buildExecutionPrompt(
            ctx.goal,
            ctx.priorLogs ?? [],
            ctx.enabledSkills,
            {
              isRework: true,
              priorSummaries: ctx.priorSummaries,
              priorReviewRounds: ctx.priorReviewRounds,
              agentRole: ctx.agentRole,
              workspaceRoot: ctx.workspaceRoot,
              llmContext: ctx.llmContext,
              projectKnowledge: (ctx as { projectKnowledge?: string }).projectKnowledge,
            },
          ),
          CREW_FOREMAN_PROMPT_APPENDIX,
        ].join("\n\n");

    const crewSessionId = buildPiCrewSessionId(ctx.goal.id);
    if (callbacks.onCrewSession) {
      await callbacks.onCrewSession(crewSessionId);
    }

    parkedRuns.delete(ctx.goal.id);



    await callbacks.onLog(
      "info",
      continuation ? "[pi] 开发商确认后续跑" : "[pi] 返工 steer：保留 session 上下文继续执行",
    );

    await callbacks.onProgress(5, continuation ? "转告施工队…" : "返工 steer…");



    try {

      const crewResult = await runPiCrewDialogueLoop(
        parked.session,
        promptText,
        ctx,
        async (s, p, c, turnOpts) => {
          const turn = await runSessionTurn(s, p, c, turnOpts);
          return {
            summary: turn.summary,
            assistantText: turn.assistantText,
            park: turn.park,
            toolBudgetExceeded: turn.toolBudgetExceeded,
            deliverables: turn.deliverables,
          };
        },
        { initialSteer: true },
      );

      const outcome = await handlePiForemanLoopOutcome(crewResult, callbacks, {
        goalId: ctx.goal.id,
        park: crewResult.park,
        session: parked.session,
        toolBudgetFailMessage: `Pi 返工时工具调用达到上限，任务未完成。摘要：${crewResult.summary.slice(0, 500)}`,
        completeLabel: continuation ? "Pi 续跑完成" : "Pi 返工完成",
      });

      if (outcome === "failed") {
        parked.session.dispose();
        return true;
      }
      if (outcome === "parked") {
        return true;
      }

      if (!crewResult.park) {
        parked.session.dispose();
      }

      return true;

    } catch (err) {

      const message = err instanceof Error ? err.message : String(err);

      await callbacks.onFail(message);

      try {

        parked.session.dispose();

      } catch {

        /* ignore */

      }

      return false;

    }

  },



  cancel(goalId: string) {

    disposeParked(goalId);

    const run = activeRuns.get(goalId);

    if (!run) return;

    if (!run.abortSent) {

      run.abortSent = true;

      void run.session.abort();

    }

    setTimeout(() => {

      try {

        run.session.dispose();

      } catch {

        /* ignore */

      }

      activeRuns.delete(goalId);

    }, 1500);

  },

};



/** @internal 测试用 */

export function _clearPiRunsForTest() {

  for (const id of [...parkedRuns.keys()]) disposeParked(id);

  activeRuns.clear();

}



export function hasParkedPiSession(goalId: string): boolean {

  return parkedRuns.has(goalId);

}

export { pickExecutorWithPi, type ExecutorCandidate } from "./router.js";

