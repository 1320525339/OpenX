type ContentBlock = { type?: string; text?: string };

function extractTextFromMessage(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const m = message as { role?: string; content?: unknown };
  if (m.role !== "assistant") return "";

  if (typeof m.content === "string") return m.content.trim();

  if (Array.isArray(m.content)) {
    return m.content
      .map((block) => {
        if (!block || typeof block !== "object") return "";
        const b = block as ContentBlock;
        if (b.type === "text" && typeof b.text === "string") return b.text;
        return "";
      })
      .join("")
      .trim();
  }

  return "";
}

/** 从 agent_end / turn_end 事件提取可读摘要 */
export function summarizePiRun(
  agentEndEvent: Record<string, unknown> | undefined,
  fallbackText: string,
  goalTitle: string,
): string {
  const fromMessages = Array.isArray(agentEndEvent?.messages)
    ? (agentEndEvent.messages as unknown[])
        .map(extractTextFromMessage)
        .filter(Boolean)
        .join("\n\n")
        .trim()
    : "";

  const body = (fromMessages || fallbackText).trim();
  if (!body) {
    return `Pi 已完成「${goalTitle}」的执行轮次。请对照验收标准确认效果。`;
  }

  const clipped = body.length > 2400 ? `${body.slice(0, 2400)}…` : body;
  return `Pi 执行摘要（${goalTitle}）：\n${clipped}`;
}
