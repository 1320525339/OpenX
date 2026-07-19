import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  createDefaultProvidersMap,
  inferProviderEnvKey,
  ProviderConfigSchema,
  ProvidersMapSchema,
  sanitizeProvidersForDisk,
  parseProvidersFileJson,
  parseProvidersFile,
  type ProviderConfig,
  type ProvidersMap,
} from "@openx/shared";
import { getProvidersPath } from "./paths.js";
import { atomicWriteJson } from "./atomic-json.js";
import { persistSecrets } from "./secrets-store.js";

export function readProvidersFromDisk(): ProvidersMap {
  const path = getProvidersPath();
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return ProvidersMapSchema.parse(parseProvidersFileJson(raw));
  } catch (err) {
    console.error("[providers] 读取 providers.json 失败:", err);
    return {};
  }
}

/** 读取渠道池 revision（与 config revision 对账） */
export function readProvidersRevisionFromDisk(): number | null {
  const path = getProvidersPath();
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const parsed = parseProvidersFile(raw);
    return typeof parsed.revision === "number" ? parsed.revision : null;
  } catch {
    return null;
  }
}

function collectSecretsForDotEnv(providers: ProvidersMap): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const [slug, config] of Object.entries(providers)) {
    const apiKey = config.auth?.apiKey?.trim();
    if (!apiKey) continue;
    const envKey =
      config.auth?.env?.trim() || inferProviderEnvKey(slug, config.source?.template);
    entries[envKey] = apiKey;
  }
  return entries;
}

/**
 * 规范化渠道写入：剥离 apiKeyConfigured；补齐 env。
 * 留空 apiKey 时不覆盖已有 ~/.openx/.env 密钥（collectSecrets 跳过空值）。
 */
export function normalizeProviderConfigForUpsert(
  slug: string,
  config: ProviderConfig,
  existing?: ProviderConfig,
): ProviderConfig {
  const parsed = ProviderConfigSchema.parse(config);
  const { apiKeyConfigured: _flag, ...authWithoutFlag } = parsed.auth ?? {};
  const envKey =
    authWithoutFlag.env?.trim() ||
    existing?.auth?.env?.trim() ||
    inferProviderEnvKey(
      slug,
      parsed.source?.template ?? existing?.source?.template,
    );
  const apiKey = authWithoutFlag.apiKey?.trim();
  return {
    ...parsed,
    auth: {
      ...authWithoutFlag,
      env: envKey || undefined,
      apiKey: apiKey || undefined,
    },
  };
}

/** 持久化渠道池（脱敏 + 密钥写入 .env）；revision 与 config 共享 */
export function writeProvidersToDisk(
  providers: ProvidersMap,
  revision?: number,
): ProvidersMap {
  const parsed = ProvidersMapSchema.parse(providers);
  const secrets = collectSecretsForDotEnv(parsed);
  if (Object.keys(secrets).length > 0) {
    persistSecrets(secrets);
  }
  const sanitized = sanitizeProvidersForDisk(parsed);
  const path = getProvidersPath();
  mkdirSync(dirname(path), { recursive: true });
  atomicWriteJson(path, {
    ...(typeof revision === "number" ? { revision } : {}),
    providers: sanitized,
  });
  return parsed;
}

export function resolveProvidersForLoad(legacyFromConfig?: ProvidersMap): ProvidersMap {
  const fromFile = readProvidersFromDisk();
  if (Object.keys(fromFile).length > 0) {
    return fromFile;
  }
  if (legacyFromConfig && Object.keys(legacyFromConfig).length > 0) {
    return legacyFromConfig;
  }
  return createDefaultProvidersMap();
}

export function needsProvidersFileMigration(
  legacyFromConfig?: ProvidersMap,
): boolean {
  const fromFile = readProvidersFromDisk();
  return Object.keys(fromFile).length === 0 && Object.keys(legacyFromConfig ?? {}).length > 0;
}

export function providersFileExists(): boolean {
  return existsSync(getProvidersPath());
}
