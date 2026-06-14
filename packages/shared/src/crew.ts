import { z } from "zod";

export const CrewQuestionOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});
export type CrewQuestionOption = z.infer<typeof CrewQuestionOptionSchema>;

export const CrewQuestionSchema = z.object({
  kind: z.literal("question"),
  prompt: z.string().min(1),
  options: z.array(CrewQuestionOptionSchema).min(1).optional(),
  /** 施工队完整输出，供工头理解语境 */
  context: z.string().optional(),
  /** 强制上报开发商（用户） */
  escalate: z.boolean().optional(),
});
export type CrewQuestion = z.infer<typeof CrewQuestionSchema>;

export const CrewDirectiveSchema = z.object({
  kind: z.literal("directive"),
  message: z.string().min(1),
  selectedOptionId: z.string().optional(),
  source: z.enum(["foreman_auto", "foreman_llm", "foreman_user", "foreman_rule"]).default("foreman_auto"),
});
export type CrewDirective = z.infer<typeof CrewDirectiveSchema>;

export const CrewEscalationSchema = z.object({
  kind: z.literal("escalation"),
  prompt: z.string().min(1),
  options: z.array(CrewQuestionOptionSchema).optional(),
  reason: z.string().optional(),
});
export type CrewEscalation = z.infer<typeof CrewEscalationSchema>;

export type CrewForemanOutcome = CrewDirective | CrewEscalation;

export const CrewStatusSchema = z.enum([
  "idle",
  "awaiting_foreman",
  "awaiting_user",
]);
export type CrewStatus = z.infer<typeof CrewStatusSchema>;

export const CREW_QUESTION_FENCE = "crew-question";

/** Pi / CLI 施工队向工头提问的 fenced JSON 块 */
export function formatCrewQuestionBlock(question: CrewQuestion): string {
  return ["```crew-question", JSON.stringify(question), "```"].join("\n");
}

export function parseCrewQuestionFromText(text: string): CrewQuestion | null {
  const re = /```crew-question\s*([\s\S]*?)```/i;
  const match = text.match(re);
  if (!match?.[1]) return null;
  try {
    const parsed = CrewQuestionSchema.safeParse(JSON.parse(match[1].trim()));
    return parsed.success ? { ...parsed.data, context: text } : null;
  } catch {
    return null;
  }
}

/** 解析施工队向工头的请示：优先 crew-question 块，否则识别自然语言标记 */
export function parseCrewMessageFromText(text: string): CrewQuestion | null {
  const fenced = parseCrewQuestionFromText(text);
  if (fenced) return fenced;

  const askBlock = text.match(/【请示工头】\s*\n?([\s\S]+?)(?:\n\n|$)/);
  if (askBlock?.[1]?.trim()) {
    return {
      kind: "question",
      prompt: askBlock[1].trim(),
      context: text,
    };
  }

  const atForeman = text.match(/@工头[：:]\s*([\s\S]+?)(?:\n\n|$)/);
  if (atForeman?.[1]?.trim()) {
    return {
      kind: "question",
      prompt: atForeman[1].trim(),
      context: text,
    };
  }

  return null;
}

/** 工头自然语言回复注入施工队 session */
export function formatCrewForemanReplyForPrompt(directive: CrewDirective): string {
  return `【工头】\n${directive.message}`;
}

/** @deprecated 使用 formatCrewForemanReplyForPrompt */
export function formatCrewDirectiveForPrompt(directive: CrewDirective): string {
  return formatCrewForemanReplyForPrompt(directive);
}

export const CREW_FOREMAN_PROMPT_APPENDIX = [
  "【工头协作】",
  "工头是你的监工同事。需要确认方案、边界或受阻时，直接用自然语言请示，例如：",
  "",
  "【请示工头】",
  "贪吃蛇和打砖块你更倾向哪个？我两种都能先搭骨架。",
  "",
  "也可选用结构化块（可选，非必须）：",
  "```crew-question",
  '{"kind":"question","prompt":"…","options":[{"id":"a","label":"方案A"}]}',
  "```",
  "",
  "工头会用【工头】标记回复。读懂后继续施工；仍不清楚可再次请示，允许多轮对话。",
].join("\n");

export function buildPiCrewSessionId(goalId: string): string {
  return `pi:${goalId}`;
}

export function buildAcpCrewSessionKey(goalId: string, runtimeId: string): string {
  return `${runtimeId}:${goalId}`;
}

export const CrewExchangeDirectionSchema = z.enum([
  "crew_to_foreman",
  "foreman_to_crew",
  "foreman_escalation",
  "foreman_review",
]);
export type CrewExchangeDirection = z.infer<typeof CrewExchangeDirectionSchema>;

export const CrewExchangeRecordSchema = z.object({
  id: z.number().int(),
  goalId: z.string(),
  conversationId: z.string(),
  direction: CrewExchangeDirectionSchema,
  summary: z.string(),
  payload: z.unknown().optional(),
  createdAt: z.string(),
});
export type CrewExchangeRecord = z.infer<typeof CrewExchangeRecordSchema>;

export function formatCrewExchangeCoachLine(
  direction: CrewExchangeDirection,
  summary: string,
): string {
  const prefix =
    direction === "crew_to_foreman"
      ? "施工队 → 工头"
      : direction === "foreman_to_crew"
        ? "工头 → 施工队"
        : direction === "foreman_escalation"
          ? "工头 → 开发商"
          : "工头验收";
  return `[${prefix}] ${summary}`;
}
