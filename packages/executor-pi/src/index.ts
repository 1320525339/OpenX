import { mkdirSync } from "node:fs";

import { join } from "node:path";

import { homedir } from "node:os";

import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";

import {

  VERSION,

  createAgentSession,

  SessionManager,

} from "@earendil-works/pi-coding-agent";

import type { PiExecutorSettings } from "@openx/shared";

import { buildExecutionPrompt, createRunEmitter, type ExecutorAdapter, type ExecutorContext, type RunEventEmitter } from "@openx/executor-core";

import { createPiModelRegistry, resolvePiModel } from "./model.js";

import { describePiModelRef, mergePiSettingsFromModel } from "./pi-bridge.js";
import { createOpenxResourceLoader } from "./pi-resource-loader.js";

import { summarizePiRun } from "./summary.js";



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



type TurnState = {

  assistantText: string;

  toolCount: number;

  lastAgentEnd?: Record<string, unknown>;

};



async function handlePiEvent(

  evt: AgentSessionEvent,

  ctx: {

    callbacks: ExecutorContext["callbacks"];

    state: TurnState;

    run: RunEventEmitter | null;

  },

): Promise<void> {

  const { callbacks, state, run } = ctx;



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

      await callbacks.onProgress(pct, "Pi 生成中…");

    }

    if (inner.type === "error") {

      await callbacks.onLog("error", `[pi] 流式错误：${String(inner.reason ?? "unknown")}`);

    }

  }



  if (evt.type === "tool_execution_start") {

    state.toolCount += 1;

    const tool = String(evt.toolName ?? "tool");

    const argsPreview = evt.args ? JSON.stringify(evt.args).slice(0, 120) : "";

    await run?.toolStart(tool, argsPreview);

    await callbacks.onLog("info", `[pi] 工具 #${state.toolCount}：${tool} ${argsPreview}`);

    await callbacks.onProgress(Math.min(88, 72 + state.toolCount * 3), `执行 ${tool}…`);

  }



  if (evt.type === "tool_execution_update") {

    const partial = evt.partialResult as { content?: ContentBlock[] } | undefined;

    const text = partial?.content

      ?.map((c) => (c.type === "text" ? c.text ?? "" : ""))

      .join("")

      .trim();

    if (text) {

      await callbacks.onLog("debug", `[pi] ${String(evt.toolName)} › ${text.slice(-200)}`);

    }

  }



  if (evt.type === "tool_execution_end") {

    const tool = String(evt.toolName ?? "tool");

    const isError = evt.isError === true;

    await run?.toolEnd(tool, isError);

    await callbacks.onLog(isError ? "warn" : "info", `[pi] 工具完成：${tool}`);

  }



  if (evt.type === "turn_end") {

    await run?.status("本轮收尾…");

    await callbacks.onProgress(92, "本轮收尾…");

  }



  if (evt.type === "agent_end") {

    state.lastAgentEnd = {

      type: "agent_end",

      messages: evt.messages,

      willRetry: evt.willRetry,

    };

    await callbacks.onProgress(95, "Pi 收尾…");

  }

}



async function runSessionTurn(

  session: AgentSession,

  promptText: string,

  ctx: ExecutorContext,

  opts?: { steer?: boolean },

): Promise<{ summary: string; park: boolean }> {

  const { goal, callbacks } = ctx;

  const pi = resolvePiSettings(ctx);

  const timeoutMs = pi.runTimeoutMs ?? 600_000;

  const state: TurnState = {

    assistantText: "",

    toolCount: 0,

  };

  let timedOut = false;

  const run = createRunEmitter(ctx);



  activeRuns.set(goal.id, { session, abortSent: false });



  const unsubscribe = session.subscribe((evt) => {

    void handlePiEvent(evt, { callbacks, state, run });

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

    (timedOut

      ? `\n\n（已超时 ${Math.round(timeoutMs / 1000)}s，请人工核对结果。）`

      : "");



  return { summary, park: !timedOut };

}



function parkSession(goalId: string, session: AgentSession) {

  parkedRuns.set(goalId, { session });

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

  displayName: "Pi（内嵌底座）",



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

    const promptText = buildExecutionPrompt(goal, ctx.priorLogs ?? [], ctx.enabledSkills, {
      isRework: ctx.isRework,
      priorSummaries: ctx.priorSummaries,
    });



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

      const { summary, park } = await runSessionTurn(session, promptText, ctx);

      await callbacks.onProgress(100, "Pi 完成");

      await callbacks.onComplete(summary);

      if (park) {

        parkSession(goal.id, session);

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

    const promptText = buildExecutionPrompt(
      ctx.goal,
      ctx.priorLogs ?? [],
      ctx.enabledSkills,
      { isRework: true, priorSummaries: ctx.priorSummaries },
    );

    parkedRuns.delete(ctx.goal.id);



    await callbacks.onLog("info", "[pi] 返工 steer：保留 session 上下文继续执行");

    await callbacks.onProgress(5, "返工 steer…");



    try {

      const { summary, park } = await runSessionTurn(parked.session, promptText, ctx, {

        steer: true,

      });

      await callbacks.onProgress(100, "Pi 返工完成");

      await callbacks.onComplete(summary);

      if (park) {

        parkSession(ctx.goal.id, parked.session);

      } else {

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


