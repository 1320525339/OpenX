import { describe, expect, it } from "vitest";
import {
  inferProviderEnvKey,
  mergeDotEnvContent,
  parseDotEnv,
  sanitizeProviderForDisk,
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
});
