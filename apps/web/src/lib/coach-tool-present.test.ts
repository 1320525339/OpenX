import { describe, expect, it } from "vitest";
import { summarizeCoachTool } from "./coach-tool-present";

describe("summarizeCoachTool", () => {
  it("summarizes propose_work_order refined payload", () => {
    const summary = summarizeCoachTool(
      "propose_work_order",
      JSON.stringify({
        action: "refined",
        refined: {
          title: "修复 sidecar 启动",
          acceptance: "bootstrap 返回 200",
          executionPrompt: "检查 pkg 打包依赖",
          subGoals: [{ title: "a" }, { title: "b" }],
        },
      }),
    );
    expect(summary.headline).toBe("修复 sidecar 启动");
    expect(summary.details.some((d) => d.includes("验收"))).toBe(true);
    expect(summary.details.some((d) => d.includes("子任务：2 项"))).toBe(true);
  });

  it("summarizes propose_clarification with first question", () => {
    const summary = summarizeCoachTool(
      "propose_clarification",
      JSON.stringify({
        clarify: {
          title: "确认范围",
          questions: [{ id: "q1", prompt: "要做到哪一步？" }],
        },
      }),
    );
    expect(summary.headline).toBe("确认范围");
    expect(summary.details.some((d) => d.includes("共 1 题"))).toBe(true);
    expect(summary.details.some((d) => d.includes("要做到哪一步"))).toBe(true);
  });

  it("marks incomplete streaming payloads", () => {
    const summary = summarizeCoachTool(
      "propose_work_order",
      '{ "refined": { "title": "进行中',
      true,
    );
    expect(summary.incomplete).toBe(true);
  });
});
