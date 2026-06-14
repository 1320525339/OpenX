import { describe, expect, it } from "vitest";
import {
  isAcpClaudeEligibleProvider,
  normalizeOpenAiCompatibleBaseUrl,
  resolveAnthropicMessagesBaseUrl,
} from "./llm-endpoints.js";
import type { ProviderConfig } from "./model-config.js";

describe("normalizeOpenAiCompatibleBaseUrl", () => {
  it("keeps DeepSeek at root without /v1 per official docs", () => {
    expect(normalizeOpenAiCompatibleBaseUrl("https://api.deepseek.com/v1", "deepseek")).toBe(
      "https://api.deepseek.com",
    );
    expect(normalizeOpenAiCompatibleBaseUrl("https://api.deepseek.com", "deepseek")).toBe(
      "https://api.deepseek.com",
    );
  });

  it("strips /anthropic suffix from DeepSeek OpenAI base", () => {
    expect(
      normalizeOpenAiCompatibleBaseUrl("https://api.deepseek.com/anthropic", "deepseek"),
    ).toBe("https://api.deepseek.com");
  });

  it("appends /v1 for generic OpenAI-compatible hosts", () => {
    expect(normalizeOpenAiCompatibleBaseUrl("https://api.openai.com")).toBe(
      "https://api.openai.com/v1",
    );
  });
});

describe("resolveAnthropicMessagesBaseUrl", () => {
  it("maps DeepSeek OpenAI base to /anthropic for Claude Code", () => {
    expect(
      resolveAnthropicMessagesBaseUrl("https://api.deepseek.com/v1", "deepseek"),
    ).toBe("https://api.deepseek.com/anthropic");
  });

  it("normalizes zen /v1 to anthropic root", () => {
    expect(
      resolveAnthropicMessagesBaseUrl("https://opencode.ai/zen/v1", "opencode-zen"),
    ).toBe("https://opencode.ai/zen");
  });

  it("preserves explicit anthropic gateway path", () => {
    expect(
      resolveAnthropicMessagesBaseUrl(
        "https://token-plan-sgp.xiaomimimo.com/anthropic",
        "anthropic",
      ),
    ).toBe("https://token-plan-sgp.xiaomimimo.com/anthropic");
  });
});

describe("isAcpClaudeEligibleProvider", () => {
  const base: ProviderConfig = {
    name: "Test",
    api: { type: "openai-compatible", baseUrl: "https://api.openai.com/v1" },
    models: { m: { name: "m" } },
  };

  it("allows deepseek and zen", () => {
    expect(
      isAcpClaudeEligibleProvider({
        ...base,
        api: { type: "openai-compatible", baseUrl: "https://api.deepseek.com" },
        source: { template: "deepseek" },
      }),
    ).toBe(true);
    expect(
      isAcpClaudeEligibleProvider({
        ...base,
        api: { type: "openai-compatible", baseUrl: "https://opencode.ai/zen/v1" },
        source: { template: "opencode-zen" },
      }),
    ).toBe(true);
  });

  it("rejects pure openai template", () => {
    expect(
      isAcpClaudeEligibleProvider({
        ...base,
        source: { template: "openai" },
      }),
    ).toBe(false);
  });
});
