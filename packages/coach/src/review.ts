/**
 * Coach 自动验收：按验收标准比对执行结果，输出 pass/fail 判定。
 * 对齐 MiMo judge：独立审查员模型、冷上下文、证据导向。
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";
import { z } from "zod";
import {
  appendReviewPlaybookToSystem,
  buildRoleSystemPrompt,
  clipPromptList,
  clipPromptText,
  upgradeToModelConfig,
  type LlmContextSettings,
  type ModelSettingsSlice,
} from "@openx/shared";
import { generateStructuredObject, resolveLlmCredentials, type LlmEnv } from "./llm.js";
import {
  classifyCoachLlmError,
  formatCoachLlmError,
  isCoachParseError,
} from "./llm-errors.js";

const REVIEW_PROMPT_BUDGETS = {
  fileEvidence: 12_000,
  priorRounds: 4_000,
  runTrajectory: 2_500,
  recentLogs: 2_000,
  resultSummary: 3_000,
} as const;

export const ReviewReworkTargetSchema = z.object({
  childTitle: z.string(),
  instruction: z.string(),
});
export type ReviewReworkTarget = z.infer<typeof ReviewReworkTargetSchema>;

export const ReviewVerdictSchema = z.object({
  verdict: z.enum(["pass", "fail"]),
  reason: z.string(),
  reworkInstruction: z.string().optional(),
  reworkTargets: z.array(ReviewReworkTargetSchema).optional(),
  /** 验收标准在当前条件下不可达（对齐 MiMo judge impossible） */
  blocked: z.boolean().optional(),
});
export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>;

export type ReviewGoalInput = {
  title: string;
  acceptance: string;
  resultSummary: string;
  recentLogs?: Array<{ level: string; message: string }>;
  iteration?: number;
  deliverablesSummary?: string;
  fileEvidence?: string;
  testEvidence?: string;
  priorReviewRounds?: string[];
  /** 执行器工具轨迹摘要（run_events） */
  runTrajectory?: string;
};

export type ParentReviewChild = {
  title: string;
  acceptance: string;
  resultSummary: string;
  fileEvidence?: string;
  deliverablesSummary?: string;
};

export type ParentReviewInput = {
  parentTitle: string;
  parentAcceptance: string;
  rollupSummary: string;
  children: ParentReviewChild[];
  iteration?: number;
  fileEvidence?: string;
  testEvidence?: string;
  priorReviewRounds?: string[];
  runTrajectory?: string;
};

function appendPriorRounds(parts: string[], rounds?: string[]): void {
  if (!rounds?.length) return;
  const block = clipPromptList(rounds, REVIEW_PROMPT_BUDGETS.priorRounds, {
    keepFirst: true,
  });
  parts.push(`## 历史审查记录\n${block}`);
}

function buildReviewPrompt(input: ReviewGoalInput): string {
  const parts = [
    `## 任务标题\n${input.title}`,
    `## 验收标准\n${input.acceptance}`,
    `## 执行结果摘要\n${clipPromptText(
      input.resultSummary || "（执行器未提供结果摘要）",
      REVIEW_PROMPT_BUDGETS.resultSummary,
    )}`,
  ];
  if (input.deliverablesSummary) {
    parts.push(`## 结构化交付物\n${input.deliverablesSummary}`);
  }
  if (input.runTrajectory?.trim()) {
    parts.push(`## 执行工具轨迹（审查员必读）\n${input.runTrajectory.trim()}`);
  }
  if (input.fileEvidence) {
    parts.push(
      `## 工作区文件证据（审查员必读）\n${clipPromptText(
        input.fileEvidence,
        REVIEW_PROMPT_BUDGETS.fileEvidence,
      )}`,
    );
  }
  if (input.testEvidence) {
    parts.push(input.testEvidence);
  }
  appendPriorRounds(parts, input.priorReviewRounds);
  if (input.recentLogs?.length) {
    const logs = clipPromptText(
      input.recentLogs
        .slice(-20)
        .map((l) => `[${l.level}] ${l.message.slice(0, 200)}`)
        .join("\n"),
      REVIEW_PROMPT_BUDGETS.recentLogs,
    );
    parts.push(`## 近期执行日志\n${logs}`);
  }
  if (input.iteration != null && input.iteration > 0) {
    parts.push(
      `## 备注\n这是第 ${input.iteration + 1} 次验收（此前已返工 ${input.iteration} 次），请重点核对上次返工要求是否落实。`,
    );
  }
  parts.push("请按验收标准逐条比对并给出判定。");
  return parts.join("\n\n");
}

export type ReviewGoalOptions = {
  reviewerRolePrompt?: string;
  llmContextSettings?: Partial<LlmContextSettings>;
  /** 默认 false：审查员冷启动，不注入工头闲聊线程 */
  includeCoachThread?: boolean;
  coachThreadPrefix?: string;
};

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced?.[1]?.trim() ?? trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("模型未返回 JSON 对象");
  }
  return JSON.parse(raw.slice(start, end + 1));
}

