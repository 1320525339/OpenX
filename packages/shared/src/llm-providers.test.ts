import { describe, expect, it } from "vitest";
import { applyLlmProvider } from "./coach-settings.js";
import {
  getLlmProvider,
  inferProviderIdFromCoach,
  pickModelForProvider,
} from "./llm-providers.js";

describe("llm providers", () => {
  it("applies opencode zen defaults", () => {
    const coach = applyLlmProvider("opencode-zen");
    expect(coach.providerId).toBe("opencode-zen");
    expect(coach.baseUrl).toContain("opencode.ai");
    expect(coach.apiKey).toBe("public");
  });

  it("applies openai defaults", () => {
    const coach = applyLlmProvider("openai");
    expect(coach.baseUrl).toContain("api.openai.com");
    expect(coach.model).toBe("gpt-4o-mini");
  });

  it("does not carry zen public key when switching to openai", () => {
    const zen = applyLlmProvider("opencode-zen");
    const openai = applyLlmProvider("openai", zen);
    expect(openai.apiKey).toBeUndefined();
    expect(openai.providerId).toBe("openai");
  });

  it("infers provider from legacy preset", () => {
    expect(inferProviderIdFromCoach({ preset: "opencode-zen-free" })).toBe("opencode-zen");
  });

  it("picks valid zen model", () => {
    expect(pickModelForProvider("opencode-zen", "glm-5-free")).toBe("glm-5-free");
    expect(pickModelForProvider("opencode-zen", "gpt-4o-mini")).toBe(
      getLlmProvider("opencode-zen").defaultModel,
    );
  });

  it("keeps custom google gemini model ids", () => {
    expect(getLlmProvider("google").envVar).toBe("GOOGLE_API_KEY");
    expect(
      inferProviderIdFromCoach({
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      }),
    ).toBe("google");
    expect(pickModelForProvider("google", "gemini-3-flash")).toBe("gemini-3-flash");
  });
});
