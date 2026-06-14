import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SettingsSchema } from "@openx/shared";

describe("settings-store persistence", () => {
  let tempDir = "";
  let configPath = "";
  let providersPath = "";

  beforeEach(() => {
    vi.resetModules();
    tempDir = mkdtempSync(join(tmpdir(), "openx-settings-"));
    configPath = join(tempDir, "config.json");
    providersPath = join(tempDir, "providers.json");
    process.env.OPENX_CONFIG_PATH = configPath;
    process.env.OPENX_PROVIDERS_PATH = providersPath;
    process.env.OPENX_DOTENV_PATH = join(tempDir, ".env");
  });

  afterEach(() => {
    delete process.env.OPENX_CONFIG_PATH;
    delete process.env.OPENX_PROVIDERS_PATH;
    delete process.env.OPENX_DOTENV_PATH;
    rmSync(tempDir, { recursive: true, force: true });
    vi.resetModules();
  });

  async function loadStore() {
    const mod = await import("./settings-store.js");
    mod.runSettingsMigrations();
    return mod;
  }

  it("writes providers to providers.json without apiKey on disk", async () => {
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          model: {
            coach: "deepseek/deepseek-v4-flash",
            pi: "deepseek/deepseek-v4-flash",
            default: "deepseek/deepseek-v4-flash",
          },
          revision: 0,
        },
        null,
        2,
      ),
      "utf8",
    );

    const { saveSettings, loadSettings } = await loadStore();
    saveSettings(
      SettingsSchema.parse({
        model: {
          coach: "deepseek/deepseek-v4-flash",
          pi: "deepseek/deepseek-v4-flash",
          default: "deepseek/deepseek-v4-flash",
        },
        providers: {
          deepseek: {
            name: "DeepSeek",
            api: { type: "openai-compatible", baseUrl: "https://api.deepseek.com/v1" },
            auth: { apiKey: "sk-secret", env: "DEEPSEEK_API_KEY" },
            models: { "deepseek-v4-flash": { name: "deepseek-v4-flash" } },
          },
        },
      }),
    );

    const providersOnDisk = JSON.parse(readFileSync(providersPath, "utf8")) as {
      providers: Record<string, { auth?: { apiKey?: string; env?: string } }>;
    };
    expect(providersOnDisk.providers.deepseek?.auth?.env).toBe("DEEPSEEK_API_KEY");
    expect(providersOnDisk.providers.deepseek?.auth?.apiKey).toBeUndefined();

    const dotenv = readFileSync(join(tempDir, ".env"), "utf8");
    expect(dotenv).toContain("DEEPSEEK_API_KEY=sk-secret");

    const core = JSON.parse(readFileSync(configPath, "utf8")) as { providers?: unknown };
    expect(core.providers).toBeUndefined();
    expect(loadSettings().revision).toBeGreaterThan(0);
  });

  it("mergeAndSaveSettings keeps providers from providers.json", async () => {
    writeFileSync(
      providersPath,
      JSON.stringify(
        {
          providers: {
            deepseek: {
              name: "DeepSeek",
              api: { type: "openai-compatible", baseUrl: "https://api.deepseek.com/v1" },
              auth: { env: "DEEPSEEK_API_KEY" },
              models: { "deepseek-v4-flash": { name: "deepseek-v4-flash" } },
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          model: {
            coach: "deepseek/deepseek-v4-flash",
            pi: "deepseek/deepseek-v4-flash",
            default: "deepseek/deepseek-v4-flash",
          },
          revision: 1,
        },
        null,
        2,
      ),
      "utf8",
    );

    const { mergeAndSaveSettings, loadSettings } = await loadStore();
    const currentRevision = loadSettings().revision ?? 0;

    const stale = SettingsSchema.parse({
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

    mergeAndSaveSettings(stale, { baseRevision: currentRevision });

    const loaded = loadSettings();
    expect(loaded.providers?.deepseek).toBeTruthy();
    expect(loaded.providers?.zen).toBeTruthy();
    expect(loaded.model?.coach).toBe("deepseek/deepseek-v4-flash");
    expect(existsSync(providersPath)).toBe(true);
  });

  it("mergeAndSaveSettings keeps custom model when stale PUT still has zen placeholder", async () => {
    writeFileSync(
      providersPath,
      JSON.stringify(
        {
          providers: {
            "mimo-sgp": {
              name: "Mimo",
              api: {
                type: "openai-compatible",
                baseUrl: "https://token-plan-sgp.xiaomimimo.com/v1",
              },
              auth: { env: "MIMO_API_KEY" },
              models: { "mimo-v2.5-pro": { name: "mimo-v2.5-pro" } },
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          model: {
            coach: "mimo-sgp/mimo-v2.5-pro",
            pi: "mimo-sgp/mimo-v2.5-pro",
            default: "mimo-sgp/mimo-v2.5-pro",
          },
          revision: 1,
        },
        null,
        2,
      ),
      "utf8",
    );

    const { mergeAndSaveSettings, loadSettings } = await loadStore();
    const currentRevision = loadSettings().revision ?? 0;

    const stale = SettingsSchema.parse({
      model: { coach: "zen/big-pickle", pi: "zen/big-pickle", default: "zen/big-pickle" },
      notifyOnComplete: false,
    });

    mergeAndSaveSettings(stale, { baseRevision: currentRevision });

    const loaded = loadSettings();
    expect(loaded.model?.coach).toBe("mimo-sgp/mimo-v2.5-pro");
    expect(loaded.notifyOnComplete).toBe(false);
  });

  it("loadSettings preserves deepseek model from config.json with providers.json", async () => {
    writeFileSync(
      providersPath,
      JSON.stringify(
        {
          providers: {
            deepseek: {
              name: "DeepSeek",
              api: { type: "openai-compatible", baseUrl: "https://api.deepseek.com/v1" },
              auth: { env: "DEEPSEEK_API_KEY" },
              models: { "deepseek-v4-flash": { name: "deepseek-v4-flash" } },
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          model: {
            coach: "deepseek/deepseek-v4-flash",
            pi: "deepseek/deepseek-v4-flash",
            default: "deepseek/deepseek-v4-flash",
          },
          revision: 2,
        },
        null,
        2,
      ),
      "utf8",
    );

    const { loadSettings } = await loadStore();
    const loaded = loadSettings();
    expect(loaded.model?.coach).toBe("deepseek/deepseek-v4-flash");
    expect(loaded.providers?.deepseek).toBeTruthy();
  });

  it("rejects stale baseRevision", async () => {
    writeFileSync(configPath, JSON.stringify({ revision: 3 }, null, 2), "utf8");
    const { patchSettings, loadSettings } = await loadStore();
    const currentRevision = loadSettings().revision ?? 0;
    expect(() =>
      patchSettings({ operatorTier: "admin" }, { baseRevision: currentRevision - 10 }),
    ).toThrow(/配置已被其他进程更新/);
  });
});
