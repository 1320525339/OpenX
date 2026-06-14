import type {
  CoachChatContext,
  CoachChatTurn,
  GoalFeedback,
  LlmContextSettings,
} from "@openx/shared";
import {
  buildConfiguredSystemPrompt,
  buildRefineSystemPrompt,
} from "./render-llm-prompt.js";
import {
  buildCoachThreadBlock,
  DEFAULT_COACH_THREAD_CHAR_BUDGET,
} from "./coach-thread-prompt.js";

/** @deprecated 使用 buildRefineSystemPrompt(settings.llmContext) */
export const COACH_REFINE_SYSTEM = buildRefineSystemPrompt();

function formatFeedbackBlock(feedback?: GoalFeedback): string {
  if (!feedback) return "";
  const lines: string[] = [];
  if (feedback.reworkReason?.trim()) {
    lines.push(`返工原因：${feedback.reworkReason.trim()}`);
  }
  if (feedback.resultSummary?.trim()) {
    lines.push(`上轮结果：${feedback.resultSummary.trim()}`);
  }
  if (feedback.priorSummaries?.length) {
    lines.push(
      `历史执行摘要：\n${feedback.priorSummaries.map((s) => `- ${s}`).join("\n")}`,
    );
  }
  if (feedback.priorReviewRounds?.length) {
    lines.push(
      `历史审查记录：\n${feedback.priorReviewRounds.map((s) => `- ${s}`).join("\n")}`,
    );
  }
  if (feedback.recentLogs?.length) {
    const tail = feedback.recentLogs.slice(-8);
    lines.push(
      `近期日志：\n${tail.map((l) => `[${l.level}] ${l.message}`).join("\n")}`,
    );
  }
  if (lines.length === 0) return "";
  return `\n\n【执行反馈（请据此优化 executionPrompt，避免重复失败）】\n${lines.join("\n\n")}`;
}

export function buildRefineUserPrompt(
  userDraft: string,
  defaultConstraints: string[],
  feedback?: GoalFeedback,
): string {
  const extra =
    defaultConstraints.length > 0
      ? `\n\n工头行为准则：\n${defaultConstraints.map((c) => `- ${c}`).join("\n")}`
      : "";
  return `用户目标草稿：\n${userDraft}${extra}${formatFeedbackBlock(feedback)}

整理时请按「问题定位 brief 模板」输出 executionPrompt：写明问题类型、期望/现象、已知事实、待核实项、调查入口、范围边界与验收标准。不要臆造用户未提供的信息；缺失项写入「待核实项」。`;
}

export function formatFeedbackNotes(feedback?: GoalFeedback): string | undefined {
  const block = formatFeedbackBlock(feedback);
  return block ? block.trim() : undefined;
}

/** 用户想查看 / 列出 / 读取工作目录或文件（派 Pi 子任务，工头不读盘） */
export function isWorkspaceInspectIntent(message: string): boolean {
  const m = message.trim();
  if (!m) return false;
  return (
    /看.*(文件|目录|文件夹)|查看.*(文件|目录|文件夹)|列出|列举|目录结构|有哪些文件|有什么文件|当前目录|工作目录|文件夹下|目录下|ls\b|dir\b|list\s+(files|dir)/i.test(
      m,
    ) ||
    /read\s+(file|dir|folder)|show\s+(files|directory)|workspace/i.test(m)
  );
}

export function buildWorkspaceInspectRefined(
  userMessage: string,
  workspaceRoot: string,
): {
  title: string;
  acceptance: string;
  executionPrompt: string;
  constraints: string[];
} {
  const root =
    workspaceRoot && workspaceRoot.trim() && workspaceRoot !== "."
      ? workspaceRoot.trim()
      : "当前 OpenX 系统工作目录（见设置 systemWorkspaceRoot）";

  return {
    title: "查看工作目录文件列表",
    acceptance:
      "输出工作目录下文件与文件夹的名称列表（区分文件/目录），并给出简要中文摘要。",
    executionPrompt: `【派单类型】只读侦察（Explore）

【问题类型】只读侦察

【用户期望】
输出工作目录下文件与文件夹的名称列表（区分文件/目录），并给出简要中文摘要。

【实际现象 / 用户原话】
${userMessage.trim()}

【已知事实】
- 工作目录：${root}

【待核实项】
- 目录顶层条目名称与类型
- 若用户指定子路径，该路径下条目

【调查入口】
- 工作目录根路径
- 用户消息中提及的子路径或文件名关键词

【执行步骤】
1. 在工作目录下列出顶层条目（可用 ls、dir 或 read 等工具）
2. 标明每个条目是文件还是目录
3. 若用户指定了子路径，进入该路径后再列出
4. 不要修改、删除或创建文件，只读查看
5. 完成后用中文给出简要摘要，供工头汇总给用户

【验收标准】
- 列出实际存在的条目名称
- 摘要说明目录大致内容`,
    constraints: ["仅在工作目录内只读操作", "不要修改或删除任何文件"],
  };
}

