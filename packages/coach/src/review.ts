/**
 * Coach 自动验收：按验收标准比对执行结果，输出 pass/fail 判定。
 * 用于 auto-review 循环——通过则自动 approve，不通过自动返工。
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateObject } from "ai";
import { z } from "zod";
import { upgradeToModelConfig, type ModelSettingsSlice } from "@openx/shared";
import { resolveLlmCredentials, type LlmEnv } from "./llm.js";
import { formatCoachLlmError } from "./llm-errors.js";

export const ReviewReworkTargetSchema = z.object({
  /** 必须与输入子任务列表中的 title 完全一致 */
  childTitle: z.string(),
  instruction: z.string(),
});
export type ReviewReworkTarget = z.infer<typeof ReviewReworkTargetSchema>;

export const ReviewVerdictSchema = z.object({
  verdict: z.enum(["pass", "fail"]),
  reason: z.string(),
  /** verdict=fail 时给执行器的修改建议 */
  reworkInstruction: z.string().optional(),
  /** 父目标合成验收 fail 时：精准打回对应子任务 */
  reworkTargets: z.array(ReviewReworkTargetSchema).optional(),
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
  /** compose:verify 验证命令输出 */
  testEvidence?: string;
  priorReviewRounds?: string[];
};

const REVIEW_SYSTEM = [
  "你是 OpenX 工头层的验收员。你的唯一职责：按验收标准严格比对执行结果，判定是否达标。",
  "判定原则：",
  "1. 只看证据。结果摘要与日志中没有体现的内容，一律视为未完成。",
  "2. 验收标准的每一条都要满足才能 pass；任何一条不满足即 fail。",
  "3. 执行器自称完成但没有给出可验证产出（文件路径、数据、链接、命令输出等）时，判 fail。",
  "4. 必须对照「工作区文件证据」与「验证命令输出」；测试失败、文件缺失/内容不符 → fail。",
  "5. fail 时必须在 reworkInstruction 中给出编号问题清单（逐条可执行）。",
  "6. 宁可判 fail 也不要「差不多」放行；只有证据充分且逐条达标才可 pass。",
  "输出 JSON：{ verdict, reason, reworkInstruction? }",
].join("\n");

const PARENT_REVIEW_SYSTEM = [
  "你是 OpenX 工头层的合成验收员（参考 MiMo Compose 的 verify + review 工作流）。",
  "父目标的子任务均已 individually 完成，你需要判断：把它们拼在一起后，父目标验收标准是否真正达成。",
  "判定原则：",
  "1. 逐条核对父目标验收标准；子任务各自完成 ≠ 父目标集成完成。",
  "2. 检查子任务之间是否有缺口、矛盾或未覆盖的集成点（接口、数据流、端到端行为）。",
  "3. 只看证据：父汇总摘要与各子任务结果中的可验证产出。",
  "4. fail 时必须填写 reworkTargets：每项 { childTitle, instruction }，childTitle 与子任务列表 title 完全一致。",
  "5. 优先打回责任子任务，而非笼统修补；只有无法归因时才仅用 reworkInstruction。",
  "6. 只有集成后整体达标才可 pass。",
  "输出 JSON：{ verdict, reason, reworkInstruction?, reworkTargets? }",
].join("\n");

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
  /** compose:verify 验证命令输出 */
  testEvidence?: string;
  priorReviewRounds?: string[];
};

function appendPriorRounds(parts: string[], rounds?: string[]): void {
  if (rounds?.length) {
    parts.push(`## 历史审查记录\n${rounds.join("\n\n")}`);
  }
}

