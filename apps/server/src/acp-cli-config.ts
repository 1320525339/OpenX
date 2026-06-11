import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  ACP_CLI_CONFIG_TARGETS,
  type AcpCliConfigSnapshot,
  type AcpCliConfigTarget,
  type AcpCliResolvedCredentials,
  buildClaudeAcpEnv,
  isAcpCliConfigTarget,
  normalizeClaudeAnthropicBaseUrl,
  parseModelRef,
  resolveModelCredentials,
  resolveProviderConfig,
  type Settings,
} from "@openx/shared";

function resolveCodexHome(): string {
  const override = process.env.CODEX_HOME?.trim();
  if (override) return override.replace(/^~/, homedir());
  return join(homedir(), ".codex");
}

function resolveClaudeConfigDir(): string {
  const override = process.env.CLAUDE_CONFIG_DIR?.trim();
  if (override) return override.replace(/^~/, homedir());
  return join(homedir(), ".claude");
}

function resolveConfigDir(target: AcpCliConfigTarget): string {
  return target === "acp:codex" ? resolveCodexHome() : resolveClaudeConfigDir();
}

function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 4) return "••••";
  return `••••${trimmed.slice(-4)}`;
}

function readJsonFile(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readTomlValue(content: string, key: string): string | undefined {
  const quoted = content.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, "m"));
  if (quoted) return quoted[1];
  const bare = content.match(new RegExp(`^\\s*${key}\\s*=\\s*(\\S+)`, "m"));
  return bare?.[1];
}

