import type { Goal } from "@openx/shared";
import { buildSkillsPromptBlock, type ExecutionSkillHint } from "@openx/shared";

export type PriorLog = { level: string; message: string };

export type BuildExecutionPromptOptions = {
  isRework?: boolean;
  priorSummaries?: string[];
  priorReviewRounds?: string[];
  agentRole?: string;
  workspaceRoot?: string;
};

/** 组装发给外部 CLI 的完整提示词（含返工上下文、验收、约束与 Skills） */
export function buildExecutionPrompt(
  goal: Goal,
  priorLogs: PriorLog[] = [],
  enabledSkills?: ExecutionSkillHint[],
  options?: BuildExecutionPromptOptions,
): string {
  const parts: string[] = [];
  const isRework = options?.isRework ?? goal.effectStatus === "rework";

  if (options?.workspaceRoot?.trim()) {
    parts.push(
      `【工作目录】\n${options.workspaceRoot.trim()}\nSkills：.openx/skills · Agents：.openx/agents · MCP：.mcp.json`,
    );
  }

  if (options?.agentRole?.trim()) {
    parts.push(`【Agent 角色】\n${options.agentRole.trim()}`);
  }

  if (isRework) {
    const reason = goal.reworkReason?.trim() || "用户要求修改后重新执行";
    parts.push(
      [
        "【审查反馈 · 请逐条落实】",
        "（参考 compose:feedback 工作流：先理解问题清单，再修改代码，最后给出可验证证据）",
        reason,
        "完成后在结果摘要中列出：已修改的文件/接口、测试或验证命令输出。",
      ].join("\n"),
    );
  }

  if (goal.acceptance?.trim()) {
    parts.push(`【验收标准】\n${goal.acceptance.trim()}`);
  }

  if (goal.constraints?.length) {
    parts.push(
      `【约束条件】\n${goal.constraints.map((c) => `- ${c}`).join("\n")}`,
    );
  }

  parts.push(goal.executionPrompt);

  const skillsBlock = buildSkillsPromptBlock(enabledSkills ?? []);
  if (skillsBlock) parts.push(skillsBlock);

  const summaries = options?.priorSummaries ?? [];
  if (summaries.length > 0) {
    const block = summaries.map((s, i) => `第 ${i + 1} 轮：${s}`).join("\n\n");
    parts.push(`【历史执行摘要】\n${block}`);
  }

  const reviewRounds = options?.priorReviewRounds ?? [];
  if (reviewRounds.length > 0) {
    parts.push(`【历史审查记录 · 每轮累积】\n${reviewRounds.join("\n\n")}`);
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
