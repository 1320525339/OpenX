import type { CoachMessageRecord } from "@openx/shared";

export function maxCoachTextMessageId(messages: CoachMessageRecord[]): number {
  let max = 0;
  for (const row of messages) {
    if (row.kind === "text" && row.role === "coach" && row.id > max) {
      max = row.id;
    }
  }
  return max;
}

/** 取 baseline 之后最新一条工头文本消息 id */
export function pickCoachRevealMessageId(
  messages: CoachMessageRecord[],
  baselineCoachId: number,
): number | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const row = messages[i];
    if (row?.kind === "text" && row.role === "coach" && row.id > baselineCoachId) {
      return row.id;
    }
  }
  return null;
}
