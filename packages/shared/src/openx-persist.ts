import { getLlmProvider } from "./llm-providers.js";
import type { ProviderConfig } from "./model-config.js";
import { ProvidersMapSchema, type ProvidersMap } from "./model-config.js";
import { z } from "zod";

export const ProvidersFileSchema = z.object({
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

/**
 * 持久化前：明文 apiKey 写入 env 引用（secret 由 ~/.openx/.env 承载）。
 * 公开 Key（如 Zen）仍保留 apiKey 字段。
 */
export function sanitizeProviderForDisk(
  slug: string,
  config: ProviderConfig,
): ProviderConfig {
  const apiKey = config.auth?.apiKey?.trim();
  if (!apiKey || isPublicProviderApiKey(config)) {
    return config;
  }
  const envKey = config.auth?.env?.trim() || inferProviderEnvKey(slug, config.source?.template);
  const { apiKey: _removed, ...authRest } = config.auth ?? {};
  return {
    ...config,
    auth: { ...authRest, env: envKey },
  };
}

export function sanitizeProvidersForDisk(providers: ProvidersMap): ProvidersMap {
  const out: ProvidersMap = {};
  for (const [slug, config] of Object.entries(providers)) {
    out[slug] = sanitizeProviderForDisk(slug, config);
  }
  return out;
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
