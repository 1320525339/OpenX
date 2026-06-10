import { describe, expect, it } from "vitest";
import { buildNextStepsUserMessage } from "./next-steps.js";

describe("buildNextStepsUserMessage", () => {
  const northStar = {
    id: "n1",
    title: "搭建登录模块",
    status: "进行中",
    progress: 40,
    executorId: "pi",
    acceptance: "用户可登录",
  };

  const focus = {
    id: "g1",
    title: "写 API",
    status: "已完成",
    progress: 100,
    executorId: "pi",
    resultSummary: "POST /login OK",
  };

  it("builds approve follow-up prompt", () => {
    const msg = buildNextStepsUserMessage(focus, northStar, [focus], "approve");
    expect(msg).toContain("验收通过");
    expect(msg).toContain("搭建登录模块");
    expect(msg).toContain("refined.subGoals");
  });

  it("builds rework planning prompt", () => {
    const msg = buildNextStepsUserMessage(
      { ...focus, reworkReason: "缺少错误处理" },
      northStar,
      [focus],
      "rework",
    );
    expect(msg).toContain("返工规划");
    expect(msg).toContain("缺少错误处理");
  });
});
