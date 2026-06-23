import { describe, expect, it } from "vitest";
import type { ChatThreadItem } from "./chat-thread";
import {
  buildChatTurnGroups,
  chatTurnAnchorId,
  compactChatQuestionText,
  hasMoreColdHistory,
  planTranscriptZones,
} from "./chat-transcript-zones";

function userMsg(key: string, text: string): ChatThreadItem {
  return {
    kind: "message",
    key,
    message: { role: "user", text, timestamp: "2026-01-01T00:00:00.000Z" },
  };
}

function coachMsg(key: string, text: string): ChatThreadItem {
  return {
    kind: "message",
    key,
    message: { role: "coach", text, timestamp: "2026-01-01T00:01:00.000Z" },
  };
}

describe("buildChatTurnGroups", () => {
  it("splits on user messages", () => {
    const items = [
      userMsg("u1", "第一个问题"),
      coachMsg("c1", "好的"),
      userMsg("u2", "第二个问题"),
      coachMsg("c2", "收到"),
    ];
    const groups = buildChatTurnGroups(items);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.anchorText).toBe("第一个问题");
    expect(groups[1]?.anchorText).toBe("第二个问题");
    expect(groups[0]?.endIdx).toBe(2);
  });
});

describe("planTranscriptZones", () => {
  it("keeps recent turns in hot zone", () => {
    const items: ChatThreadItem[] = [];
    for (let i = 0; i < 25; i += 1) {
      items.push(userMsg(`u${i}`, `question ${i}`));
      items.push(coachMsg(`c${i}`, `answer ${i}`));
    }
    const plan = planTranscriptZones(items, {
      hotTurns: 20,
      warmPagesLoaded: 1,
      warmPageSize: 15,
    });
    expect(plan.hotItems.length).toBeLessThan(items.length);
    expect(plan.hotItems[0]?.key).toBe("u5");
    expect(plan.questionAnchors.length).toBe(25);
  });
});

describe("compactChatQuestionText", () => {
  it("truncates long questions", () => {
    expect(compactChatQuestionText("x".repeat(100)).length).toBeLessThanOrEqual(80);
  });
});

describe("hasMoreColdHistory", () => {
  it("returns true when warm groups exceed loaded pages", () => {
    const items: ChatThreadItem[] = [];
    for (let i = 0; i < 40; i += 1) {
      items.push(userMsg(`u${i}`, `q${i}`));
    }
    expect(hasMoreColdHistory(items, 1, 15, 20)).toBe(true);
  });
});

describe("chatTurnAnchorId", () => {
  it("prefixes anchor keys", () => {
    expect(chatTurnAnchorId("msg-1")).toBe("chat-turn-anchor-msg-1");
  });
});
