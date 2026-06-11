import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Settings } from "@openx/shared";
import { readAcpCliConfig, syncAcpCliFromModelRef } from "./acp-cli-config.js";

function makeSettings(): Settings {
  return {
    defaultExecutorId: "pi",
    workspaceRoot: ".",
    defaultConstraints: [],
    model: { coach: "zen/big-pickle", pi: "zen/big-pickle", default: "zen/big-pickle" },
    providers: {
      zen: {
        name: "OpenCode Zen",
        api: { type: "openai-compatible", baseUrl: "https://proxy.example/v1" },
        auth: { apiKey: "sk-test-codex" },
        models: { "big-pickle": { name: "Big Pickle" } },
      },
      claude: {
        name: "Claude Proxy",
        api: { type: "openai-compatible", baseUrl: "https://proxy.example" },
        auth: { apiKey: "sk-ant-test" },
        models: { sonnet: { name: "Sonnet" } },
      },
    },
    executors: { pi: {} },
    notifyOnComplete: true,
    autoExecute: true,
    cliProfiles: [],
    acpCli: {},
    skillBindings: {},
    mcpServers: [],
  };
}

describe("acp-cli-config", () => {
  let tempRoot = "";

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "openx-acp-config-"));
    process.env.CODEX_HOME = join(tempRoot, "codex");
    process.env.CLAUDE_CONFIG_DIR = join(tempRoot, "claude");
  });

  afterEach(() => {
    delete process.env.CODEX_HOME;
    delete process.env.CLAUDE_CONFIG_DIR;
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("syncs codex from project modelRef", () => {
    const settings = makeSettings();
    const { snapshot, settings: next } = syncAcpCliFromModelRef(
      settings,
      "acp:codex",
      "zen/big-pickle",
    );

    expect(next.acpCli?.["acp:codex"]).toBe("zen/big-pickle");
    expect(snapshot.modelReady).toBe(true);
    expect(snapshot.synced).toBe(true);
    expect(snapshot.baseUrl).toBe("https://proxy.example/v1");
  });

  it("syncs claude from project modelRef with gateway model aliases", () => {
    const settings = makeSettings();
    const { snapshot } = syncAcpCliFromModelRef(settings, "acp:claude", "claude/sonnet");

    expect(snapshot.apiKeySet).toBe(true);
    expect(snapshot.baseUrl).toBe("https://proxy.example");
    expect(readAcpCliConfig("acp:claude", {
      ...settings,
      acpCli: { "acp:claude": "claude/sonnet" },
    })?.modelRef).toBe("claude/sonnet");
  });

  it("syncs claude zen with Anthropic Messages base URL and auth token", () => {
    const settings = makeSettings();
    settings.providers!.zen.source = { template: "opencode-zen" };
    settings.providers!.zen.api.baseUrl = "https://opencode.ai/zen/v1";
    settings.providers!.zen.auth = { apiKey: "public" };

    syncAcpCliFromModelRef(settings, "acp:claude", "zen/big-pickle");

    const settingsPath = join(process.env.CLAUDE_CONFIG_DIR!, "settings.json");
    const written = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      model: string;
      env: Record<string, string>;
    };
    expect(written.model).toBe("big-pickle");
    expect(written.env.ANTHROPIC_BASE_URL).toBe("https://opencode.ai/zen");
    expect(written.env.ANTHROPIC_AUTH_TOKEN).toBe("public");
    expect(written.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("big-pickle");
  });

  it("returns null for unsupported executor", () => {
    expect(readAcpCliConfig("acp:gemini")).toBeNull();
  });
});
