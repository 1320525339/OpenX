import type { Goal } from "@openx/shared";
import { buildSkillsPromptBlock, type ExecutionSkillHint } from "@openx/shared";

export type PriorLog = { level: string; message: string };

export type BuildExecutionPromptOptions = {
  isRework?: boolean;
  priorSummaries?: string[];
};

/** 组装发给外部 CLI 的完整提示词（含返工上下文与 Skills） */
export function buildExecutionPrompt(
  goal: Goal,
  priorLogs: PriorLog[] = [],
  enabledSkills?: ExecutionSkillHint[],
  options?: BuildExecutionPromptOptions,
): string {
  const parts: string[] = [];
  const isRework = options?.isRework ?? goal.effectStatus === "rework";

  if (isRework) {
    const reason = goal.reworkReason?.trim() || "用户要求修改后重新执行";
    parts.push(`【返工说明】上一轮未通过验收。原因：${reason}`);
  }

  parts.push(goal.executionPrompt);

  const skillsBlock = buildSkillsPromptBlock(enabledSkills ?? []);
  if (skillsBlock) parts.push(skillsBlock);

  const summaries = options?.priorSummaries ?? [];
  if (summaries.length > 0) {
    const block = summaries.map((s, i) => `第 ${i + 1} 轮：${s}`).join("\n\n");
    parts.push(`【历史执行摘要】\n${block}`);
  }

  if (goal.resultSummary?.trim()) {
    parts.push(`【上轮结果摘要】\n${goal.resultSummary.trim()}`);
  }

  if (priorLogs.length > 0) {
    const tail = priorLogs.slice(-12);
    const block = tail.map((l) => `[${l.level.toUpperCase()}] ${l.message}`).join("\n");
    parts.push(`【近期执行日志】\n${block}`);
  }

  return parts.join("\n\n");
}
