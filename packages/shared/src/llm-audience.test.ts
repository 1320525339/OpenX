import { describe, expect, it } from "vitest";
import { DEFAULT_LLM_AUDIENCE_RULES, predictAudienceProfile } from "./llm-audience.js";

describe("llm-audience", () => {
  it("uses default rules when no custom config", () => {
    const profile = predictAudienceProfile("列出所有 API", {});
    expect(profile.matchedRuleId).toBe("operator");
  });

  it("allows custom rules via settings", () => {
    const profile = predictAudienceProfile("hello", {}, {
      audienceRules: [
        {
          id: "custom",
          label: "自定义用户",
          summary: "测试",
          messagePattern: "hello",
          priority: 200,
        },
      ],
    });
    expect(profile.label).toBe("自定义用户");
  });

  it("ships built-in rules", () => {
    expect(DEFAULT_LLM_AUDIENCE_RULES.length).toBeGreaterThan(3);
  });
});
