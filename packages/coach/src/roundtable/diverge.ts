import { generateText, stepCountIs, streamText } from "ai";
import type { ModelSettingsSlice } from "@openx/shared";
import { resolveModelCredentials } from "@openx/shared";
import { createModel, generateCoachText } from "../llm.js";
import { lengthInstruction, outputGoalInstruction } from "./router.js";
import {
  MAX_PARTICIPANT_TOOL_STEPS,
  buildParticipantTools,
  formatRosterSystemBlock,
  synthesizeToolNotesText,
  wrapHandlersWithToolNotes,
  type ParticipantToolHandlers,
  type RoundtableAttendee,
} from "./participant-tools.js";

/** 圆桌单次生成超时（含工具轮）；可用 OPENX_ROUNDTABLE_LLM_TIMEOUT_MS 覆盖 */
const DEFAULT_ROUNDTABLE_LLM_TIMEOUT_MS = 120_000;

export type RoundtableComposerContextBlock = {
  enabledSkills?: Array<{ id: string; name: string; desc: string }>;
  enabledMcps?: Array<{ id: string; name: string }>;
  knowledgeSummary?: string;
  permissionMode?: "read_only" | "ask_write" | "full";
};

export type ParticipantReplyInput = {
  settings: ModelSettingsSlice;
  modelRef: string;
  rolePrompt: string;
  displayName: string;
  userMessage: string;
  /** 历史上下文（发散模式不含同轮其它回复） */
  historyText?: string;
  sourceSnippet?: string;
  outputGoal?: "ideas" | "plans" | "risks" | "counterexamples" | "free";
  length?: "short" | "medium" | "long";
  /** 当前出席名簿 */
  attendees?: RoundtableAttendee[];
  /** 圆桌工具（名簿/查答/@成员） */
  tools?: ParticipantToolHandlers;
  /** Composer 选中的 Skill/MCP/知识/权限（提示词感知，非现场调工具） */
  composerContext?: RoundtableComposerContextBlock;
  onDelta?: (delta: string) => void;
  abortSignal?: AbortSignal;
};

const PERMISSION_MODE_LABEL: Record<
  NonNullable<RoundtableComposerContextBlock["permissionMode"]>,
  string
> = {
  read_only: "只读",
  ask_write: "写前确认",
  full: "完整权限",
};

/** 纯函数：把 Composer Context 格式化为提示词块（可单测） */
export function formatRoundtableComposerContextBlock(
  ctx?: RoundtableComposerContextBlock,
): string {
  if (!ctx) return "";
  const lines: string[] = [];
  if (ctx.enabledSkills?.length) {
    lines.push("本次讨论启用的 Skills（供参考，勿假装已执行工具）：");
    for (const s of ctx.enabledSkills) {
      lines.push(`- ${s.name} (${s.id}): ${s.desc}`);
    }
  }
  if (ctx.enabledMcps?.length) {
    lines.push("本次讨论启用的 MCP（供参考，勿假装已调用）：");
    for (const m of ctx.enabledMcps) {
      lines.push(`- ${m.name} (${m.id})`);
    }
  }
  if (ctx.knowledgeSummary?.trim()) {
    lines.push("相关知识摘录：");
    lines.push(ctx.knowledgeSummary.trim());
  }
  if (ctx.permissionMode) {
    lines.push(
      `后续派单权限意向：${PERMISSION_MODE_LABEL[ctx.permissionMode]}（${ctx.permissionMode}）`,
    );
  }
  return lines.join("\n");
}

function resolveRoundtableAbortSignal(external?: AbortSignal): {
  signal: AbortSignal;
  cancel: () => void;
} {
  const timeoutMs = Math.max(
    5_000,
    Number(process.env.OPENX_ROUNDTABLE_LLM_TIMEOUT_MS) ||
      DEFAULT_ROUNDTABLE_LLM_TIMEOUT_MS,
  );
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), timeoutMs);
  if (typeof timer === "object" && "unref" in timer) {
    timer.unref();
  }
  const onExternal = () => timeout.abort();
  if (external) {
    if (external.aborted) timeout.abort();
    else external.addEventListener("abort", onExternal, { once: true });
  }
  return {
    signal: timeout.signal,
    cancel: () => {
      clearTimeout(timer);
      external?.removeEventListener("abort", onExternal);
    },
  };
}

