import { describe, expect, it, vi } from "vitest";
import { refineGoalRules } from "./rules.js";

vi.mock("./llm.js", () => ({
  refineGoalLlm: vi.fn(async () => {
    throw new Error("No object generated: could not parse the response.");
  }),
  coachAgentReplyLlm: vi.fn(),
  resolveLlmCredentials: vi.fn(() => ({
    apiKey: "k",
    baseUrl: "https://example.com/v1",
    model: "test",
  })),
}));

import { refineGoal } from "./service.js";

describe("refineGoal parse fallback", () => {
  it("falls back to rules with parse_failed hint", async () => {
    const result = await refineGoal(
      { userDraft: "接入登录 API\n验收：接口 200" },
      {
        model: { coach: "x/y", pi: "x/y", default: "x/y" },
        providers: {},
      },
      ["全局约束"],
    );
    expect(result.refined.title).toContain("接入登录");
    expect(result.refined.executionPrompt).toContain("【任务】");
    expect(result.llmError).toContain("规则引擎兜底");
    expect(result.refined).toEqual(
      refineGoalRules(
        { userDraft: "接入登录 API\n验收：接口 200" },
        ["全局约束"],
      ),
    );
  });
});
