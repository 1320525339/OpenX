import type { ModelSettingsSlice, ProviderConfig } from "./model-config.js";
import { parseModelRef, resolveProviderConfig } from "./model-config.js";

/**
 * 仅 acp:codex 使用本地 Responses 代理（mimo2codex）。
 * acp:claude 直连渠道 Anthropic 兼容上游，不经此模块。
 */

/** Codex 0.84+ 仅支持 Responses；本地代理默认端口（与 mimo2codex 一致） */
export const CODEX_RESPONSES_PROXY_DEFAULT_PORT = 8788;

/** Codex 指向本地代理时 auth.json 占位 Key（代理不校验入站凭证） */
export const CODEX_RESPONSES_PROXY_LOCAL_API_KEY = "openx-codex-proxy-local";

/** ~/.codex/config.toml 中 OpenX 托管的 model_provider 段名 */
export const CODEX_OPENX_MODEL_PROVIDER = "openx";

export type CodexProxySurfaceCredentials = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

export type CodexProxyProviderExport = {
  id: string;
  shortcut: string;
  displayName: string;
  baseUrl: string;
  envKey: string;
  defaultModel: string;
  wireApi: "chat" | "responses";
  models: Array<{ id: string; name?: string }>;
  features?: { forceParallelToolCalls?: boolean };
};

export type CodexProxyProvidersFile = {
  providers: CodexProxyProviderExport[];
};

export function resolveCodexProxyPort(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.OPENX_CODEX_PROXY_PORT?.trim() || env.MIMO2CODEX_PORT?.trim();
  const n = raw ? Number.parseInt(raw, 10) : CODEX_RESPONSES_PROXY_DEFAULT_PORT;
  return Number.isFinite(n) && n > 0 ? n : CODEX_RESPONSES_PROXY_DEFAULT_PORT;
}

export function resolveCodexProxyBaseUrl(
  port = resolveCodexProxyPort(),
  host = "127.0.0.1",
): string {
  return `http://${host}:${port}/v1`;
}

export function codexProxyEnvKeyForProvider(slug: string): string {
  const normalized = slug.replace(/-/g, "_").toUpperCase();
  return `OPENX_CODEX_${normalized}_API_KEY`;
}

function isLoopbackCodexProxyBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    const host = url.hostname.toLowerCase();
    if (host !== "127.0.0.1" && host !== "localhost") return false;
    const port = url.port ? Number.parseInt(url.port, 10) : url.protocol === "https:" ? 443 : 80;
    return port === resolveCodexProxyPort() || port === 3931;
  } catch {
    return false;
  }
}

/** 是否应纳入 Codex Responses 代理（Anthropic / 本地代理回环不走 Codex） */
export function isCodexProxyEligibleProvider(provider: ProviderConfig): boolean {
  if (provider.disabled) return false;
  const template = provider.source?.template?.toLowerCase();
  if (template === "anthropic") return false;
  if (isLoopbackCodexProxyBaseUrl(provider.api.baseUrl)) return false;
  return true;
}

export function inferCodexProxyWireApi(provider: ProviderConfig): "chat" | "responses" {
  const template = provider.source?.template?.toLowerCase();
  const url = provider.api.baseUrl.toLowerCase();
  if (template === "openai" && url.includes("api.openai.com")) {
    return "responses";
  }
  return "chat";
}

function upstreamModelId(provider: ProviderConfig, modelId: string): string {
  const entry = provider.models[modelId];
  return entry?.api?.id?.trim() || modelId;
}

function defaultModelForProvider(provider: ProviderConfig): string | null {
  for (const [modelId, model] of Object.entries(provider.models)) {
    if (!model.disabled) return upstreamModelId(provider, modelId);
  }
  return null;
}

/** 将 OpenX 渠道导出为 Codex Responses 代理（mimo2codex providers.json）格式 */
export function exportCodexProxyProviders(
  settings: Pick<ModelSettingsSlice, "providers">,
): CodexProxyProvidersFile {
  const providers: CodexProxyProviderExport[] = [];
  for (const [slug, provider] of Object.entries(settings.providers ?? {})) {
    if (!isCodexProxyEligibleProvider(provider)) continue;
    const defaultModel = defaultModelForProvider(provider);
    if (!defaultModel) continue;
    const models = Object.entries(provider.models)
      .filter(([, m]) => !m.disabled)
      .map(([modelId, m]) => ({
        id: upstreamModelId(provider, modelId),
        name: m.name,
      }));
    providers.push({
      id: slug,
      shortcut: slug,
      displayName: provider.name,
      baseUrl: provider.api.baseUrl.replace(/\/+$/, ""),
      envKey: codexProxyEnvKeyForProvider(slug),
      defaultModel,
      wireApi: inferCodexProxyWireApi(provider),
      models,
      features: { forceParallelToolCalls: true },
    });
  }
  return { providers };
}

/** Codex CLI 应写入的本地代理面（非上游直连） */
export function resolveCodexProxySurface(
  modelRef: string,
  settings: Pick<ModelSettingsSlice, "providers">,
  env: NodeJS.ProcessEnv = process.env,
): CodexProxySurfaceCredentials | null {
  const parsed = parseModelRef(modelRef);
  if (!parsed) return null;
  const provider = resolveProviderConfig(settings, parsed.slug);
  if (!provider || !isCodexProxyEligibleProvider(provider)) return null;
  const modelEntry = provider.models[parsed.modelId];
  if (!modelEntry || modelEntry.disabled) return null;
  return {
    apiKey: CODEX_RESPONSES_PROXY_LOCAL_API_KEY,
    baseUrl: resolveCodexProxyBaseUrl(resolveCodexProxyPort(env)),
    model: upstreamModelId(provider, parsed.modelId),
  };
}

export function collectCodexProxyUpstreamEnv(
  settings: Pick<ModelSettingsSlice, "providers">,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [slug, provider] of Object.entries(settings.providers ?? {})) {
    if (!isCodexProxyEligibleProvider(provider)) continue;
    const envKey = codexProxyEnvKeyForProvider(slug);
    const inline = provider.auth?.apiKey?.trim();
    const fromEnv = provider.auth?.env
      ? env[provider.auth.env]?.trim()
      : undefined;
    const key = inline || fromEnv;
    if (key) out[envKey] = key;
  }
  return out;
}
