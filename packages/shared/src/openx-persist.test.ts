import { describe, expect, it } from "vitest";
import {
  inferProviderEnvKey,
  mergeDotEnvContent,
  parseDotEnv,
  sanitizeProviderForDisk,
  sanitizeSettingsForApi,
} from "./openx-persist.js";

describe("openx-persist", () => {
  it("infers env key from template", () => {
    expect(inferProviderEnvKey("deepseek", "deepseek")).toBe("DEEPSEEK_API_KEY");
    expect(inferProviderEnvKey("mimo-sgp", "custom")).toBe("MIMO_SGP_API_KEY");
  });

  it("parses dotenv lines", () => {
    expect(
      parseDotEnv(`
# comment
DEEPSEEK_API_KEY=sk-test
export MIMO_API_KEY="tp-abc"
`),
    ).toEqual({
      DEEPSEEK_API_KEY: "sk-test",
      MIMO_API_KEY: "tp-abc",
    });
  });

  it("merges dotenv without dropping unrelated keys", () => {
    const next = mergeDotEnvContent("FOO=1\n", { DEEPSEEK_API_KEY: "sk-x" });
    expect(parseDotEnv(next)).toEqual({ FOO: "1", DEEPSEEK_API_KEY: "sk-x" });
  });

  it("sanitizes provider apiKey to env reference", () => {
    const sanitized = sanitizeProviderForDisk("deepseek", {
      name: "DeepSeek",
      api: { type: "openai-compatible", baseUrl: "https://api.deepseek.com/v1" },
      auth: { apiKey: "sk-secret" },
      models: { "deepseek-v4-flash": { name: "deepseek-v4-flash" } },
      source: { template: "deepseek" },
    });
    expect(sanitized.auth?.env).toBe("DEEPSEEK_API_KEY");
    expect(sanitized.auth?.apiKey).toBeUndefined();
  });

  it("sanitizes settings for API responses", () => {
    const sanitized = sanitizeSettingsForApi(
      {
        providers: {
          deepseek: {
            name: "DeepSeek",
            api: { type: "openai-compatible" as const, baseUrl: "https://api.deepseek.com/v1" },
            auth: { apiKey: "sk-secret", env: "DEEPSEEK_API_KEY" },
            models: { chat: {} },
          },
        },
      },
      { hasSecret: (k) => k === "DEEPSEEK_API_KEY" },
    );
    expect(sanitized.providers?.deepseek.auth?.apiKey).toBeUndefined();
    expect(sanitized.providers?.deepseek.auth?.env).toBe("DEEPSEEK_API_KEY");
    expect(sanitized.providers?.deepseek.auth?.apiKeyConfigured).toBe(true);
  });

  it("marks apiKeyConfigured false when secret missing", () => {
    const sanitized = sanitizeSettingsForApi({
      providers: {
        deepseek: {
          name: "DeepSeek",
          api: { type: "openai-compatible" as const, baseUrl: "https://api.deepseek.com/v1" },
          auth: { env: "DEEPSEEK_API_KEY" },
          models: { chat: {} },
        },
      },
    });
    expect(sanitized.providers?.deepseek.auth?.apiKeyConfigured).toBe(false);
  });

  it("strips apiKeyConfigured when writing for disk", () => {
    const sanitized = sanitizeProviderForDisk("deepseek", {
      name: "DeepSeek",
      api: { type: "openai-compatible", baseUrl: "https://api.deepseek.com/v1" },
      auth: { env: "DEEPSEEK_API_KEY", apiKeyConfigured: true },
      models: { chat: {} },
      source: { template: "deepseek" },
    });
    expect(sanitized.auth?.apiKeyConfigured).toBeUndefined();
    expect(sanitized.auth?.env).toBe("DEEPSEEK_API_KEY");
  });
});
