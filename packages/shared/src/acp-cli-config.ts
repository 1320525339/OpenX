import { z } from "zod";
import { ModelRefSchema } from "./model-config.js";

/** 支持在本机同步 API 配置的 ACP 运行时 */
export const ACP_CLI_CONFIG_TARGETS = {
  "acp:codex": {
    label: "Codex CLI (ACP)",
    defaultBaseUrl: "https://api.openai.com/v1",
  },
  "acp:claude": {
    label: "Claude Code (ACP)",
    defaultBaseUrl: "https://api.anthropic.com",
  },
} as const;

export type AcpCliConfigTarget = keyof typeof ACP_CLI_CONFIG_TARGETS;

export function isAcpCliConfigTarget(id: string): id is AcpCliConfigTarget {
  return id in ACP_CLI_CONFIG_TARGETS;
}

export function hasAcpCliConfigTool(executorId: string): boolean {
  return isAcpCliConfigTarget(executorId);
}

/** executorId → 项目 modelRef（slug/modelId） */
export const AcpCliBindingsSchema = z.record(z.string(), ModelRefSchema).default({});
export type AcpCliBindings = z.infer<typeof AcpCliBindingsSchema>;

export const UpdateAcpCliConfigSchema = z.object({
  modelRef: ModelRefSchema,
});
export type UpdateAcpCliConfigInput = z.infer<typeof UpdateAcpCliConfigSchema>;

export type AcpCliResolvedCredentials = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

/** Claude Code 的 ANTHROPIC_BASE_URL 不含 /v1（CC 自行拼接 /v1/messages） */
export function normalizeClaudeAnthropicBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/v1")) return trimmed.slice(0, -3);
  return trimmed;
}

export function isOpencodeZenProvider(sourceTemplate?: string, baseUrl?: string): boolean {
  if (sourceTemplate === "opencode-zen") return true;
  return (baseUrl ?? "").toLowerCase().includes("opencode.ai/zen");
}

/** Claude Code / claude-agent-acp 派单环境变量（第三方模型 ID 需覆盖默认别名） */
export function buildClaudeAcpEnv(
  creds: AcpCliResolvedCredentials,
  opts?: { providerTemplate?: string },
): Record<string, string> {
  const zen = isOpencodeZenProvider(opts?.providerTemplate, creds.baseUrl);
  const baseUrl = normalizeClaudeAnthropicBaseUrl(creds.baseUrl);
  const model = creds.model;
  const common: Record<string, string> = {
    ANTHROPIC_BASE_URL: baseUrl,
    ANTHROPIC_MODEL: model,
    ANTHROPIC_CUSTOM_MODEL_OPTION: model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: model,
  };
  if (zen) {
    return {
      ...common,
      ANTHROPIC_AUTH_TOKEN: creds.apiKey,
      ANTHROPIC_API_KEY: creds.apiKey,
      CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1",
    };
  }
  return {
    ...common,
    ANTHROPIC_API_KEY: creds.apiKey,
  };
}

export type AcpCliConfigSnapshot = {
  executorId: AcpCliConfigTarget;
  label: string;
  configDir: string;
  configFiles: string[];
  /** 当前绑定的项目 modelRef */
  modelRef?: string;
  providerName?: string;
  modelLabel?: string;
  /** 所选渠道/模型在本项目内可解析（含 API Key） */
  modelReady: boolean;
  /** 本机 CLI 配置文件已写入凭证 */
  synced: boolean;
  apiKeySet: boolean;
  apiKeyPreview?: string;
  baseUrl: string;
  defaultBaseUrl: string;
};
