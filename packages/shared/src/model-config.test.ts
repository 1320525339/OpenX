import { describe, expect, it } from "vitest";
import { SettingsSchema } from "./settings.js";
import {
  DEFAULT_MODEL_REF,
  deleteProvider,
  formatModelRef,
  parseModelRef,
  providerConfigFromTemplate,
  resolveModelCredentials,
  upgradeToModelConfig,
  upsertProvider,
} from "./model-config.js";

describe("parseModelRef", () => {
  it("parses slug and modelId", () => {
    expect(parseModelRef("zen/big-pickle")).toEqual({
      slug: "zen",
      modelId: "big-pickle",
    });
  });

  it("supports modelId with slashes", () => {
    expect(parseModelRef("router/openai/gpt-4o-mini")).toEqual({
      slug: "router",
      modelId: "openai/gpt-4o-mini",
    });
  });
});

describe("upgradeToModelConfig", () => {
  it("migrates legacy coach to providers", () => {
    const raw = SettingsSchema.parse({
      coach: {
        provider: "llm",
        providerId: "opencode-zen",
        preset: "opencode-zen-free",
        model: "big-pickle",
      },
    });
    const upgraded = upgradeToModelConfig(raw);
    expect(upgraded.providers?.["opencode-zen"] ?? upgraded.providers?.zen).toBeTruthy();
    expect(upgraded.model?.coach).toContain("big-pickle");
  });

  it("defaults to zen when empty", () => {
    const upgraded = upgradeToModelConfig(SettingsSchema.parse({}));
    expect(upgraded.providers?.zen).toBeTruthy();
    expect(upgraded.model?.coach).toBe(DEFAULT_MODEL_REF);
  });
});

describe("upsertProvider / deleteProvider", () => {
  it("adds provider to map", () => {
    const base = upgradeToModelConfig(SettingsSchema.parse({}));
    const config = providerConfigFromTemplate("openai", {
      auth: { apiKey: "sk-test" },
    });
    const next = upsertProvider(base, "corp-openai", config);
    expect(next.providers?.["corp-openai"]).toBeTruthy();
  });

  it("removes provider key from json shape", () => {
    const base = upgradeToModelConfig(SettingsSchema.parse({}));
    const config = providerConfigFromTemplate("openai");
    const withProvider = upsertProvider(base, "corp-openai", config);
    const removed = deleteProvider(withProvider, "corp-openai");
    expect(removed.providers?.["corp-openai"]).toBeUndefined();
  });

  it("retargets model ref when deleting active slug", () => {
    const base = upgradeToModelConfig(SettingsSchema.parse({}));
    const config = providerConfigFromTemplate("openai", {
      auth: { apiKey: "sk-test" },
    });
    const withProvider = upsertProvider(base, "corp-openai", config);
    const ref = formatModelRef("corp-openai", "gpt-4o-mini");
    const active = {
      ...withProvider,
      model: { coach: ref, pi: ref, default: ref },
    };
    const removed = deleteProvider(active, "corp-openai");
    expect(removed.model?.coach).not.toContain("corp-openai");
  });
});

describe("resolveModelCredentials", () => {
  it("resolves zen public key", () => {
    const settings = upgradeToModelConfig(SettingsSchema.parse({}));
    const creds = resolveModelCredentials(settings, DEFAULT_MODEL_REF);
    expect(creds?.apiKey).toBe("public");
    expect(creds?.baseUrl).toContain("opencode.ai");
  });
});
