import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  createDefaultProvidersMap,
  inferProviderEnvKey,
  ProviderConfigSchema,
  ProvidersMapSchema,
  sanitizeProvidersForDisk,
  parseProvidersFileJson,
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

/** 持久化渠道池（脱敏 + 密钥写入 .env） */
export function writeProvidersToDisk(providers: ProvidersMap): ProvidersMap {
  const parsed = ProvidersMapSchema.parse(providers);
  const secrets = collectSecretsForDotEnv(parsed);
  if (Object.keys(secrets).length > 0) {
    persistSecrets(secrets);
  }
  const sanitized = sanitizeProvidersForDisk(parsed);
  const path = getProvidersPath();
  mkdirSync(dirname(path), { recursive: true });
  atomicWriteJson(path, { providers: sanitized });
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

export function validateProviderConfig(config: unknown) {
  return ProviderConfigSchema.parse(config);
}
