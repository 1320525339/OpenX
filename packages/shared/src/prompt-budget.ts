/** 粗略 token 估算（中英混合场景，对齐 MiMo checkpoint 预算思路） */
export function estimatePromptTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.5);
}

export function clipPromptText(
  text: string,
  maxTokens: number,
  truncateNote = "…（内容已按预算截断）",
): string {
  const trimmed = text.trim();
  if (!trimmed || maxTokens <= 0) return trimmed;
  if (estimatePromptTokens(trimmed) <= maxTokens) return trimmed;

  const maxChars = Math.max(80, Math.floor(maxTokens * 3.5 * 0.92));
  if (trimmed.length <= maxChars) return trimmed;

  const cut = trimmed.slice(0, maxChars);
  const lastNl = cut.lastIndexOf("\n");
  const body = lastNl > maxChars * 0.5 ? cut.slice(0, lastNl) : cut;
  return `${body}\n${truncateNote}`;
}

/**
 * 在 token 预算内拼接列表：优先保留首条与最近条目（审查首轮 + 最新反馈）。
 */
export function clipPromptList(
  items: string[],
  maxTokens: number,
  opts?: { joiner?: string; keepFirst?: boolean },
): string {
  if (items.length === 0) return "";
  const joiner = opts?.joiner ?? "\n\n";
  const keepFirst = opts?.keepFirst ?? true;

  const picked: string[] = [];
  const indices: number[] = [];
  if (keepFirst && items.length > 0) indices.push(0);
  for (let i = items.length - 1; i >= (keepFirst ? 1 : 0); i -= 1) {
    indices.push(i);
  }

  const seen = new Set<number>();
  for (const idx of indices) {
    if (seen.has(idx)) continue;
    seen.add(idx);
    const candidate = [...picked, items[idx]!].join(joiner);
    if (estimatePromptTokens(candidate) > maxTokens && picked.length > 0) break;
    picked.push(items[idx]!);
    if (estimatePromptTokens(picked.join(joiner)) > maxTokens) {
      picked[picked.length - 1] = clipPromptText(
        picked[picked.length - 1]!,
        Math.max(200, Math.floor(maxTokens / Math.max(1, picked.length))),
      );
      break;
    }
  }

  return picked
    .sort((a, b) => items.indexOf(a) - items.indexOf(b))
    .join(joiner);
}
