import { describe, expect, it } from "vitest";
import {
  buildClaudeAcpEnv,
  normalizeClaudeAnthropicBaseUrl,
} from "./acp-cli-config.js";

describe("normalizeClaudeAnthropicBaseUrl", () => {
  it("strips trailing /v1 for Claude Code", () => {
    expect(normalizeClaudeAnthropicBaseUrl("https://opencode.ai/zen/v1")).toBe(
      "https://opencode.ai/zen",
    );
    expect(normalizeClaudeAnthropicBaseUrl("https://api.anthropic.com/v1")).toBe(
      "https://api.anthropic.com",
    );
  });
});

describe("buildClaudeAcpEnv", () => {
  it("maps OpenCode Zen to Anthropic Messages + custom model aliases", () => {
    const env = buildClaudeAcpEnv(
      {
        apiKey: "public",
        baseUrl: "https://opencode.ai/zen/v1",
        model: "big-pickle",
      },
      { providerTemplate: "opencode-zen" },
    );
    expect(env.ANTHROPIC_BASE_URL).toBe("https://opencode.ai/zen");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("public");
    expect(env.ANTHROPIC_MODEL).toBe("big-pickle");
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("big-pickle");
    expect(env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS).toBe("1");
  });

  it("uses API key auth for anthropic provider", () => {
    const env = buildClaudeAcpEnv({
      apiKey: "sk-ant-test",
      baseUrl: "https://api.anthropic.com",
      model: "claude-sonnet-4-20250514",
    });
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-test");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.ANTHROPIC_BASE_URL).toBe("https://api.anthropic.com");
  });

  it("maps DeepSeek anthropic endpoint for Claude Code", () => {
    const env = buildClaudeAcpEnv({
      apiKey: "ds-key",
      baseUrl: "https://api.deepseek.com/anthropic",
      model: "deepseek-v4-pro",
    });
    expect(env.ANTHROPIC_BASE_URL).toBe("https://api.deepseek.com/anthropic");
    expect(env.ANTHROPIC_API_KEY).toBe("ds-key");
  });
});
