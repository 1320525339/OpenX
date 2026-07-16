import { describe, expect, it } from "vitest";
import { ROUNDTABLE_ALL_PARTICIPANTS_ID } from "@openx/shared";
import { parseRoundtableMentions } from "./roundtable-mentions";

describe("parseRoundtableMentions", () => {
  const parts = [
    { id: "a1", displayName: "架构师" },
    { id: "p1", displayName: "产品" },
    { id: "pm", displayName: "产品经理" },
  ];

  it("解析单个 @", () => {
    const r = parseRoundtableMentions("请 @架构师 看看方案", parts);
    expect(r.mentionIds).toEqual(["a1"]);
    expect(r.cleanMessage).toBe("请 看看方案");
  });

  it("解析 @全体", () => {
    const r = parseRoundtableMentions("@全体 发散一下", parts);
    expect(r.mentionIds).toEqual([ROUNDTABLE_ALL_PARTICIPANTS_ID]);
    expect(r.cleanMessage).toBe("发散一下");
  });

  it("解析 @all 大小写", () => {
    const r = parseRoundtableMentions("@ALL 一起看", parts);
    expect(r.mentionIds).toEqual([ROUNDTABLE_ALL_PARTICIPANTS_ID]);
    expect(r.cleanMessage).toBe("一起看");
  });

  it("多个 mention 去重并清洗正文", () => {
    const r = parseRoundtableMentions("@产品 @架构师 @产品 一起评", parts);
    expect(r.mentionIds).toEqual(["p1", "a1"]);
    expect(r.cleanMessage).toBe("一起评");
  });

  it("长名优先于短名前缀", () => {
    const r = parseRoundtableMentions("@产品经理 评审", parts);
    expect(r.mentionIds).toEqual(["pm"]);
    expect(r.cleanMessage).toBe("评审");
  });

  it("空串与仅空白", () => {
    expect(parseRoundtableMentions("", parts)).toEqual({
      cleanMessage: "",
      mentionIds: [],
    });
    expect(parseRoundtableMentions("   ", parts)).toEqual({
      cleanMessage: "",
      mentionIds: [],
    });
  });

  it("句号后不匹配（分隔符外）", () => {
    const r = parseRoundtableMentions("@架构师。继续", parts);
    expect(r.mentionIds).toEqual([]);
    expect(r.cleanMessage).toContain("@架构师");
  });
});
