import { z } from "zod";

/** OpenCode Zen（与 OpenCode CLI 无 Key 时 apiKey=public 一致） */
export const OPENCODE_ZEN_BASE_URL = "https://opencode.ai/zen/v1";
export const OPENCODE_ZEN_PUBLIC_API_KEY = "public";
export const OPENCODE_ZEN_DEFAULT_FREE_MODEL = "big-pickle";

/** 文档与 models.dev 中 cost.input=0 的免费模型（限时，有配额） */
export const OPENCODE_ZEN_FREE_MODELS = [
  "big-pickle",
  "deepseek-v4-flash-free",
  "mimo-v2-flash-free",
  "nemotron-3-ultra-free",
  "glm-5-free",
  "kimi-k2.5-free",
  "minimax-m2.5-free",
] as const;

export type OpencodeZenFreeModel = (typeof OPENCODE_ZEN_FREE_MODELS)[number];

export const LlmProviderIdSchema = z.enum([
  "opencode-zen",
  "openai",
  "anthropic",
  "google",
  "deepseek",
  "openrouter",
  "custom",
]);
export type LlmProviderId = z.infer<typeof LlmProviderIdSchema>;

export type LlmProviderDef = {
  id: LlmProviderId;
  name: string;
  tagline: string;
  baseUrl: string;
  defaultModel: string;
  /** 固定模型列表；无则表示用户自填 */
  models?: readonly string[];
  apiKeyRequired: boolean;
  apiKeyPlaceholder?: string;
  apiKeyDefault?: string;
  envVar?: string;
  popular: boolean;
  /**
   * 是否可被 Coach / Reviewer（OpenAI 兼容 SDK）直接调用。
   * Anthropic 原生 Messages 端点为 false，仅适合 ACP Claude。
   */
  coachCompatible?: boolean;
  /** 设置页 / runtime 展示的中文提示 */
  coachWarning?: string;
};

/** 内置渠道模板（catalog），不落盘直到用户保存 */
export const LLM_PROVIDER_TEMPLATES: Record<LlmProviderId, LlmProviderDef> = {
  "opencode-zen": {
    id: "opencode-zen",
    name: "OpenCode Zen",
    tagline: "免费聚合渠道，Key=public，有每日配额",
    baseUrl: OPENCODE_ZEN_BASE_URL,
    defaultModel: OPENCODE_ZEN_DEFAULT_FREE_MODEL,
    models: OPENCODE_ZEN_FREE_MODELS,
    apiKeyRequired: false,
    apiKeyDefault: OPENCODE_ZEN_PUBLIC_API_KEY,
    popular: true,
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    tagline: "api.openai.com · 需 API Key",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"],
    apiKeyRequired: true,
    apiKeyPlaceholder: "sk-...",
    envVar: "OPENAI_API_KEY",
    popular: true,
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    tagline: "Anthropic Messages 代理（Claude Code）· 非 OpenAI Chat",
    baseUrl: "https://api.anthropic.com",
    defaultModel: "claude-sonnet-4-20250514",
    apiKeyRequired: true,
    apiKeyPlaceholder: "sk-ant-...",
    envVar: "ANTHROPIC_API_KEY",
    popular: true,
    coachCompatible: false,
    coachWarning:
      "Anthropic 原生端点不兼容 Coach/审查员（OpenAI Chat）。请改用 OpenAI 兼容渠道，或仅通过 ACP Claude（acp:claude）使用本渠道。",
  },
  google: {
    id: "google",
    name: "Google",
    tagline: "Gemini OpenAI 兼容端点",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.0-flash",
    apiKeyRequired: true,
    envVar: "GOOGLE_API_KEY",
    popular: true,
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    tagline: "Coach/Pi 用 api.deepseek.com · Claude 用 /anthropic",
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-v4-flash",
    models: [
      "deepseek-v4-flash",
      "deepseek-v4-pro",
      "deepseek-chat",
      "deepseek-reasoner",
    ],
    apiKeyRequired: true,
    envVar: "DEEPSEEK_API_KEY",
    popular: true,
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    tagline: "多模型聚合 openrouter.ai",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4o-mini",
    apiKeyRequired: true,
    envVar: "OPENROUTER_API_KEY",
    popular: true,
  },
  custom: {
    id: "custom",
    name: "自定义",
    tagline: "任意 OpenAI 兼容 Base URL",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    apiKeyRequired: true,
    popular: false,
  },
};

/** @deprecated 使用 LLM_PROVIDER_TEMPLATES；下次 major 将移除本别名 */
export const LLM_PROVIDERS = LLM_PROVIDER_TEMPLATES;

export const POPULAR_LLM_PROVIDER_IDS: LlmProviderId[] = (
  Object.values(LLM_PROVIDER_TEMPLATES) as LlmProviderDef[]
)
  .filter((p) => p.popular)
  .map((p) => p.id);

export function getLlmProvider(id: string): LlmProviderDef {
  const parsed = LlmProviderIdSchema.safeParse(id);
  if (parsed.success) return LLM_PROVIDERS[parsed.data];
  return LLM_PROVIDERS.custom;
}

export function listLlmProviders(): LlmProviderDef[] {
  return Object.values(LLM_PROVIDERS);
}

export function inferProviderIdFromCoach(coach: {
  providerId?: string;
  preset?: string;
  baseUrl?: string;
}): LlmProviderId {
  if (coach.providerId) {
    const parsed = LlmProviderIdSchema.safeParse(coach.providerId);
    if (parsed.success) return parsed.data;
  }
  if (coach.preset === "opencode-zen-free") return "opencode-zen";
  const url = coach.baseUrl?.trim().toLowerCase() ?? "";
  if (url.includes("opencode.ai/zen")) return "opencode-zen";
  if (url.includes("api.openai.com")) return "openai";
  if (url.includes("anthropic")) return "anthropic";
  if (url.includes("generativelanguage.googleapis.com")) return "google";
  if (url.includes("deepseek.com")) return "deepseek";
  if (url.includes("openrouter.ai")) return "openrouter";
  return "custom";
}

export function pickModelForProvider(
  providerId: LlmProviderId,
  model?: string,
): string {
  const def = getLlmProvider(providerId);
  const trimmed = model?.trim();
  if (!trimmed) return def.defaultModel;
  if (def.models?.includes(trimmed)) return trimmed;
  if (!def.models) return trimmed;
  return def.defaultModel;
}
