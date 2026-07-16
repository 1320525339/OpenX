import { stepCountIs, streamText } from "ai";
import type { ModelSettingsSlice } from "@openx/shared";
import { resolveModelCredentials } from "@openx/shared";
import { createModel, generateCoachText } from "../llm.js";
import { lengthInstruction, outputGoalInstruction } from "./router.js";
import {
  MAX_PARTICIPANT_TOOL_STEPS,
  buildParticipantTools,
  formatRosterSystemBlock,
  type ParticipantToolHandlers,
  type RoundtableAttendee,
} from "./participant-tools.js";

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
  onDelta?: (delta: string) => void;
  abortSignal?: AbortSignal;
};

export async function generateParticipantReply(
  input: ParticipantReplyInput,
): Promise<{ text: string; modelRef: string }> {
  const creds = resolveModelCredentials(input.settings, input.modelRef);
  if (!creds) {
    throw new Error(`无法解析模型：${input.modelRef}`);
  }
  const model = createModel(creds);
  const roster =
    input.attendees && input.attendees.length > 0
      ? formatRosterSystemBlock(input.attendees)
      : "";
  const system = [
    input.rolePrompt,
    `你的圆桌显示名为「${input.displayName}」。只从你的专业视角发言，不要假装是工头，不要生成任务单。`,
    roster,
    lengthInstruction(input.length),
    outputGoalInstruction(input.outputGoal),
  ]
    .filter(Boolean)
    .join("\n");

  const promptParts = [
    input.historyText ? `对话上下文：\n${input.historyText}\n` : "",
    input.sourceSnippet ? `针对以下消息回应：\n${input.sourceSnippet}\n` : "",
    `用户问题：\n${input.userMessage}`,
  ];
  const prompt = promptParts.filter(Boolean).join("\n");

  if (input.onDelta || input.tools) {
    const tools = input.tools ? buildParticipantTools(input.tools) : undefined;
    const result = streamText({
      model,
      system,
      prompt,
      temperature: 0.5,
      abortSignal: input.abortSignal,
      ...(tools
        ? { tools, stopWhen: stepCountIs(MAX_PARTICIPANT_TOOL_STEPS) }
        : {}),
    });
    let full = "";
    for await (const delta of result.textStream) {
      full += delta;
      input.onDelta?.(delta);
    }
    const text = (await result.text).trim() || full.trim();
    if (!text) throw new Error("模型返回空内容");
    return { text, modelRef: input.modelRef };
  }

  const text = await generateCoachText({
    model,
    system,
    prompt,
    temperature: 0.5,
  });
  if (!text.trim()) throw new Error("模型返回空内容");
  return { text: text.trim(), modelRef: input.modelRef };
}
