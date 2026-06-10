import { describe, expect, it } from "vitest";
import {
  detectGoalIntent,
  isClearRuleWinner,
  recommendExecutorId,
} from "./executor-recommend.js";

describe("detectGoalIntent", () => {
  it("detects web intent", () => {
    expect(detectGoalIntent("抓取 https://example.com 页面内容")).toBe("web");
  });

  it("detects local intent", () => {
    expect(detectGoalIntent("列出工作目录下的文件")).toBe("local");
  });
});

describe("recommendExecutorId", () => {
  it("prefers connect agent with obscura skills for web tasks", () => {
    const rec = recommendExecutorId(
      [
        { executorId: "pi", available: true, enabledSkillIds: ["filesystem", "shell"] },
        {
          executorId: "my-agent",
          available: true,
          enabledSkillIds: ["obscura-fetch", "obscura-scrape"],
        },
      ],
      "web",
    );
    expect(rec?.executorId).toBe("my-agent");
    expect(rec?.reason).toContain("Obscura");
  });

  it("prefers pi for local tasks", () => {
    const rec = recommendExecutorId(
      [
        { executorId: "pi", available: true, enabledSkillIds: ["filesystem", "shell"] },
        { executorId: "my-agent", available: true, enabledSkillIds: [] },
      ],
      "local",
    );
    expect(rec?.executorId).toBe("pi");
  });
});

describe("isClearRuleWinner", () => {
  it("returns true when score gap >= 5", () => {
    const rec = recommendExecutorId(
      [
        { executorId: "pi", available: true, enabledSkillIds: ["filesystem"] },
        {
          executorId: "agent",
          available: true,
          enabledSkillIds: ["obscura-fetch"],
        },
      ],
      "web",
    );
    expect(rec).not.toBeNull();
    if (rec) expect(isClearRuleWinner(rec)).toBe(true);
  });
});
