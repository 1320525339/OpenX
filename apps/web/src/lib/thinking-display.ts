export type ThinkingDisplayOptions = {
  /** 紧凑模式（聊天流内嵌） */
  compact?: boolean;
  maxChars?: number;
  maxLines?: number;
};

const DEFAULT_MAX_CHARS = 2000;
const DEFAULT_COMPACT_CHARS = 1200;
const DEFAULT_MAX_LINES = 240;
const DEFAULT_COMPACT_LINES = 120;

/** 流式思维链展示：按行/字符保留尾部，避免 DOM 膨胀（Reasonix reasoningDisplay 思路） */
export function formatThinkingDisplay(
  text: string,
  options: ThinkingDisplayOptions = {},
): string {
  if (!text) return "";
  const compact = options.compact ?? false;
  const maxChars = options.maxChars ?? (compact ? DEFAULT_COMPACT_CHARS : DEFAULT_MAX_CHARS);
  const maxLines = options.maxLines ?? (compact ? DEFAULT_COMPACT_LINES : DEFAULT_MAX_LINES);

  let out = text;
  const lines = out.split("\n");
  if (lines.length > maxLines) {
    out = lines.slice(-maxLines).join("\n");
  }
  if (out.length > maxChars) {
    out = `…${out.slice(-maxChars)}`;
  }
  return out;
}

/** 折叠摘要文案 */
export function thinkingSummaryLabel(text: string, active: boolean): string {
  if (active) return "思考中…";
  const chars = text.length;
  const lines = text.split("\n").length;
  if (lines > 1) return `思考（${lines} 段 · ${chars} 字）`;
  return `思考（${chars} 字）`;
}
