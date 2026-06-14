import {
  CLARIFY_TOOL_NAME,
  WORK_ORDER_TOOL_NAME,
  clipPromptText,
  estimatePromptTokens,
  type CoachChatTurn,
  type CoachMessageRecord,
} from "@openx/shared";

export const DEFAULT_COACH_THREAD_CHAR_BUDGET = 12_000;

export const COACH_THREAD_CHECKPOINT_HEADING =
  "## 会话摘要（checkpoint，较早对话已压缩）";

export function formatCoachThreadTurnLine(turn: CoachChatTurn): string {
  const label =
    turn.role === "user"
      ? "用户"
      : turn.role === "tool_result"
        ? `工具结果${turn.toolName ? ` · ${turn.toolName}` : ""}`
        : "工头";
  return `${label}：${turn.text.trim()}`;
}

export type CoachThreadPressure = 1 | 2 | 3;

export type CompactCoachThreadOptions = {
  maxHistoryChars?: number;
  checkpointPrefix?: string;
  messageLimit?: number;
};

export function detectCoachThreadPressure(
  turns: CoachChatTurn[],
  maxHistoryChars = DEFAULT_COACH_THREAD_CHAR_BUDGET,
): CoachThreadPressure {
  if (turns.length === 0) return 1;
  const totalChars = turns.reduce(
    (sum, turn) => sum + formatCoachThreadTurnLine(turn).length,
    0,
  );
  if (turns.length <= 24 && totalChars <= maxHistoryChars) return 1;
  if (turns.length <= 80 && totalChars <= maxHistoryChars * 2) return 2;
  return 3;
}

/** P2：压缩工具结果与结构化卡片为短行 */
export function softenCoachTurnsForCompaction(
  turns: CoachChatTurn[],
): CoachChatTurn[] {
  return turns.map((turn) => {
    if (turn.role === "tool_result") {
      const clipped = clipPromptText(turn.text, 120, "…");
      return { ...turn, text: clipped };
    }
    if (turn.toolName === WORK_ORDER_TOOL_NAME) {
      return {
        ...turn,
        text: clipPromptText(turn.text, 180, "…（工单详情已压缩）"),
      };
    }
    if (turn.toolName === CLARIFY_TOOL_NAME) {
      return {
        ...turn,
        text: clipPromptText(turn.text, 160, "…（澄清详情已压缩）"),
      };
    }
    if (turn.text.startsWith("[执行快照]")) {
      return turn;
    }
    if (estimatePromptTokens(turn.text) > 500) {
      return {
        ...turn,
        text: clipPromptText(turn.text, 500, "…（长回复已压缩）"),
      };
    }
    return turn;
  });
}

/** 保留最近轮次，优先填满字符预算 */
export function selectRecentCoachTurns(
  turns: CoachChatTurn[],
  maxHistoryChars: number,
): { selected: CoachChatTurn[]; omittedEarlier: number } {
  if (turns.length === 0) return { selected: [], omittedEarlier: 0 };

  const selected: CoachChatTurn[] = [];
  let used = 0;
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i]!;
    const line = formatCoachThreadTurnLine(turn);
    if (selected.length > 0 && used + line.length > maxHistoryChars) break;
    selected.unshift(turn);
    used += line.length;
  }

  return {
    selected,
    omittedEarlier: Math.max(0, turns.length - selected.length),
  };
}

export function buildCoachThreadBlockFromTurns(
  turns: CoachChatTurn[],
  opts?: {
    maxHistoryChars?: number;
    checkpointPrefix?: string;
    heading?: string;
  },
): string {
  const maxHistoryChars =
    opts?.maxHistoryChars ?? DEFAULT_COACH_THREAD_CHAR_BUDGET;
  const heading = opts?.heading ?? "## 对话历史（同一助手会话，请连贯理解上文）";
  const { selected, omittedEarlier } = selectRecentCoachTurns(
    turns,
    maxHistoryChars,
  );
  if (selected.length === 0 && !opts?.checkpointPrefix?.trim()) return "";

  const lines: string[] = [];
  if (opts?.checkpointPrefix?.trim()) {
    lines.push(COACH_THREAD_CHECKPOINT_HEADING);
    lines.push(opts.checkpointPrefix.trim());
  }
  lines.push(heading);
  if (omittedEarlier > 0) {
    lines.push(`…（另有 ${omittedEarlier} 轮较早对话已省略）`);
  }
  for (const turn of selected) {
    lines.push(formatCoachThreadTurnLine(turn));
  }
  return lines.join("\n");
}

export function compactCoachThreadTurns(
  turns: CoachChatTurn[],
  options?: CompactCoachThreadOptions,
): {
  turns: CoachChatTurn[];
  pressure: CoachThreadPressure;
  block: string;
} {
  const maxHistoryChars =
    options?.maxHistoryChars ?? DEFAULT_COACH_THREAD_CHAR_BUDGET;
  const limited =
    options?.messageLimit && options.messageLimit > 0
      ? turns.slice(-options.messageLimit)
      : turns;

  const pressure = detectCoachThreadPressure(limited, maxHistoryChars);
  const softened =
    pressure >= 2 ? softenCoachTurnsForCompaction(limited) : limited;
  const block = buildCoachThreadBlockFromTurns(softened, {
    maxHistoryChars,
    checkpointPrefix: options?.checkpointPrefix,
  });

  const { selected } = selectRecentCoachTurns(softened, maxHistoryChars);
  return { turns: selected, pressure, block };
}

export function buildDeterministicCoachCheckpoint(
  records: CoachMessageRecord[],
): string {
  const sections: string[] = [];
  const intents: string[] = [];
  const goals: string[] = [];
  const decisions: string[] = [];
  const pending: string[] = [];

  for (const row of records) {
    if (row.kind === "text" && row.role === "user") {
      intents.push(row.text.trim().slice(0, 200));
      continue;
    }
    if (row.kind === "refined") {
      goals.push(`工单：${row.refined.title}`);
      continue;
    }
    if (row.kind === "clarify") {
      const title = row.clarify.title?.trim() || "澄清";
      if (row.clarify.status === "pending") {
        pending.push(`${title}（待回答）`);
      } else {
        decisions.push(`${title}（${row.clarify.status}）`);
      }
      continue;
    }
    if (row.kind === "execution") {
      goals.push(
        `执行：${row.execution.goalTitle} → ${row.execution.goalStatus}`,
      );
      continue;
    }
    if (row.kind === "tool_result") {
      decisions.push(
        `${row.toolResult.toolName} → ${row.toolResult.outcome}`,
      );
    }
  }

  if (intents.length > 0) {
    sections.push(`### 会话意图\n${intents.slice(-3).join("\n")}`);
  }
  if (goals.length > 0) {
    sections.push(`### 活跃 Goal\n${goals.slice(-6).join("\n")}`);
  }
  if (decisions.length > 0) {
    sections.push(`### 决策与结果\n${decisions.slice(-8).join("\n")}`);
  }
  if (pending.length > 0) {
    sections.push(`### 待确认\n${pending.join("\n")}`);
  }

  const lastUser = [...records]
    .reverse()
    .find((r) => r.kind === "text" && r.role === "user");
  if (lastUser && lastUser.kind === "text") {
    sections.push(`### Next action\n跟进：${lastUser.text.trim().slice(0, 240)}`);
  }

  return sections.join("\n\n").trim();
}
