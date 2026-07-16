import {
  ROUNDTABLE_ALL_PARTICIPANTS_ID,
  type ConversationParticipant,
} from "@openx/shared";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 从输入解析 @mention，返回清洗后的正文与 participant ids（含 `__all__`） */
export function parseRoundtableMentions(
  text: string,
  participants: Pick<ConversationParticipant, "id" | "displayName">[],
): { cleanMessage: string; mentionIds: string[] } {
  const mentionIds: string[] = [];
  let clean = text;
  // 中文名不用 \\b（CJK 不产生 word boundary）
  if (/@全体(?=$|\s|[，,、])/.test(clean) || /@all(?=$|\s|[，,、])/i.test(clean)) {
    mentionIds.push(ROUNDTABLE_ALL_PARTICIPANTS_ID);
    clean = clean.replace(/@全体(?=$|\s|[，,、])/g, "").replace(/@all(?=$|\s|[，,、])/gi, "");
  }
  // 按出现顺序收集，长名优先匹配以免短名抢占
  const sorted = [...participants].sort(
    (a, b) => b.displayName.length - a.displayName.length,
  );
  const found: { id: string; index: number }[] = [];
  for (const p of sorted) {
    const re = new RegExp(
      `@${escapeRegExp(p.displayName)}(?=$|\\s|[，,、])`,
      "g",
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(clean)) !== null) {
      found.push({ id: p.id, index: m.index });
    }
  }
  found.sort((a, b) => a.index - b.index);
  for (const f of found) {
    if (!mentionIds.includes(f.id)) mentionIds.push(f.id);
  }
  for (const p of sorted) {
    const re = new RegExp(
      `@${escapeRegExp(p.displayName)}(?=$|\\s|[，,、])`,
      "g",
    );
    clean = clean.replace(re, "");
  }
  return {
    cleanMessage: clean.replace(/\s+/g, " ").trim(),
    mentionIds: [...new Set(mentionIds)],
  };
}
