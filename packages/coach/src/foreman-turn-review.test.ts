import { describe, expect, it } from "vitest";
import { buildForemanTurnReviewUserPrompt } from "./foreman-turn-review.js";

describe("buildForemanTurnReviewUserPrompt", () => {
  it("includes goal, acceptance and crew turn output", () => {
    const prompt = buildForemanTurnReviewUserPrompt({
      goal: {
        id: "g1",
        title: "登录页",
        acceptance: "单元测试通过",
        executionPrompt: "实现 OAuth",
      },
      turn: {
        assistantText: "已搭骨架，还差表单校验。",
        summary: "进行中",
        round: 1,
      },
    });
    expect(prompt).toContain("登录页");
    expect(prompt).toContain("单元测试通过");
    expect(prompt).toContain("已搭骨架");
    expect(prompt).toContain("循环轮次: 2");
    expect(prompt).toContain("JSON");
  });
});
