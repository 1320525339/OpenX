import { describe, expect, it } from "vitest";
import {
  applyOpencodeZenFreePreset,
  CoachSettingsSchema,
  DEFAULT_COACH_SETTINGS,
  OPENCODE_ZEN_BASE_URL,
  OPENCODE_ZEN_DEFAULT_FREE_MODEL,
  OPENCODE_ZEN_PUBLIC_API_KEY,
  resolveCoachSettings,
  upgradeLegacyCoachSettings,
} from "./coach-settings.js";

describe("applyOpencodeZenFreePreset", () => {
  it("sets llm provider and zen endpoint", () => {
    const coach = applyOpencodeZenFreePreset();
    expect(coach.provider).toBe("llm");
    expect(coach.preset).toBe("opencode-zen-free");
    expect(coach.baseUrl).toBe(OPENCODE_ZEN_BASE_URL);
    expect(coach.apiKey).toBe(OPENCODE_ZEN_PUBLIC_API_KEY);
    expect(coach.model).toBe(OPENCODE_ZEN_DEFAULT_FREE_MODEL);
  });

  it("keeps valid free model when switching", () => {
    const coach = applyOpencodeZenFreePreset({ model: "deepseek-v4-flash-free" });
    expect(coach.model).toBe("deepseek-v4-flash-free");
  });
});

describe("DEFAULT_COACH_SETTINGS", () => {
  it("defaults to zen free llm", () => {
    expect(DEFAULT_COACH_SETTINGS.provider).toBe("llm");
    expect(DEFAULT_COACH_SETTINGS.providerId).toBe("opencode-zen");
    expect(DEFAULT_COACH_SETTINGS.preset).toBe("opencode-zen-free");
  });
});

describe("upgradeLegacyCoachSettings", () => {
  it("upgrades rules+custom without api key", () => {
    const upgraded = upgradeLegacyCoachSettings(
      CoachSettingsSchema.parse({ provider: "rules", preset: "custom" }),
    );
    expect(upgraded.preset).toBe("opencode-zen-free");
    expect(upgraded.provider).toBe("llm");
  });

  it("upgrades rules even with api key", () => {
    const coach = CoachSettingsSchema.parse({
      provider: "rules",
      preset: "custom",
      apiKey: "sk-test",
    });
    const upgraded = upgradeLegacyCoachSettings(coach);
    expect(upgraded.provider).toBe("llm");
    expect(upgraded.preset).toBe("opencode-zen-free");
  });
});

describe("resolveCoachSettings", () => {
  it("fills public key for zen preset", () => {
    const resolved = resolveCoachSettings(
      CoachSettingsSchema.parse({
        preset: "opencode-zen-free",
        provider: "llm",
        apiKey: undefined,
      }),
    );
    expect(resolved.apiKey).toBe("public");
    expect(resolved.baseUrl).toContain("opencode.ai");
  });

  it("drops zen public key on non-zen providers", () => {
    const resolved = resolveCoachSettings(
      CoachSettingsSchema.parse({
        provider: "llm",
        providerId: "openai",
        preset: "custom",
        apiKey: "public",
      }),
    );
    expect(resolved.apiKey).toBeUndefined();
    expect(resolved.providerId).toBe("openai");
  });
});
