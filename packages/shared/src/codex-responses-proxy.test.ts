import { describe, expect, it } from "vitest";
import {
  CODEX_RESPONSES_PROXY_LOCAL_API_KEY,
  collectCodexProxyUpstreamEnv,
  exportCodexProxyProviders,
  inferCodexProxyWireApi,
  isCodexProxyEligibleProvider,
  resolveCodexProxyBaseUrl,
  resolveCodexProxySurface,
} from "./codex-responses-proxy.js";
import type { ProviderConfig } from "./model-config.js";

const mimoProvider: ProviderConfig = {
  name: "MiMo",
  api: { type: "openai-compatible", baseUrl: "https://token-plan-sgp.xiaomimimo.com/v1" },
  auth: { apiKey: "tp-test" },
  models: { "mimo-v2.5-pro": { name: "mimo-v2.5-pro" } },
  source: { template: "custom" },
};

const anthropicProvider: ProviderConfig = {
  name: "Mimo Anthropic",
  api: { type: "openai-compatible", baseUrl: "https://token-plan-sgp.xiaomimimo.com/anthropic" },
  auth: { apiKey: "tp-test" },
  models: { "mimo-v2.5-pro": { name: "mimo-v2.5-pro" } },
  source: { template: "anthropic" },
};

describe("codex-responses-proxy", () => {
  it("exports eligible OpenAI-compatible providers only", () => {
    const file = exportCodexProxyProviders({
      providers: { mimo: mimoProvider, anth: anthropicProvider },
    });
    expect(file.providers).toHaveLength(1);
    expect(file.providers[0]?.id).toBe("mimo");
    expect(file.providers[0]?.wireApi).toBe("chat");
    expect(file.providers[0]?.envKey).toBe("OPENX_CODEX_MIMO_API_KEY");
  });

  it("resolves codex surface to local proxy not upstream", () => {
    const surface = resolveCodexProxySurface("mimo/mimo-v2.5-pro", {
      providers: { mimo: mimoProvider },
    });
    expect(surface?.apiKey).toBe(CODEX_RESPONSES_PROXY_LOCAL_API_KEY);
    expect(surface?.baseUrl).toBe(resolveCodexProxyBaseUrl());
    expect(surface?.model).toBe("mimo-v2.5-pro");
  });

  it("collects upstream api keys for proxy env injection", () => {
    const env = collectCodexProxyUpstreamEnv({
      providers: { mimo: mimoProvider, anth: anthropicProvider },
    });
    expect(env.OPENX_CODEX_MIMO_API_KEY).toBe("tp-test");
    expect(env.OPENX_CODEX_ANTH_API_KEY).toBeUndefined();
  });

  it("uses responses wireApi for native OpenAI", () => {
    const openai: ProviderConfig = {
      ...mimoProvider,
      api: { type: "openai-compatible", baseUrl: "https://api.openai.com/v1" },
      source: { template: "openai" },
    };
    expect(inferCodexProxyWireApi(openai)).toBe("responses");
    expect(isCodexProxyEligibleProvider(openai)).toBe(true);
  });
});