export function buildAgentSystemPrompt(
  context: CoachChatContext,
  llmContextSettings?: Partial<LlmContextSettings> | null,
): string {
  return buildConfiguredSystemPrompt("coach", context, llmContextSettings);
}

/** 流式闲聊/咨询/进展查询：无 JSON 约束 */
export function buildChatStreamSystemPrompt(
  context: CoachChatContext,
  llmContextSettings?: Partial<LlmContextSettings> | null,
): string {
  return buildConfiguredSystemPrompt("stream", context, llmContextSettings);
}

const DEFAULT_HISTORY_CHAR_BUDGET = DEFAULT_COACH_THREAD_CHAR_BUDGET;

/** 将历史轮次与当前用户消息拼成单次 LLM user prompt */
export function buildChatUserPrompt(
  message: string,
  history: CoachChatTurn[] = [],
  maxHistoryChars = DEFAULT_HISTORY_CHAR_BUDGET,
  options?: {
    jsonMode?: boolean | "tool_continuation" | "clarify" | "clarify_continuation" | "structured";
    threadBlock?: string;
  },
): string {
  const lines: string[] = [];

  const threadBlock =
    options?.threadBlock ?? buildCoachThreadBlock(history, maxHistoryChars);
  if (threadBlock) {
    lines.push(threadBlock);
    lines.push("");
  }

  if (options?.jsonMode === "tool_continuation") {
    lines.push("## 待处理工具结果");
    lines.push(message.trim());
    lines.push("");
    lines.push(
      "用户已通过 UI 对 propose_work_order 作出选择。请仅输出 message 确认收到，禁止再次输出 refined。",
    );
  } else if (options?.jsonMode === "clarify") {
    lines.push("## 当前用户消息");
    lines.push(message.trim());
    lines.push("");
    lines.push(
      "用户意图不够明确。请输出 clarify（1-4 道决策题，含 id/prompt/options；选项可有 description、recommended、preview），不要输出 refined。",
    );
    lines.push(
      "澄清重点：期望 vs 实际、复现步骤、影响范围、优化目标、可接受改动边界。字段 message 简要说明为何需要澄清。",
    );
  } else if (options?.jsonMode === "clarify_continuation") {
    lines.push("## 待处理澄清结果");
    lines.push(message.trim());
    lines.push("");
    lines.push(
      "用户已回答 propose_clarification。请根据答案输出 refined 任务单（可含 subGoals），不要再次 clarify。",
    );
    lines.push(
      "refined.executionPrompt 必须使用问题定位 brief 模板，把澄清结果写入「已知事实」，仍不确定的写入「待核实项」。",
    );
  } else if (options?.jsonMode === "structured") {
    lines.push("## 当前用户消息");
    lines.push(message.trim());
    lines.push("");
    lines.push(
      "请根据信息完整度自行选择输出（三选一，勿同时输出 clarify 与 refined）：",
    );
    lines.push(
      "1) 范围/验收/期望/复现/边界不明确 → 输出 clarify（propose_clarification，1-4 题，含 options/preview），不要 refined；",
    );
    lines.push(
      "2) 信息充分、可派单 → 输出 refined（含 executionPrompt 问题定位 brief）；",
    );
    lines.push("3) 仅咨询/闲聊/进展 → 仅 message，不输出 clarify 或 refined。");
    lines.push(
      "澄清重点：期望 vs 实际、复现步骤、影响范围、优化目标、可接受改动边界。",
    );
  } else {
    lines.push("## 当前用户消息");
    lines.push(message.trim());
    lines.push("");
    if (options?.jsonMode !== false) {
      lines.push(
        "字段 message 必填；需要派单时填 refined。约束不足（bug/异常/优化但缺少期望、复现、范围）时优先 clarify 或追问，勿勉强 refined。",
      );
      lines.push(
        "refined.executionPrompt 须按问题定位 brief 模板组织，含已知事实与待核实项。",
      );
    } else {
      lines.push("请直接回复用户。");
      lines.push(
        "若为设计、游戏、股票等非编程探讨，按 discourseThinking 深度组织，勿输出 refined。",
      );
    }
  }
  return lines.join("\n");
}

/** @deprecated 使用 buildAgentSystemPrompt */
export const buildChatSystemPrompt = buildAgentSystemPrompt;
