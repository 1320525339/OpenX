import type { ChatRound, ChatRoundMode, CoachMessageRecord } from "@openx/shared";

/** 从消息列表拼圆桌历史；excludeRoundId 用于发散盲答（同轮互不可见） */
export function formatRoundtableHistory(
  records: CoachMessageRecord[],
  opts?: {
    excludeRoundId?: string;
    /** speakerId → 显示名 */
    nameBySpeakerId?: Map<string, string>;
  },
): string {
  const lines: string[] = [];
  for (const r of records) {
    if (r.kind === "text") {
      if (opts?.excludeRoundId && r.roundId === opts.excludeRoundId) continue;
      const speakerId = r.speakerId ?? "";
      const who =
        r.speakerType === "user"
          ? "用户"
          : r.speakerType === "participant"
            ? (opts?.nameBySpeakerId?.get(speakerId) ?? (speakerId || "成员"))
            : (opts?.nameBySpeakerId?.get(speakerId) ?? "工头");
      lines.push(`${who}: ${r.text}`);
    } else if (r.kind === "round_synthesis") {
      lines.push(
        `工头总结: ${r.synthesis.recommendation}\n共识: ${r.synthesis.consensus}`,
      );
    }
  }
  return lines.join("\n").slice(-6000);
}

/** 发散模式不向成员注入历史（盲答）；定向注入完整历史 */
export function historyTextForReplyMode(
  mode: ChatRoundMode,
  historyText: string,
): string | undefined {
  return mode === "diverge" ? undefined : historyText || undefined;
}

/** 根据并行结果与总结成败解析轮次终态 */
export function resolveChatRoundStatus(input: {
  okCount: number;
  failCount: number;
  synthesizeFailed?: boolean;
}): ChatRound["status"] {
  let status: ChatRound["status"] =
    input.failCount === 0
      ? "completed"
      : input.okCount > 0
        ? "partial"
        : "failed";
  if (input.synthesizeFailed && status === "completed") {
    status = "partial";
  }
  return status;
}
