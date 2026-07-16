import { describe, expect, it } from "vitest";
import type { CoachMessageRecord } from "@openx/shared";
import {
  formatRoundtableHistory,
  historyTextForReplyMode,
  resolveChatRoundStatus,
} from "./roundtable-logic.js";

function textMsg(
  partial: Partial<Extract<CoachMessageRecord, { kind: "text" }>> & {
    id: number;
    text: string;
  },
): Extract<CoachMessageRecord, { kind: "text" }> {
  return {
    conversationId: "c1",
    kind: "text",
    role: "coach",
    timestamp: "t",
    speakerType: "participant",
    speakerId: "p1",
    ...partial,
  };
}

describe("formatRoundtableHistory", () => {
  it("发散排除同轮 reply，保留用户与他轮", () => {
    const records: CoachMessageRecord[] = [
      textMsg({
        id: 1,
        speakerType: "user",
        speakerId: "user",
        role: "user",
        text: "问题",
      }),
      textMsg({ id: 2, roundId: "r-old", text: "旧答", speakerId: "a1" }),
      textMsg({ id: 3, roundId: "r-now", text: "同轮甲", speakerId: "a1" }),
      textMsg({ id: 4, roundId: "r-now", text: "同轮乙", speakerId: "b1" }),
    ];
    const hist = formatRoundtableHistory(records, { excludeRoundId: "r-now" });
    expect(hist).toContain("用户: 问题");
    expect(hist).toContain("a1: 旧答");
    expect(hist).not.toContain("同轮甲");
    expect(hist).not.toContain("同轮乙");
  });
});

describe("historyTextForReplyMode", () => {
  it("diverge 返回 undefined（盲答）", () => {
    expect(historyTextForReplyMode("diverge", "用户: hi")).toBeUndefined();
  });

  it("direct 注入历史", () => {
    expect(historyTextForReplyMode("direct", "用户: hi")).toBe("用户: hi");
  });
});

describe("resolveChatRoundStatus", () => {
  it("全成 → completed", () => {
    expect(resolveChatRoundStatus({ okCount: 3, failCount: 0 })).toBe("completed");
  });

  it("一成一败 → partial", () => {
    expect(resolveChatRoundStatus({ okCount: 1, failCount: 1 })).toBe("partial");
  });

  it("全败 → failed", () => {
    expect(resolveChatRoundStatus({ okCount: 0, failCount: 2 })).toBe("failed");
  });

  it("总结失败把 completed 降为 partial", () => {
    expect(
      resolveChatRoundStatus({
        okCount: 2,
        failCount: 0,
        synthesizeFailed: true,
      }),
    ).toBe("partial");
  });

  it("总结失败不改变已是 partial/failed", () => {
    expect(
      resolveChatRoundStatus({
        okCount: 1,
        failCount: 1,
        synthesizeFailed: true,
      }),
    ).toBe("partial");
    expect(
      resolveChatRoundStatus({
        okCount: 0,
        failCount: 2,
        synthesizeFailed: true,
      }),
    ).toBe("failed");
  });
});