function rethrowRoundtableStreamError(
  err: unknown,
  opts: { timedOut: boolean; userAborted: boolean },
): never {
  if (opts.userAborted) {
    const abortErr = new Error("生成已取消或已停止。");
    abortErr.name = "AbortError";
    throw abortErr;
  }
  if (opts.timedOut) {
    throw new Error("模型响应超时，请稍后重试或更换模型。");
  }
  throw err;
}

function buildSystemPrompt(input: ParticipantReplyInput): string {
  const roster =
    input.attendees && input.attendees.length > 0
      ? formatRosterSystemBlock(input.attendees)
      : "";
  const composerBlock = formatRoundtableComposerContextBlock(input.composerContext);
  return [
    input.rolePrompt,
    `你的圆桌显示名为「${input.displayName}」。只从你的专业视角发言，不要假装是工头，不要生成任务单。`,
    roster,
    composerBlock,
    lengthInstruction(input.length),
    outputGoalInstruction(input.outputGoal),
  ]
    .filter(Boolean)
    .join("\n");
}

function buildUserPrompt(input: ParticipantReplyInput): string {
  return [
    input.historyText ? `对话上下文：\n${input.historyText}\n` : "",
    input.sourceSnippet ? `针对以下消息回应：\n${input.sourceSnippet}\n` : "",
    `用户问题：\n${input.userMessage}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** 有工具：对齐 knowledge-chat，用 generateText + 空正文工具笔记合成 */
async function generateWithTools(
  input: ParticipantReplyInput,
  model: ReturnType<typeof createModel>,
  system: string,
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  const toolNotes: string[] = [];
  const handlers = wrapHandlersWithToolNotes(input.tools!, toolNotes);
  const tools = buildParticipantTools(handlers);

  const { text } = await generateText({
    model,
    system,
    prompt,
    temperature: 0.5,
    abortSignal: signal,
    tools,
    stopWhen: stepCountIs(MAX_PARTICIPANT_TOOL_STEPS),
  });

  const finalText =
    text.trim() ||
    synthesizeToolNotesText(toolNotes) ||
    "（本轮无正文输出）";
  input.onDelta?.(finalText);
  return finalText;
}

/** 无工具：只消费 textStream，对齐 coachChatStreamLlm / connect-client */
async function generateStreamOnly(
  input: ParticipantReplyInput,
  model: ReturnType<typeof createModel>,
  system: string,
  prompt: string,
  signal: AbortSignal,
  externalAbort?: AbortSignal,
): Promise<string> {
  const result = streamText({
    model,
    system,
    prompt,
    temperature: 0.5,
    abortSignal: signal,
  });
  let full = "";
  try {
    for await (const delta of result.textStream) {
      full += delta;
      input.onDelta?.(delta);
    }
  } catch (err) {
    rethrowRoundtableStreamError(err, {
      timedOut: signal.aborted && !externalAbort?.aborted,
      userAborted: Boolean(externalAbort?.aborted),
    });
  }

  let text = full.trim();
  if (!text) {
    text = (
      await generateCoachText({
        model,
        system,
        prompt,
        temperature: 0.5,
        abortSignal: signal,
      })
    ).trim();
    if (text) input.onDelta?.(text);
  }
  if (!text) throw new Error("模型返回空内容");
  return text;
}

export async function generateParticipantReply(
  input: ParticipantReplyInput,
): Promise<{ text: string; modelRef: string }> {
  const creds = resolveModelCredentials(input.settings, input.modelRef);
  if (!creds) {
    throw new Error(`无法解析模型：${input.modelRef}`);
  }
  const model = createModel(creds);
  const system = buildSystemPrompt(input);
  const prompt = buildUserPrompt(input);

  const { signal, cancel } = resolveRoundtableAbortSignal(input.abortSignal);
  try {
    if (input.tools) {
      try {
        const text = await generateWithTools(
          input,
          model,
          system,
          prompt,
          signal,
        );
        return { text, modelRef: input.modelRef };
      } catch (err) {
        rethrowRoundtableStreamError(err, {
          timedOut: signal.aborted && !input.abortSignal?.aborted,
          userAborted: Boolean(input.abortSignal?.aborted),
        });
      }
    }

    const text = await generateStreamOnly(
      input,
      model,
      system,
      prompt,
      signal,
      input.abortSignal,
    );
    return { text, modelRef: input.modelRef };
  } finally {
    cancel();
  }
}
