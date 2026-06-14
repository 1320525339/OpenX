import { buildClaudeAcpEnv, CODEX_OPENX_MODEL_PROVIDER } from "@openx/shared";

export type CodexSpawnCredentials = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

export type ClaudeSpawnOptions = {
  providerTemplate?: string;
};

/** 强制 Codex ACP 走 OpenX API Key + 自定义 provider，避免 ChatGPT 订阅二次拉模型 */
export function buildCodexAcpSpawnArgs(creds: CodexSpawnCredentials): string[] {
  return [
    "-c",
    'forced_login_method="api"',
    "-c",
    `model="${creds.model}"`,
    "-c",
    `model_provider="${CODEX_OPENX_MODEL_PROVIDER}"`,
  ];
}

export function buildCodexAcpSpawnEnv(
  creds: CodexSpawnCredentials,
): Record<string, string> {
  return {
    OPENAI_API_KEY: creds.apiKey,
    OPENAI_BASE_URL: creds.baseUrl,
    CODEX_API_KEY: creds.apiKey,
  };
}

export function buildClaudeAcpSpawnArgs(_creds: CodexSpawnCredentials): string[] {
  return [];
}

export function buildClaudeAcpSpawnEnv(
  creds: CodexSpawnCredentials,
  opts?: ClaudeSpawnOptions,
): Record<string, string> {
  return buildClaudeAcpEnv(creds, opts);
}
