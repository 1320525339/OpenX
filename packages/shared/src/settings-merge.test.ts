import { describe, expect, it } from "vitest";
import { SettingsSchema } from "./settings.js";
import { mergeSettingsForSave, mergeSettingsPatch } from "./settings-merge.js";

function baseSettings() {
  return SettingsSchema.parse({
    providers: {
      zen: {
        name: "Zen",
        api: { type: "openai-compatible", baseUrl: "https://opencode.ai/zen/v1" },
        auth: { apiKey: "public" },
        models: { "big-pickle": { name: "big-pickle" } },
      },
    },
    model: { coach: "zen/big-pickle", pi: "zen/big-pickle", default: "zen/big-pickle" },
  });
}

describe("mergeSettingsPatch", () => {
  it("merges providers by slug instead of replacing the map", () => {
    const current = baseSettings();
    const next = mergeSettingsPatch(current, {
      providers: {
        deepseek: {
          name: "DeepSeek",
          api: { type: "openai-compatible", baseUrl: "https://api.deepseek.com/v1" },
          auth: { apiKey: "sk-test" },
          models: { "deepseek-v4-flash": { name: "deepseek-v4-flash" } },
        },
      },
      model: {
        coach: "deepseek/deepseek-v4-flash",
        pi: "deepseek/deepseek-v4-flash",
        default: "deepseek/deepseek-v4-flash",
      },
    });

    expect(next.providers?.zen).toBeTruthy();
    expect(next.providers?.deepseek).toBeTruthy();
    expect(next.model?.coach).toBe("deepseek/deepseek-v4-flash");
  });

  it("updates an existing provider without dropping siblings", () => {
    const current = mergeSettingsPatch(baseSettings(), {
      providers: {
        deepseek: {
          name: "DeepSeek",
          api: { type: "openai-compatible", baseUrl: "https://api.deepseek.com/v1" },
          auth: { apiKey: "old" },
          models: { "deepseek-v4-flash": { name: "deepseek-v4-flash" } },
        },
      },
    });

    const next = mergeSettingsPatch(current, {
      providers: {
        deepseek: {
          name: "DeepSeek",
          api: { type: "openai-compatible", baseUrl: "https://api.deepseek.com/v1" },
          auth: { apiKey: "new" },
          models: { "deepseek-v4-flash": { name: "deepseek-v4-flash" } },
        },
      },
    });

    expect(next.providers?.zen).toBeTruthy();
    expect(next.providers?.deepseek?.auth?.apiKey).toBe("new");
  });
});

describe("mergeSettingsForSave", () => {
  it("keeps server model when local still has boot zen placeholder", () => {
    const fresh = mergeSettingsPatch(baseSettings(), {
      model: {
        coach: "deepseek/deepseek-v4-flash",
        pi: "deepseek/deepseek-v4-flash",
        default: "deepseek/deepseek-v4-flash",
      },
    });
    const local = baseSettings();
    const saved = mergeSettingsForSave(fresh, local);
    expect(saved.model?.coach).toBe("deepseek/deepseek-v4-flash");
  });

  it("applies local model when user changed it away from zen default", () => {
    const fresh = baseSettings();
    const local = mergeSettingsPatch(baseSettings(), {
      model: {
        coach: "deepseek/deepseek-v4-flash",
        pi: "deepseek/deepseek-v4-flash",
        default: "deepseek/deepseek-v4-flash",
      },
    });
    const saved = mergeSettingsForSave(fresh, local);
    expect(saved.model?.coach).toBe("deepseek/deepseek-v4-flash");
  });
});
