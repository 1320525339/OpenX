import type { Goal } from "./goal.js";
import { buildDispatchPermissionBlock } from "./dispatch-context.js";
import { buildSkillsPromptBlock, type ExecutionSkillHint } from "./skills.js";
import {
  LlmContextSettingsSchema,
  renderPromptTemplate,
  type ExecutionBlockId,
  type LlmContextSettings,
} from "./llm-context-config.js";
import { clipPromptList, clipPromptText } from "./prompt-budget.js";

export type PriorLog = { level: string; message: string };

/** 各区块 token 预算（对齐 MiMo checkpoint push_caps 思路） */
export const EXECUTION_PROMPT_BUDGETS = {
  rework: 4_000,
  priorSummaries: 3_000,
  priorReviewRounds: 4_000,
  resultSummary: 3_000,
  priorLogs: 2_000,
} as const;

export type BuildExecutionPromptOptions = {
  isRework?: boolean;
  priorSummaries?: string[];
  priorReviewRounds?: string[];
  agentRole?: string;
  workspaceRoot?: string;
  llmContext?: Partial<LlmContextSettings> | null;
  /** 项目用户 + 运行知识（L2/L3） */
  projectKnowledge?: string;
};

/** 执行 prompt 各区块默认模板（{{var}} 占位符） */
export const DEFAULT_EXECUTION_BLOCK_TEMPLATES: Record<ExecutionBlockId, string> = {
  workspace:
    "【工作目录】\n{{workspaceRoot}}\nSkills：.openx/skills · Agents：.openx/agents · MCP：.mcp.json",
  agentRole: "【Agent 角色】\n{{agentRole}}",
  rework: [
    "【审查反馈 · 请逐条落实】",
    "（参考 compose:feedback 工作流：先理解问题清单，再修改代码，最后给出可验证证据）",
    "{{reworkReason}}",
    "完成后在结果摘要中列出：已修改的文件/接口、测试或验证命令输出。",
  ].join("\n"),
  acceptance: "【验收标准】\n{{acceptance}}",
  constraints: "【约束条件】\n{{constraints}}",
  priorSummaries: "【历史执行摘要】\n{{priorSummariesBlock}}",
  priorReviewRounds: "【历史审查记录 · 每轮累积】\n{{priorReviewRoundsBlock}}",
  resultSummary: "【上轮结果摘要】\n{{resultSummary}}",
  priorLogs: "【近期执行日志】\n{{priorLogsBlock}}",
};

function resolveBlockTemplate(
  id: ExecutionBlockId,
  llmContext?: Partial<LlmContextSettings> | null,
): string {
  const parsed = LlmContextSettingsSchema.parse(llmContext ?? {});
  const override = parsed.executionBlocks?.[id]?.trim();
  return override || DEFAULT_EXECUTION_BLOCK_TEMPLATES[id];
}

function renderBlock(
  id: ExecutionBlockId,
  vars: Record<string, string>,
  llmContext?: Partial<LlmContextSettings> | null,
): string | null {
  const template = resolveBlockTemplate(id, llmContext);
  const rendered = renderPromptTemplate(template, vars).trim();
  return rendered || null;
}

/** 组装发给外部 CLI 的完整提示词（含返工上下文、验收、约束与 Skills） */
export function buildExecutionPrompt(
  goal: Goal,
  priorLogs: PriorLog[] = [],
  enabledSkills?: ExecutionSkillHint[],
  options?: BuildExecutionPromptOptions,
): string {
  const parts: string[] = [];
  const llmContext = options?.llmContext;
  const isRework = options?.isRework ?? goal.effectStatus === "rework";
  const reworkReason = goal.reworkReason?.trim() || "用户要求修改后重新执行";

  if (options?.workspaceRoot?.trim()) {
    const block = renderBlock(
      "workspace",
      { workspaceRoot: options.workspaceRoot.trim() },
      llmContext,
    );
    if (block) parts.push(block);
  }

  if (options?.projectKnowledge?.trim()) {
    parts.push(
      clipPromptText(
        `【项目知识库】\n${options.projectKnowledge.trim()}`,
        3_000,
      ),
    );
  }

  if (options?.agentRole?.trim()) {
    const block = renderBlock(
      "agentRole",
      { agentRole: options.agentRole.trim() },
      llmContext,
    );
    if (block) parts.push(block);
  }

  const permissionBlock = buildDispatchPermissionBlock(
    goal.dispatchContext?.permissionMode,
  );
  if (permissionBlock) parts.push(permissionBlock);

  if (isRework) {
    const reworkBody = clipPromptText(reworkReason, EXECUTION_PROMPT_BUDGETS.rework);
    const block = renderBlock("rework", { reworkReason: reworkBody }, llmContext);
    if (block) parts.push(block);
  }

  if (goal.acceptance?.trim()) {
    const block = renderBlock(
      "acceptance",
      { acceptance: goal.acceptance.trim() },
      llmContext,
    );
    if (block) parts.push(block);
  }

  if (goal.constraints?.length) {
    const block = renderBlock(
      "constraints",
      {
        constraints: goal.constraints.map((c) => `- ${c}`).join("\n"),
      },
      llmContext,
    );
    if (block) parts.push(block);
  }

  parts.push(goal.executionPrompt);

  const skillsBlock = buildSkillsPromptBlock(enabledSkills ?? []);
  if (skillsBlock) parts.push(skillsBlock);

  const summaries = options?.priorSummaries ?? [];
  if (summaries.length > 0) {
    const priorSummariesBlock = clipPromptList(
      summaries.map((s, i) => `第 ${i + 1} 轮：${s}`),
      EXECUTION_PROMPT_BUDGETS.priorSummaries,
      { keepFirst: true },
    );
    const block = renderBlock(
      "priorSummaries",
      { priorSummariesBlock },
      llmContext,
    );
    if (block) parts.push(block);
  }

  const reviewRounds = options?.priorReviewRounds ?? [];
  if (reviewRounds.length > 0) {
    const priorReviewRoundsBlock = clipPromptList(
      reviewRounds,
      EXECUTION_PROMPT_BUDGETS.priorReviewRounds,
      { keepFirst: true },
    );
    const block = renderBlock(
      "priorReviewRounds",
      { priorReviewRoundsBlock },
      llmContext,
    );
    if (block) parts.push(block);
  }

  if (goal.resultSummary?.trim()) {
    const block = renderBlock(
      "resultSummary",
      {
        resultSummary: clipPromptText(
          goal.resultSummary.trim(),
          EXECUTION_PROMPT_BUDGETS.resultSummary,
        ),
      },
      llmContext,
    );
    if (block) parts.push(block);
  }

  if (priorLogs.length > 0) {
    const tail = priorLogs.slice(-12);
    const priorLogsBlock = clipPromptText(
      tail.map((l) => `[${l.level.toUpperCase()}] ${l.message}`).join("\n"),
      EXECUTION_PROMPT_BUDGETS.priorLogs,
    );
    const block = renderBlock("priorLogs", { priorLogsBlock }, llmContext);
    if (block) parts.push(block);
  }

  return parts.join("\n\n");
}
