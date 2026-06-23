import type { ChatThreadItem } from "./chat-thread";

export const CHAT_HOT_TURNS = 20;
export const CHAT_WARM_PAGE_SIZE = 15;
export const CHAT_QUESTION_NAV_MIN = 2;

export type ChatTurnGroup = {
  turn: number;
  anchorKey: string;
  anchorText: string;
  startIdx: number;
  endIdx: number;
  preview: string;
  itemCount: number;
};

export type ChatQuestionAnchor = {
  id: string;
  text: string;
  turn: number;
};

export function chatTurnAnchorId(key: string): string {
  return `chat-turn-anchor-${key}`;
}

export function compactChatQuestionText(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 80) return cleaned;
  return `${cleaned.slice(0, 77)}…`;
}

function deriveTurnPreview(slice: ChatThreadItem[]): string {
  for (let i = slice.length - 1; i >= 0; i -= 1) {
    const it = slice[i]!;
    if (it.kind === "message" && it.message.role === "coach") {
      const t = it.message.text.trim();
      if (t) return compactChatQuestionText(t);
    }
    if (it.kind === "refined") return it.refined.title;
    if (it.kind === "clarify") return it.clarify.title ?? "澄清问题";
    if (it.kind === "execution") return it.pin.goalTitle;
    if (it.kind === "crew_exchange") return compactChatQuestionText(it.exchange.summary);
  }
  return "";
}

/** 以用户消息为锚点划分对话轮次 */
export function buildChatTurnGroups(items: ChatThreadItem[]): ChatTurnGroup[] {
  const groups: ChatTurnGroup[] = [];
  let turnStart = -1;

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]!;
    const isUser = item.kind === "message" && item.message.role === "user";
    if (!isUser) continue;

    if (turnStart >= 0 && groups.length > 0) {
      groups[groups.length - 1]!.endIdx = i;
    }
    turnStart = i;
    groups.push({
      turn: groups.length,
      anchorKey: item.key,
      anchorText: compactChatQuestionText(item.message.text),
      startIdx: i,
      endIdx: items.length,
      preview: "",
      itemCount: 0,
    });
  }

  for (let g = 0; g < groups.length; g += 1) {
    const group = groups[g]!;
    const nextStart = g + 1 < groups.length ? groups[g + 1]!.startIdx : items.length;
    group.endIdx = nextStart;
    group.itemCount = group.endIdx - group.startIdx;
    group.preview = deriveTurnPreview(items.slice(group.startIdx, group.endIdx));
  }

  if (groups.length === 0 && items.length > 0) {
    return [
      {
        turn: 0,
        anchorKey: items[0]!.key,
        anchorText: "对话开始",
        startIdx: 0,
        endIdx: items.length,
        preview: deriveTurnPreview(items),
        itemCount: items.length,
      },
    ];
  }

  if (groups.length > 0 && groups[0]!.startIdx > 0) {
    const preambleEnd = groups[0]!.startIdx;
    groups.unshift({
      turn: 0,
      anchorKey: items[0]!.key,
      anchorText: "对话开始",
      startIdx: 0,
      endIdx: preambleEnd,
      preview: deriveTurnPreview(items.slice(0, preambleEnd)),
      itemCount: preambleEnd,
    });
    groups.forEach((group, idx) => {
      group.turn = idx;
    });
  }

  return groups;
}

export type TranscriptZonePlan = {
  coldGroups: ChatTurnGroup[];
  warmGroups: ChatTurnGroup[];
  hotItems: ChatThreadItem[];
  hotStartIdx: number;
  questionAnchors: ChatQuestionAnchor[];
};

export function planTranscriptZones(
  items: ChatThreadItem[],
  opts: { hotTurns: number; warmPagesLoaded: number; warmPageSize: number },
): TranscriptZonePlan {
  const groups = buildChatTurnGroups(items);
  if (groups.length === 0) {
    return {
      coldGroups: [],
      warmGroups: [],
      hotItems: items,
      hotStartIdx: 0,
      questionAnchors: [],
    };
  }

  const hotGroupStart = Math.max(0, groups.length - opts.hotTurns);
  const hotStartIdx = groups[hotGroupStart]?.startIdx ?? 0;
  const warmGroupsAll = groups.slice(0, hotGroupStart);
  const visibleWarmCount = opts.warmPagesLoaded * opts.warmPageSize;
  const coldHiddenCount = Math.max(0, warmGroupsAll.length - visibleWarmCount);
  const coldGroups = warmGroupsAll.slice(0, coldHiddenCount);
  const warmGroups = warmGroupsAll.slice(coldHiddenCount);
  const hotItems = items.slice(hotStartIdx);

  const questionAnchors: ChatQuestionAnchor[] = groups
    .filter((g) => {
      const first = items[g.startIdx];
      return first?.kind === "message" && first.message.role === "user";
    })
    .map((g) => ({
      id: chatTurnAnchorId(g.anchorKey),
      text: g.anchorText,
      turn: g.turn,
    }));

  return {
    coldGroups,
    warmGroups,
    hotItems,
    hotStartIdx,
    questionAnchors,
  };
}

export function hasMoreColdHistory(
  items: ChatThreadItem[],
  warmPagesLoaded: number,
  warmPageSize: number = CHAT_WARM_PAGE_SIZE,
  hotTurns: number = CHAT_HOT_TURNS,
): boolean {
  const groups = buildChatTurnGroups(items);
  const hotGroupStart = Math.max(0, groups.length - hotTurns);
  const warmGroupsAll = groups.slice(0, hotGroupStart);
  return warmGroupsAll.length > warmPagesLoaded * warmPageSize;
}