function splitTomlRootAndRest(content: string): [string, string] {
  const idx = content.search(/\n\[/);
  if (idx === -1) return [content, ""];
  return [content.slice(0, idx), content.slice(idx)];
}

function writeRootTomlValue(content: string, key: string, value: string): string {
  const [root, rest] = splitTomlRootAndRest(content);
  const line = `${key} = "${value}"`;
  const pattern = new RegExp(`^${key}\\s*=.*$`, "m");
  const newRoot = pattern.test(root)
    ? root.replace(pattern, line)
    : `${root.trimEnd() ? `${root.trimEnd()}\n` : ""}${line}\n`;
  return `${newRoot}${rest}`;
}

function readTomlSectionValue(content: string, section: string, key: string): string | undefined {
  const escaped = section.replace(/\./g, "\\.");
  const match = content.match(new RegExp(`\\[${escaped}\\]([\\s\\S]*?)(?=\\n\\[|$)`));
  if (!match) return undefined;
  return readTomlValue(match[1] ?? "", key);
}

const OPENX_CODEX_MANAGED = "# openx-managed";

function stripMisplacedOpenxKeys(content: string): string {
  let next = content.replace(/\n# openx-managed[\s\S]*$/, "").trimEnd();
  const lines = next.split("\n");
  const out: string[] = [];
  let inSection = false;
  let inOpenxProvider = false;
  for (const line of lines) {
    const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (sectionMatch) {
      inSection = true;
      inOpenxProvider = sectionMatch[1] === "model_providers.openx";
      out.push(line);
      continue;
    }
    if (/^\s*(forced_login_method|model_provider)\s*=/.test(line)) {
      if (!inSection || !inOpenxProvider) continue;
    }
    if (inSection && !inOpenxProvider && /^\s*base_url\s*=/.test(line)) continue;
    out.push(line);
  }
  return out.join("\n");
}

function upsertOpenxCodexManagedBlock(
  content: string,
  creds: AcpCliResolvedCredentials,
): string {
  const block = `${OPENX_CODEX_MANAGED}
forced_login_method = "api"
model_provider = "openx"

[model_providers.openx]
name = "OpenX"
base_url = "${creds.baseUrl}"
env_key = "OPENAI_API_KEY"
wire_api = "responses"
requires_openai_auth = false
`;
  const cleaned = stripMisplacedOpenxKeys(content);
  return `${cleaned.trimEnd()}\n\n${block}`;
}

function readCodexConfig(configDir: string) {
  const authPath = join(configDir, "auth.json");
  const configPath = join(configDir, "config.toml");
  const auth = readJsonFile(authPath);
  const apiKey =
    (typeof auth?.OPENAI_API_KEY === "string" && auth.OPENAI_API_KEY) ||
    (typeof auth?.openai_api_key === "string" && auth.openai_api_key) ||
    "";

  let baseUrl: string = ACP_CLI_CONFIG_TARGETS["acp:codex"].defaultBaseUrl;
  let model = "";
  if (existsSync(configPath)) {
    const toml = readFileSync(configPath, "utf8");
    baseUrl =
      readTomlSectionValue(toml, "model_providers.openx", "base_url") ??
      readTomlValue(toml, "base_url") ??
      baseUrl;
    model = readTomlValue(toml, "model") ?? "";
  }

  return { configFiles: [authPath, configPath], apiKey, baseUrl, model };
}

function readClaudeConfig(configDir: string) {
  const settingsPath = join(configDir, "settings.json");
  const settings = readJsonFile(settingsPath);
  const env =
    settings?.env && typeof settings.env === "object"
      ? (settings.env as Record<string, unknown>)
      : {};

  const apiKey =
    (typeof env.ANTHROPIC_API_KEY === "string" && env.ANTHROPIC_API_KEY) ||
    (typeof env.ANTHROPIC_AUTH_TOKEN === "string" && env.ANTHROPIC_AUTH_TOKEN) ||
    "";

  const baseUrl =
    (typeof env.ANTHROPIC_BASE_URL === "string" && env.ANTHROPIC_BASE_URL) ||
    ACP_CLI_CONFIG_TARGETS["acp:claude"].defaultBaseUrl;

  const model =
    (typeof settings?.model === "string" && settings.model) ||
    (typeof env.ANTHROPIC_MODEL === "string" && env.ANTHROPIC_MODEL) ||
    "";

  return { configFiles: [settingsPath], apiKey, baseUrl, model };
}

function readLocalCliState(executorId: AcpCliConfigTarget) {
  const configDir = resolveConfigDir(executorId);
  return executorId === "acp:codex"
    ? readCodexConfig(configDir)
    : readClaudeConfig(configDir);
}

function writeCodexAuthApiKey(authPath: string, apiKey: string): void {
  writeFileSync(
    authPath,
    `${JSON.stringify(
      {
        auth_mode: "api",
        OPENAI_API_KEY: apiKey,
        openai_api_key: apiKey,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function writeCodexConfig(configDir: string, creds: AcpCliResolvedCredentials): void {
  mkdirSync(configDir, { recursive: true });
  const authPath = join(configDir, "auth.json");
  const configPath = join(configDir, "config.toml");

  writeCodexAuthApiKey(authPath, creds.apiKey);

  const existing = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  let next = writeRootTomlValue(existing, "model", creds.model);
  next = upsertOpenxCodexManagedBlock(next, creds);
  writeFileSync(configPath, next, "utf8");
}

function writeClaudeConfig(
  configDir: string,
  creds: AcpCliResolvedCredentials,
  providerTemplate?: string,
): void {
  mkdirSync(configDir, { recursive: true });
  const settingsPath = join(configDir, "settings.json");
  const settings = readJsonFile(settingsPath) ?? {};
  settings.model = creds.model;
  settings.env = buildClaudeAcpEnv(creds, { providerTemplate });
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

export function applyAcpCliCredentials(
  executorId: AcpCliConfigTarget,
  creds: AcpCliResolvedCredentials,
  opts?: { providerTemplate?: string },
): void {
  const configDir = resolveConfigDir(executorId);
  if (executorId === "acp:codex") {
    writeCodexConfig(configDir, creds);
  } else {
    writeClaudeConfig(configDir, creds, opts?.providerTemplate);
  }
}

export function resolveAcpCliCredentialsFromRef(
  settings: Settings,
  modelRef: string,
): AcpCliResolvedCredentials | null {
  const creds = resolveModelCredentials(settings, modelRef);
  if (!creds) return null;
  return {
    apiKey: creds.apiKey,
    baseUrl: creds.baseUrl,
    model: creds.model,
  };
}

function labelForModelRef(settings: Settings, modelRef: string) {
  const parsed = parseModelRef(modelRef);
  if (!parsed) return { providerName: undefined, modelLabel: undefined };
  const provider = settings.providers?.[parsed.slug];
  const modelEntry = provider?.models[parsed.modelId];
  return {
    providerName: provider?.name,
    modelLabel: modelEntry?.name ?? parsed.modelId,
  };
}

function isSyncedWithCreds(
  executorId: AcpCliConfigTarget,
  local: { apiKey: string; baseUrl: string; model: string },
  creds: AcpCliResolvedCredentials,
): boolean {
  const expectedBase =
    executorId === "acp:claude"
      ? normalizeClaudeAnthropicBaseUrl(creds.baseUrl)
      : creds.baseUrl.trim();
  return (
    local.apiKey.trim() === creds.apiKey &&
    local.baseUrl.trim() === expectedBase &&
    local.model.trim() === creds.model
  );
}

export function readAcpCliConfig(
  executorId: string,
  settings?: Settings,
): AcpCliConfigSnapshot | null {
  if (!isAcpCliConfigTarget(executorId)) return null;
  const meta = ACP_CLI_CONFIG_TARGETS[executorId];
  const configDir = resolveConfigDir(executorId);
  const local = readLocalCliState(executorId);
  const modelRef = settings?.acpCli?.[executorId];
  const resolved =
    modelRef && settings ? resolveAcpCliCredentialsFromRef(settings, modelRef) : null;
  const labels =
    modelRef && settings ? labelForModelRef(settings, modelRef) : { providerName: undefined, modelLabel: undefined };

  return {
    executorId,
    label: meta.label,
    configDir,
    configFiles: local.configFiles,
    modelRef,
    providerName: labels.providerName,
    modelLabel: labels.modelLabel,
    modelReady: Boolean(resolved),
    synced: resolved ? isSyncedWithCreds(executorId, local, resolved) : false,
    apiKeySet: Boolean(local.apiKey.trim()),
    apiKeyPreview: local.apiKey.trim() ? maskApiKey(local.apiKey) : undefined,
    baseUrl: local.baseUrl,
    defaultBaseUrl: meta.defaultBaseUrl,
  };
}

export function syncAcpCliFromModelRef(
  settings: Settings,
  executorId: string,
  modelRef: string,
): { snapshot: AcpCliConfigSnapshot; settings: Settings } {
  if (!isAcpCliConfigTarget(executorId)) {
    throw new Error("该 CLI 不支持 API 配置");
  }
  const creds = resolveAcpCliCredentialsFromRef(settings, modelRef);
  if (!creds) {
    throw new Error("所选渠道/模型不可用，请先在「模型」页配置 API Key");
  }
  const parsed = parseModelRef(modelRef);
  const provider = parsed ? resolveProviderConfig(settings, parsed.slug) : null;
  applyAcpCliCredentials(executorId, creds, {
    providerTemplate: provider?.source?.template,
  });
  const nextSettings: Settings = {
    ...settings,
    acpCli: { ...(settings.acpCli ?? {}), [executorId]: modelRef },
  };
  const snapshot = readAcpCliConfig(executorId, nextSettings);
  if (!snapshot) throw new Error("读取配置失败");
  return { snapshot, settings: nextSettings };
}

/** @internal 测试用 */
export function _resolveConfigDirForTest(target: AcpCliConfigTarget): string {
  return resolveConfigDir(target);
}