function buildReviewPrompt(input: ReviewGoalInput): string {
  const parts = [
    `## 任务标题\n${input.title}`,
    `## 验收标准\n${input.acceptance}`,
    `## 执行结果摘要\n${input.resultSummary || "（执行器未提供结果摘要）"}`,
  ];
  if (input.deliverablesSummary) {
    parts.push(`## 结构化交付物\n${input.deliverablesSummary}`);
  }
  if (input.fileEvidence) {
    parts.push(`## 工作区文件证据（审查员必读）\n${input.fileEvidence}`);
  }
  if (input.testEvidence) {
    parts.push(input.testEvidence);
  }
  appendPriorRounds(parts, input.priorReviewRounds);
  if (input.recentLogs?.length) {
    const logs = input.recentLogs
      .slice(-20)
      .map((l) => `[${l.level}] ${l.message.slice(0, 200)}`)
      .join("\n");
    parts.push(`## 近期执行日志\n${logs}`);
  }
  if (input.iteration != null && input.iteration > 0) {
    parts.push(`## 备注\n这是第 ${input.iteration + 1} 次验收（此前已返工 ${input.iteration} 次），请重点核对上次返工要求是否落实。`);
  }
  parts.push("请按验收标准逐条比对并给出判定。");
  return parts.join("\n\n");
}

/**
 * LLM 验收。模型未配置或调用失败时返回 null（调用方应保持 awaiting_review 等人工确认，
 * 绝不在无法判定时自动放行）。
 */
export type ReviewGoalOptions = {
  /** 来自 AGENT.md 审查员 Persona，覆盖默认验收员 system */
  reviewerRolePrompt?: string;
};

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

export async function reviewParentGoalCompletion(
  input: ParentReviewInput,
  settings: ModelSettingsSlice,
  env?: LlmEnv,
  options?: ReviewGoalOptions,
): Promise<{ verdict: ReviewVerdict | null; llmError?: string }> {
  const upgraded = upgradeToModelConfig(settings);
  const creds = resolveLlmCredentials(upgraded, "coach", env);
  if (!creds) {
    return { verdict: null, llmError: "模型未配置，无法合成验收" };
  }

  const provider = createOpenAICompatible({
    name: "openx-coach",
    baseURL: creds.baseUrl.replace(/\/$/, ""),
    apiKey: creds.apiKey,
    headers: { "User-Agent": "openx-coach/0.1" },
  });

  const reviewerPrompt = options?.reviewerRolePrompt?.trim();
  const system = reviewerPrompt
    ? [reviewerPrompt, "", "你当前职责是父目标合成验收员。还须遵守：", PARENT_REVIEW_SYSTEM].join(
        "\n",
      )
    : PARENT_REVIEW_SYSTEM;

  try {
    const { object } = await generateObject({
      model: provider(creds.model),
      schema: ReviewVerdictSchema,
      system,
      prompt: `${buildParentReviewPrompt(input)}\n\n请以 JSON 对象回复，不要输出 markdown 代码块或推理过程。`,
      temperature: 0,
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

export async function reviewGoalCompletion(
  input: ReviewGoalInput,
  settings: ModelSettingsSlice,
  env?: LlmEnv,
  options?: ReviewGoalOptions,
): Promise<{ verdict: ReviewVerdict | null; llmError?: string }> {
  const upgraded = upgradeToModelConfig(settings);
  const creds = resolveLlmCredentials(upgraded, "coach", env);
  if (!creds) {
    return { verdict: null, llmError: "模型未配置，无法自动验收" };
  }

  const provider = createOpenAICompatible({
    name: "openx-coach",
    baseURL: creds.baseUrl.replace(/\/$/, ""),
    apiKey: creds.apiKey,
    headers: { "User-Agent": "openx-coach/0.1" },
  });

  const reviewerPrompt = options?.reviewerRolePrompt?.trim();
  const system = reviewerPrompt
    ? [
        reviewerPrompt,
        "",
        "你当前职责是验收员。除上述角色定位外，还须遵守：",
        REVIEW_SYSTEM,
      ].join("\n")
    : REVIEW_SYSTEM;

  try {
    const { object } = await generateObject({
      model: provider(creds.model),
      schema: ReviewVerdictSchema,
      system,
      prompt: `${buildReviewPrompt(input)}\n\n请以 JSON 对象回复，不要输出 markdown 代码块或推理过程。`,
      temperature: 0,
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
