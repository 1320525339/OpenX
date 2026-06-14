import { describe, expect, it } from "vitest";
import { predictAudienceProfile } from "./llm-audience.js";
import { buildLlmRuntimeSnapshot } from "./llm-runtime-snapshot.js";

describe("llm-runtime-snapshot", () => {
  it("predicts operator audience for API messages", () => {
    const profile = predictAudienceProfile("帮我 bootstrap connect", {});
    expect(profile.label).toContain("操作者");
  });

  it("builds snapshot with time and catalog count", () => {
    const snapshot = buildLlmRuntimeSnapshot({
      context: {
        workspaceRoot: "/tmp/proj",
        executors: ["pi", "acp:codex"],
        operatorTier: "operator",
      },
      message: "列出所有 API",
      baseUrl: "http://127.0.0.1:3921",
      clientTimezone: "UTC",
      clientLocale: "zh-CN",
    });
    expect(snapshot.catalogEndpointCount).toBeGreaterThan(50);
    expect(snapshot.executorsSummary).toContain("pi");
    expect(snapshot.audienceLabel).toContain("操作者");
    expect(snapshot.nowIso).toMatch(/^\d{4}-/);
  });
});
