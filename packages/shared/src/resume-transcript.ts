import {
  formatCrewExchangeCoachLine,
  type CrewExchangeRecord,
} from "./crew.js";
import { clipPromptList, clipPromptText } from "./prompt-budget.js";

/** ACP/Pi 续跑时注入的压缩 transcript 预算 */
export const RESUME_TRANSCRIPT_BUDGETS = {
  crewExchanges: 3_000,
  priorSummaries: 2_000,
  priorLogs: 1_500,
  total: 6_000,
} as const;

export type ResumeTranscriptInput = {
  crewExchanges?: Array<Pick<CrewExchangeRecord, "direction" | "summary">>;
  priorSummaries?: string[];
  priorLogs?: Array<{ level: string; message: string }>;
};

/**
 * 组装续跑上下文块：工头↔施工队对话 + 执行摘要 + 近期日志。
 * 用于 ACP loadSession 后 Agent 未持久化完整历史时的 OpenX 侧补偿。
 */
export function buildResumeTranscriptBlock(
  input: ResumeTranscriptInput,
): string | undefined {
  const parts: string[] = [];

  const exchanges = input.crewExchanges ?? [];
  if (exchanges.length > 0) {
    const lines = exchanges.map((e) =>
      formatCrewExchangeCoachLine(e.direction, e.summary),
    );
    const block = clipPromptList(lines, RESUME_TRANSCRIPT_BUDGETS.crewExchanges, {
      keepFirst: true,
      joiner: "\n",
    });
    if (block.trim()) {
      parts.push(`【工头↔施工队对话摘要】\n${block}`);
    }
  }

  const summaries = input.priorSummaries ?? [];
  if (summaries.length > 0) {
    const block = clipPromptList(
      summaries.map((s, i) => `第 ${i + 1} 轮：${s}`),
      RESUME_TRANSCRIPT_BUDGETS.priorSummaries,
      { keepFirst: true },
    );
    if (block.trim()) {
      parts.push(`【历史执行摘要】\n${block}`);
    }
  }

  const logs = input.priorLogs ?? [];
  if (logs.length > 0) {
    const tail = logs.slice(-12);
    const block = clipPromptText(
      tail.map((l) => `[${l.level.toUpperCase()}] ${l.message}`).join("\n"),
      RESUME_TRANSCRIPT_BUDGETS.priorLogs,
    );
    if (block.trim()) {
      parts.push(`【近期执行日志】\n${block}`);
    }
  }

  if (parts.length === 0) return undefined;
  const body = clipPromptText(parts.join("\n\n"), RESUME_TRANSCRIPT_BUDGETS.total);
  return `【续跑上下文 · OpenX 补偿注入】\n以下为 loadSession 后补全的历史，请承接此前进度继续执行。\n\n${body}`;
}

/** 将续跑 transcript 与主指令合并（transcript 在前） */
export function prependResumeTranscript(
  prompt: string,
  transcript?: string | null,
): string {
  const t = transcript?.trim();
  if (!t) return prompt;
  return `${t}\n\n${prompt}`;
}