async function generateReviewVerdict(options: {
  model: ReturnType<ReturnType<typeof createOpenAICompatible>>;
  system: string;
  prompt: string;
}): Promise<ReviewVerdict> {
  try {
    return await generateStructuredObject<ReviewVerdict>({
      model: options.model,
      schema: ReviewVerdictSchema,
      system: options.system,
      prompt: options.prompt,
    });
  } catch (err) {
    const parseRelated =
      isCoachParseError(err) || classifyCoachLlmError(err) === "parse_failed";
    if (!parseRelated) throw err;
    const { text } = await generateText({
      model: options.model,
      system: options.system,
      prompt: `${options.prompt}\n\n只输出一个 JSON 对象，字段：verdict(pass|fail)、reason、可选 reworkInstruction/blocked。不要 markdown。`,
      temperature: 0,
    });
    return ReviewVerdictSchema.parse(extractJsonObject(text));
  }
}

function composeReviewSystem(
  baseSystem: string,
  options?: ReviewGoalOptions,
  roleLabel?: string,
): string {
  const parts: string[] = [];
  if (options?.includeCoachThread) {
    const thread = options.coachThreadPrefix?.trim();
    if (thread) parts.push(thread);
  }
  const reviewerPrompt = options?.reviewerRolePrompt?.trim();
  if (reviewerPrompt && roleLabel) {
    parts.push(reviewerPrompt, "", `你当前职责是${roleLabel}。还须遵守：`, baseSystem);
  } else if (reviewerPrompt) {
    parts.push(reviewerPrompt, "", baseSystem);
  } else {
    parts.push(baseSystem);
  }
  return parts.join("\n");
}

function buildParentReviewPrompt(input: ParentReviewInput): string {
  const parts = [
    `## 父目标\n${input.parentTitle}`,
    `## 父目标验收标准\n${input.parentAcceptance}`,
    `## 父目标汇总摘要\n${input.rollupSummary || "（尚无汇总）"}`,
    "## 子任务结果",
  ];
  for (const [index, child] of input.children.entries()) {
    const summary = child.resultSummary?.trim() || "（无结果摘要）";
    const childParts = [
      `### ${index + 1}. ${child.title}`,
      `验收：${child.acceptance}`,
      `结果：${summary}`,
    ];
    if (child.deliverablesSummary) {
      childParts.push(`交付物：${child.deliverablesSummary}`);
    }
    if (child.fileEvidence) {
      childParts.push(`文件证据：\n${child.fileEvidence}`);
    }
    parts.push(childParts.join("\n"));
  }
  if (input.runTrajectory?.trim()) {
    parts.push(`## 执行工具轨迹\n${input.runTrajectory.trim()}`);
  }
  if (input.fileEvidence) {
    parts.push(`## 父目标相关工作区证据\n${input.fileEvidence}`);
  }
  if (input.testEvidence) {
    parts.push(input.testEvidence);
  }
  appendPriorRounds(parts, input.priorReviewRounds);
  if (input.iteration != null && input.iteration > 0) {
    parts.push(
      `## 备注\n第 ${input.iteration + 1} 次合成验收（此前已返工 ${input.iteration} 次）。`,
    );
  }
  parts.push("请按父目标验收标准做合成验收，判断集成后是否真正完成。");
  return parts.join("\n\n");
}

async function runReviewLlm(
  settings: ModelSettingsSlice,
  env: LlmEnv | undefined,
  system: string,
  prompt: string,
): Promise<{ verdict: ReviewVerdict | null; llmError?: string }> {
  const upgraded = upgradeToModelConfig(settings);
  const creds = resolveLlmCredentials(upgraded, "reviewer", env);
  if (!creds) {
    return { verdict: null, llmError: "审查员模型未配置" };
  }

  const provider = createOpenAICompatible({
    name: "openx-reviewer",
    baseURL: creds.baseUrl.replace(/\/$/, ""),
    apiKey: creds.apiKey,
    headers: { "User-Agent": "openx-reviewer/0.1" },
  });

  try {
    const object = await generateReviewVerdict({
      model: provider(creds.model),
      system,
      prompt,
    });
    return { verdict: object };
  } catch (err) {
    const hint = formatCoachLlmError(err);
    return {
      verdict: null,
      llmError: hint ?? (err instanceof Error ? err.message : String(err)),
    };
  }
}

export async function reviewParentGoalCompletion(
  input: ParentReviewInput,
  settings: ModelSettingsSlice,
  env?: LlmEnv,
  options?: ReviewGoalOptions,
): Promise<{ verdict: ReviewVerdict | null; llmError?: string }> {
  const baseSystem = appendReviewPlaybookToSystem(
    buildRoleSystemPrompt("parentReview", options?.llmContextSettings),
    "parent_review",
  );
  const system = composeReviewSystem(baseSystem, options, "父目标合成验收员");
  return runReviewLlm(settings, env, system, buildParentReviewPrompt(input));
}

export async function reviewGoalCompletion(
  input: ReviewGoalInput,
  settings: ModelSettingsSlice,
  env?: LlmEnv,
  options?: ReviewGoalOptions,
): Promise<{ verdict: ReviewVerdict | null; llmError?: string }> {
  const baseSystem = appendReviewPlaybookToSystem(
    buildRoleSystemPrompt("review", options?.llmContextSettings),
    "goal_review",
  );
  const system = composeReviewSystem(baseSystem, options, "验收员");
  return runReviewLlm(settings, env, system, buildReviewPrompt(input));
}
