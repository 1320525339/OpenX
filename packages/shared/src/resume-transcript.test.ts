import { describe, expect, it } from "vitest";
import {
  buildResumeTranscriptBlock,
  prependResumeTranscript,
} from "./resume-transcript.js";

describe("buildResumeTranscriptBlock", () => {
  it("returns undefined when empty", () => {
    expect(buildResumeTranscriptBlock({})).toBeUndefined();
  });

  it("includes crew exchanges and summaries", () => {
    const block = buildResumeTranscriptBlock({
      crewExchanges: [
        { direction: "crew_to_foreman", summary: "是否先读源码？" },
        { direction: "foreman_to_crew", summary: "先读再写" },
      ],
      priorSummaries: ["完成了路由解析"],
      priorLogs: [{ level: "info", message: "启动 ACP" }],
    });
    expect(block).toContain("续跑上下文");
    expect(block).toContain("施工队 → 工头");
    expect(block).toContain("是否先读源码？");
    expect(block).toContain("历史执行摘要");
    expect(block).toContain("完成了路由解析");
    expect(block).toContain("启动 ACP");
  });
});

describe("prependResumeTranscript", () => {
  it("returns prompt when transcript empty", () => {
    expect(prependResumeTranscript("do work", null)).toBe("do work");
    expect(prependResumeTranscript("do work", "  ")).toBe("do work");
  });

  it("puts transcript before prompt", () => {
    expect(prependResumeTranscript("【开发商】继续", "【续跑上下文】\n历史")).toBe(
      "【续跑上下文】\n历史\n\n【开发商】继续",
    );
  });
});
