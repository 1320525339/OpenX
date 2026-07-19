import type { ProviderConfig } from "./model-config.js";

/** Claude Code 的 ANTHROPIC_BASE_URL 不含 /v1（CC 自行拼接 /v1/messages） */
export function normalizeClaudeAnthropicBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/v1")) return trimmed.slice(0, -3);
  return trimmed;
}

/** Coach / Pi / Codex 代理使用的 OpenAI 兼容根地址。
 *
 * DeepSeek 特例（官方文档 https://api-docs.deepseek.com）：
 * - Chat Completions 根路径为 `https://api.deepseek.com`（**不带** `/v1`），
 *   SDK 再拼 `/chat/completions`。
 * - 若用户或模板误写 `https://api.deepseek.com/v1`，本函数会剥掉末尾 `/v1`。
 * - Anthropic 兼容路径 `/anthropic` 亦会先剥掉，再交给 Messages 解析。
 *
 * 其他渠道：缺 `/v1` 时自动补上（Gemini 已含版本段则原样返回）。
 */
export function normalizeOpenAiCompatibleBaseUrl(
  baseUrl: string,
  template?: string,
): string {
  let url = baseUrl.trim().replace(/\/+$/, "");
  if (!url) return "https://api.openai.com/v1";

  const tpl = template?.toLowerCase();
  const lower = url.toLowerCase();

  // DeepSeek 官方 OpenAI 端点：https://api.deepseek.com/chat/completions（无 /v1）
  // https://api-docs.deepseek.com/zh-cn/
  if (tpl === "deepseek" || lower.includes("api.deepseek.com")) {
    if (lower.includes("/anthropic")) {
      url = url.replace(/\/anthropic\/?$/i, "");
    }
    if (url.endsWith("/v1")) {
      url = url.slice(0, -3);
    }
    return url.replace(/\/+$/, "");
  }

  // Google Gemini OpenAI 兼容路径已含版本段
  if (lower.includes("generativelanguage.googleapis.com")) {
    return url;
  }

  // 常见 OpenAI 兼容渠道统一补 /v1
  if (!url.endsWith("/v1") && !url.endsWith("/v1beta")) {
    return `${url}/v1`;
  }
  return url;
}

/**
 * Claude Code (Anthropic Messages) 根地址。
 * 与 Coach 用的 OpenAI 兼容 baseUrl 分离——同一渠道可能有两个端点（如 DeepSeek）。
 */
export function resolveAnthropicMessagesBaseUrl(
  storedBaseUrl: string,
  template?: string,
): string {
  const url = storedBaseUrl.trim().replace(/\/+$/, "");
  const tpl = template?.toLowerCase();
  const lower = url.toLowerCase();

  if (lower.includes("/anthropic")) {
    return normalizeClaudeAnthropicBaseUrl(url);
  }

  // DeepSeek：OpenAI 存 https://api.deepseek.com → Claude 用 /anthropic
  if (tpl === "deepseek" || lower.includes("api.deepseek.com")) {
    const root = url.endsWith("/v1") ? url.slice(0, -3) : url;
    return normalizeClaudeAnthropicBaseUrl(`${root.replace(/\/+$/, "")}/anthropic`);
  }

  // Mimo / 其他 Anthropic 兼容网关（路径含 anthropic 或模板标记）
  if (tpl === "anthropic" || lower.includes("xiaomimimo.com")) {
    return normalizeClaudeAnthropicBaseUrl(url);
  }

  return normalizeClaudeAnthropicBaseUrl(url);
}

/** acp:claude 可绑定的渠道：需 Anthropic Messages 兼容端点 */
export function isAcpClaudeEligibleProvider(provider: ProviderConfig): boolean {
  if (provider.disabled) return false;
  const template = provider.source?.template?.toLowerCase();
  const baseUrl = provider.api.baseUrl.toLowerCase();

  if (template === "anthropic" || template === "opencode-zen" || template === "deepseek") {
    return true;
  }
  if (baseUrl.includes("/anthropic")) return true;
  if (baseUrl.includes("opencode.ai/zen")) return true;
  if (baseUrl.includes("api.anthropic.com")) return true;

  return false;
}

export function describeAcpClaudeIneligibleReason(provider: ProviderConfig): string {
  const template = provider.source?.template ?? "custom";
  return `渠道「${provider.name}」(${template}) 使用 OpenAI 兼容端点，不能绑定 Claude Code。请选 Anthropic Messages 兼容渠道（DeepSeek /anthropic、OpenCode Zen、Anthropic 代理等）。`;
}
