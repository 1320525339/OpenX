import { z } from "zod";

/** 工头向用户挂起结构化澄清（对齐 propose_work_order 工具协议） */
export const CLARIFY_TOOL_NAME = "propose_clarification" as const;

export const CoachClarifyPreviewSchema = z.object({
  format: z.enum(["html", "markdown", "mermaid", "text"]),
  content: z.string(),
});
export type CoachClarifyPreview = z.infer<typeof CoachClarifyPreviewSchema>;

export const CoachClarifyOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  recommended: z.boolean().optional(),
  preview: CoachClarifyPreviewSchema.optional(),
});
export type CoachClarifyOption = z.infer<typeof CoachClarifyOptionSchema>;

export const CoachClarifyQuestionSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  multiSelect: z.boolean().optional(),
  allowFreeform: z.boolean().optional(),
  /** 依赖的前序题下标（0-based）；配合 dependsOnOptionIds 控制显隐 */
  dependsOnIndex: z.number().int().min(0).optional(),
  /** 父题答案需包含这些 option id 之一时才展示本题 */
  dependsOnOptionIds: z.array(z.string().min(1)).optional(),
  options: z.array(CoachClarifyOptionSchema).min(1).max(6).optional(),
});
export type CoachClarifyQuestion = z.infer<typeof CoachClarifyQuestionSchema>;

export const CoachClarifyStatusSchema = z.enum(["pending", "answered", "dismissed"]);
export type CoachClarifyStatus = z.infer<typeof CoachClarifyStatusSchema>;

export const CoachClarifyPayloadSchema = z.object({
  title: z.string().optional(),
  introHtml: z.string().optional(),
  questions: z.array(CoachClarifyQuestionSchema).min(1).max(4),
  status: CoachClarifyStatusSchema.default("pending"),
});
export type CoachClarifyPayload = z.infer<typeof CoachClarifyPayloadSchema>;

export const ClarifyAnswerValueSchema = z.union([z.string(), z.array(z.string())]);
export type ClarifyAnswerValue = z.infer<typeof ClarifyAnswerValueSchema>;

export const ClarifyAnswerAnnotationSchema = z.object({
  notes: z.string().optional(),
});
export type ClarifyAnswerAnnotation = z.infer<typeof ClarifyAnswerAnnotationSchema>;

export const ClarifyToolOutcomeSchema = z.enum(["answered", "dismissed"]);
export type ClarifyToolOutcome = z.infer<typeof ClarifyToolOutcomeSchema>;

export const ClarifyToolResultSchema = z.object({
  toolName: z.literal(CLARIFY_TOOL_NAME),
  clarifyMessageId: z.number(),
  outcome: ClarifyToolOutcomeSchema,
  answers: z.record(z.string(), ClarifyAnswerValueSchema).optional(),
  annotations: z.record(z.string(), ClarifyAnswerAnnotationSchema).optional(),
  /** @deprecated 由 outcome === "dismissed" 推导，新写入勿再设置 */
  dismissed: z.boolean().optional(),
});
export type ClarifyToolResult = z.infer<typeof ClarifyToolResultSchema>;

/** 自由作答题在 answers 中的占位 id */
export const CLARIFY_FREEFORM_ANSWER_ID = "__freeform__" as const;

export const CoachClarifyRespondSchema = z
  .object({
    conversationId: z.string().min(1),
    outcome: ClarifyToolOutcomeSchema,
    answers: z.record(z.string(), ClarifyAnswerValueSchema).optional(),
    annotations: z.record(z.string(), ClarifyAnswerAnnotationSchema).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.outcome !== "answered") return;
    const answerKeys = Object.keys(data.answers ?? {});
    const hasNotes = Object.values(data.annotations ?? {}).some((a) =>
      Boolean(a.notes?.trim()),
    );
    if (!answerKeys.length && !hasNotes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "outcome=answered 时需提供 answers 或 annotations",
        path: ["answers"],
      });
    }
  });
export type CoachClarifyRespondInput = z.infer<typeof CoachClarifyRespondSchema>;

/** 是否允许用户以备注/自由文本作答 */
export function clarifyQuestionAllowsFreeform(q: CoachClarifyQuestion): boolean {
  if (q.allowFreeform === false) return false;
  if (q.allowFreeform === true) return true;
  return !q.options?.length;
}

/** 单题是否已作答（含 DAG 不可见题跳过） */
export function isClarifyQuestionAnswered(
  q: CoachClarifyQuestion,
  questions: CoachClarifyQuestion[],
  questionIndex: number,
  answers: Record<string, ClarifyAnswerValue>,
  annotations?: Record<string, ClarifyAnswerAnnotation>,
): boolean {
  if (!isClarifyQuestionVisible(questions, questionIndex, answers)) return true;
  const raw = answers[q.id];
  const note = annotations?.[q.id]?.notes?.trim();
  if (clarifyQuestionAllowsFreeform(q) && note) return true;
  if (!q.options?.length) {
    return Boolean(raw != null && String(raw).length > 0) || Boolean(note);
  }
  if (raw == null) return false;
  if (Array.isArray(raw)) return raw.length > 0;
  return String(raw).length > 0;
}

/** 服务端校验作答是否覆盖所有可见题 */
export function validateClarifyRespondInput(
  payload: CoachClarifyPayload,
  input: CoachClarifyRespondInput,
): string | undefined {
  if (input.outcome === "dismissed") return undefined;
  const answers = input.answers ?? {};
  for (let i = 0; i < payload.questions.length; i += 1) {
    const q = payload.questions[i]!;
    if (
      !isClarifyQuestionAnswered(q, payload.questions, i, answers, input.annotations)
    ) {
      return `请完成澄清题：${q.prompt}`;
    }
  }
  return undefined;
}

/** 多题澄清 DAG：父题已答且选项匹配时展示 */
export function isClarifyQuestionVisible(
  questions: CoachClarifyQuestion[],
  questionIndex: number,
  answers: Record<string, ClarifyAnswerValue>,
): boolean {
  const q = questions[questionIndex];
  if (!q) return false;
  const depIndex = q.dependsOnIndex;
  if (depIndex == null) return true;
  const parent = questions[depIndex];
  if (!parent) return true;
  const raw = answers[parent.id];
  if (raw == null) return false;
  const selected = Array.isArray(raw) ? raw : [raw];
  if (!selected.length) return false;
  if (!q.dependsOnOptionIds?.length) return true;
  return q.dependsOnOptionIds.some((id) => selected.includes(id));
}

/** 将用户答案格式化为工头续聊 prompt */
export function formatClarifyAnswersForPrompt(
  payload: CoachClarifyPayload,
  answers: Record<string, ClarifyAnswerValue>,
  annotations?: Record<string, ClarifyAnswerAnnotation>,
): string {
  const lines: string[] = [];
  for (const q of payload.questions) {
    const raw = answers[q.id];
    const note = annotations?.[q.id]?.notes?.trim();
    if (raw == null && !note) continue;
    if (raw == null && note) {
      lines.push(`- ${q.prompt} → （备注：${note}）`);
      continue;
    }
    const values = Array.isArray(raw!) ? raw! : [raw!];
    const label =
      values
        .map((v) => {
          if (v === CLARIFY_FREEFORM_ANSWER_ID) return "（自由输入见备注）";
          const opt = q.options?.find((o) => o.id === v);
          return opt?.label ?? v;
        })
        .join("、") || "（未选）";
    lines.push(`- ${q.prompt} → ${label}${note ? `（备注：${note}）` : ""}`);
  }
  return lines.join("\n");
}
