import { z } from "zod";
import { GoalDeliverableSchema } from "./deliverable.js";

export const MAX_FOREMAN_LOOP_ROUNDS = 10;

export const CrewQuestionOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});
export type CrewQuestionOption = z.infer<typeof CrewQuestionOptionSchema>;

export const CrewPermissionKindSchema = z.enum([
  "general",
  "write",
  "shell",
  "read",
]);
export type CrewPermissionKind = z.infer<typeof CrewPermissionKindSchema>;

/** 消息关联字段（新路径应填写；旧消息兼容缺省） */
export const CrewCorrelationFieldsSchema = z.object({
  requestId: z.string().min(1).optional(),
  replyTo: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  turnId: z.number().int().nonnegative().optional(),
  permissionKind: CrewPermissionKindSchema.optional(),
});
export type CrewCorrelationFields = z.infer<typeof CrewCorrelationFieldsSchema>;

export const CrewQuestionSchema = z.object({
  kind: z.literal("question"),
  prompt: z.string().min(1),
  options: z.array(CrewQuestionOptionSchema).min(1).optional(),
  /** 施工队完整输出，供工头理解语境 */
  context: z.string().optional(),
  /** 强制上报开发商（用户） */
  escalate: z.boolean().optional(),
  requestId: z.string().min(1).optional(),
  replyTo: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  turnId: z.number().int().nonnegative().optional(),
  permissionKind: CrewPermissionKindSchema.optional(),
});
export type CrewQuestion = z.infer<typeof CrewQuestionSchema>;

export const CrewDirectiveSchema = z.object({
  kind: z.literal("directive"),
  message: z.string().min(1),
  selectedOptionId: z.string().optional(),
  source: z.enum(["foreman_auto", "foreman_llm", "foreman_user", "foreman_rule"]).default("foreman_auto"),
  /** 工头已提请开发商决策，施工队应 park 并等待续跑 */
  pauseUntilUser: z.boolean().optional(),
  requestId: z.string().min(1).optional(),
  replyTo: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  turnId: z.number().int().nonnegative().optional(),
  permissionKind: CrewPermissionKindSchema.optional(),
});
export type CrewDirective = z.infer<typeof CrewDirectiveSchema>;

export const CrewEscalationSchema = z.object({
  kind: z.literal("escalation"),
  prompt: z.string().min(1),
  options: z.array(CrewQuestionOptionSchema).optional(),
  reason: z.string().optional(),
  requestId: z.string().min(1).optional(),
  replyTo: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  turnId: z.number().int().nonnegative().optional(),
  permissionKind: CrewPermissionKindSchema.optional(),
});
export type CrewEscalation = z.infer<typeof CrewEscalationSchema>;

/** 生成施工队请求关联 ID */
export function createCrewRequestId(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  return `crew-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 确保 CrewQuestion 带 requestId（缺则补齐） */
export function ensureCrewRequestId(question: CrewQuestion): CrewQuestion {
  if (question.requestId?.trim()) return question;
  return { ...question, requestId: createCrewRequestId() };
}

export type CrewForemanOutcome = CrewDirective | CrewEscalation;

/** 工头对一轮施工反馈的控制决策 */
export const ForemanTurnActionSchema = z.enum([
  "continue",
  "ask_user",
  "submit_for_review",
  "fail",
]);
export type ForemanTurnAction = z.infer<typeof ForemanTurnActionSchema>;

export const ForemanTurnDecisionSchema = z.object({
  action: ForemanTurnActionSchema,
  message: z.string().min(1),
  reason: z.string().optional(),
  source: z
    .enum(["foreman_auto", "foreman_llm", "foreman_rule"])
    .default("foreman_rule"),
});
export type ForemanTurnDecision = z.infer<typeof ForemanTurnDecisionSchema>;

/** 施工队一轮结束后的工头审阅输入 */
export const ForemanTurnReviewInputSchema = z.object({
  assistantText: z.string(),
  summary: z.string(),
  deliverables: z.array(GoalDeliverableSchema).optional(),
  round: z.number().int().nonnegative().optional(),
});
export type ForemanTurnReviewInput = z.infer<typeof ForemanTurnReviewInputSchema>;

export const FOREMAN_TURN_DECISION_FENCE = "foreman-turn-decision";

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

/** 施工队未用协议标记、但以自然语言请求确认/选型时，转为工头请示 */
function detectImplicitCrewQuestion(text: string): CrewQuestion | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const proposesPlan =
    /方案\s*[A-DＡ-Ｄ0-9]/i.test(trimmed) ||
    /建议.{0,12}方案/.test(trimmed) ||
    /可选方案/.test(trimmed);
  const asksConfirmation =
    /确认后/.test(trimmed) ||
    /请.{0,6}确认/.test(trimmed) ||
    /是否.{0,8}(执行|继续|同意|采用|可以)/.test(trimmed) ||
    /等你确认/.test(trimmed) ||
    /待你确认/.test(trimmed) ||
    /需要你确认/.test(trimmed);

  if (proposesPlan && asksConfirmation) {
    return {
      kind: "question",
      prompt: "施工队已给出实施方案并请求确认，请工头判断是否需上报开发商决策。",
      context: trimmed,
      escalate: true,
    };
  }

  const blockedHint =
    /停服|删库|DELETE|清空.*表|不可恢复|备份后/.test(trimmed) && asksConfirmation;
  if (blockedHint) {
    return {
      kind: "question",
      prompt: "施工队提出高风险操作并请求确认，请工头判断是否上报开发商。",
      context: trimmed,
      escalate: true,
    };
  }

  return null;
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

  return detectImplicitCrewQuestion(text);
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

/** 解析工头轮次审阅的结构化 JSON 块 */
export function parseForemanTurnDecisionFromText(text: string): ForemanTurnDecision | null {
  const re = /```foreman-turn-decision\s*([\s\S]*?)```/i;
  const match = text.match(re);
  if (!match?.[1]) return null;
  try {
    const parsed = ForemanTurnDecisionSchema.safeParse(JSON.parse(match[1].trim()));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** 将轮次决策转为施工队 steer 指令 */
export function foremanTurnDecisionToDirective(
  decision: ForemanTurnDecision,
): CrewDirective {
  return {
    kind: "directive",
    message: decision.message,
    source: decision.source ?? "foreman_rule",
    pauseUntilUser: decision.action === "ask_user",
  };
}
