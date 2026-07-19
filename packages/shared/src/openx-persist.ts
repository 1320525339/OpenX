import { getLlmProvider } from "./llm-providers.js";
import type { ProviderConfig } from "./model-config.js";
import { ProvidersMapSchema, type ProvidersMap } from "./model-config.js";
import { z } from "zod";

export const ProvidersFileSchema = z.object({
  /** 与 config.json revision 对齐的渠道池版本，便于跨文件对账 */
  revision: z.number().int().nonnegative().optional(),
  providers: ProvidersMapSchema.default({}),
});
export type ProvidersFile = z.infer<typeof ProvidersFileSchema>;

const ENV_KEY_RE = /^[A-Z][A-Z0-9_]*$/;

/** 推断渠道 API Key 对应的环境变量名（对齐 mimo2codex envKey） */
export function inferProviderEnvKey(slug: string, templateId?: string): string {
  const tpl = templateId ? getLlmProvider(templateId) : undefined;
  if (tpl?.envVar) return tpl.envVar;
  const normalized = slug.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return `${normalized}_API_KEY`;
}

/** OpenCode Zen 等公开 Key 可落盘 */
export function isPublicProviderApiKey(config: ProviderConfig): boolean {
  if (config.source?.template === "opencode-zen") return true;
  const key = config.auth?.apiKey?.trim();
  return key === "public";
}

/** 去掉仅用于 API 响应的 apiKeyConfigured 标记 */
function stripApiKeyConfiguredFlag(config: ProviderConfig): ProviderConfig {
  if (!config.auth || config.auth.apiKeyConfigured === undefined) return config;
  const { apiKeyConfigured: _flag, ...authRest } = config.auth;
  return {
    ...config,
    auth: Object.keys(authRest).length > 0 ? authRest : undefined,
  };
}

/**
 * 持久化前：明文 apiKey 写入 env 引用（secret 由 ~/.openx/.env 承载）。
 * 公开 Key（如 Zen）仍保留 apiKey 字段。
 */
export function sanitizeProviderForDisk(
  slug: string,
  config: ProviderConfig,
): ProviderConfig {
  const base = stripApiKeyConfiguredFlag(config);
  const apiKey = base.auth?.apiKey?.trim();
  if (!apiKey || isPublicProviderApiKey(base)) {
    return base;
  }
  const envKey = base.auth?.env?.trim() || inferProviderEnvKey(slug, base.source?.template);
  const { apiKey: _removed, ...authRest } = base.auth ?? {};
  return {
    ...base,
    auth: { ...authRest, env: envKey },
  };
}

/**
 * 判断渠道是否已具备可用密钥（明文、公开 Key、或 env 指向的已存 secret）。
 * `hasSecret` 由调用方提供（如读 ~/.openx/.env），避免 shared 依赖 Node 文件。
 */
export function isProviderApiKeyConfigured(
  slug: string,
  config: ProviderConfig,
  hasSecret?: (envKey: string) => boolean,
): boolean {
  if (isPublicProviderApiKey(config)) return true;
  if (config.auth?.apiKey?.trim()) return true;
  if (config.auth?.apiKeyConfigured === true) return true;
  const envKey =
    config.auth?.env?.trim() || inferProviderEnvKey(slug, config.source?.template);
  return Boolean(envKey && hasSecret?.(envKey));
}

export function sanitizeProvidersForDisk(providers: ProvidersMap): ProvidersMap {
  const out: ProvidersMap = {};
  for (const [slug, config] of Object.entries(providers)) {
    out[slug] = sanitizeProviderForDisk(slug, config);
  }
  return out;
}

/** API 响应脱敏：去掉非公开 apiKey，保留 env，并可选标注 apiKeyConfigured */
export function sanitizeSettingsForApi<T extends { providers?: ProvidersMap }>(
  settings: T,
  options?: {
    hasSecret?: (envKey: string) => boolean;
  },
): T {
  if (!settings.providers || Object.keys(settings.providers).length === 0) {
    return settings;
  }
  const providers: ProvidersMap = {};
  for (const [slug, config] of Object.entries(settings.providers)) {
    const sanitized = sanitizeProviderForDisk(slug, config);
    const configured = isProviderApiKeyConfigured(slug, config, options?.hasSecret);
    providers[slug] = {
      ...sanitized,
      auth: {
        ...sanitized.auth,
        apiKeyConfigured: configured,
      },
    };
  }
  return {
    ...settings,
    providers,
  };
}

/** 简易 dotenv 解析（对齐 mimo2codex load-env 语义） */
export function parseDotEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const normalized = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const eq = normalized.indexOf("=");
    if (eq <= 0) continue;
    const key = normalized.slice(0, eq).trim();
    if (!ENV_KEY_RE.test(key)) continue;
    let value = normalized.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** 合并写入 .env 条目（不重复已有相同 key=value） */
export function mergeDotEnvContent(
  existing: string,
  entries: Record<string, string>,
): string {
  const current = parseDotEnv(existing);
  const lines = existing.trimEnd() ? existing.trimEnd().split(/\r?\n/) : [];
  const touched = new Set<string>();

  for (const [key, value] of Object.entries(entries)) {
    if (!value.trim() || !ENV_KEY_RE.test(key)) continue;
    if (current[key] === value) continue;
    current[key] = value;
    touched.add(key);
  }

  if (touched.size === 0) return existing;

  const kept = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return true;
    const normalized = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const key = normalized.split("=")[0]?.trim();
    return !key || !touched.has(key);
  });

  for (const key of touched) {
    kept.push(`${key}=${current[key]}`);
  }

  return `${kept.join("\n")}\n`;
}

export function parseProvidersFileJson(raw: unknown): ProvidersMap {
  const parsed = ProvidersFileSchema.parse(
    raw && typeof raw === "object" && !Array.isArray(raw) ? raw : { providers: raw },
  );
  return parsed.providers ?? {};
}

/** 读取 providers.json 全量（含 revision） */
export function parseProvidersFile(raw: unknown): ProvidersFile {
  return ProvidersFileSchema.parse(
    raw && typeof raw === "object" && !Array.isArray(raw) ? raw : { providers: raw },
  );
}
