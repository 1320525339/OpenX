import { z } from "zod";
import {
  getLlmProvider,
  inferProviderIdFromCoach,
  LlmProviderIdSchema,
  OPENCODE_ZEN_BASE_URL,
  OPENCODE_ZEN_PUBLIC_API_KEY,
  pickModelForProvider,
  type LlmProviderId,
} from "./llm-providers.js";

export {
  OPENCODE_ZEN_BASE_URL,
  OPENCODE_ZEN_DEFAULT_FREE_MODEL,
  OPENCODE_ZEN_FREE_MODELS,
  OPENCODE_ZEN_PUBLIC_API_KEY,
  type OpencodeZenFreeModel,
} from "./llm-providers.js";

/** @deprecated 仅兼容旧配置，运行时一律走 LLM */
export const CoachProviderModeSchema = z.enum(["rules", "llm"]);
export type CoachProviderMode = z.infer<typeof CoachProviderModeSchema>;

/** LLM 端点预设（兼容旧版） */
export const CoachLlmPresetSchema = z.enum(["custom", "opencode-zen-free"]);
export type CoachLlmPreset = z.infer<typeof CoachLlmPresetSchema>;

export const CoachSettingsSchema = z.object({
  provider: CoachProviderModeSchema.default("llm"),
  /** 当前 LLM 渠道商（对齐 OpenCode Providers） */
  providerId: LlmProviderIdSchema.default("opencode-zen"),
  preset: CoachLlmPresetSchema.default("custom"),
  /** OpenAI 兼容 API 根地址 */
  baseUrl: z.string().default("https://api.openai.com/v1"),
  /** 可写在 config；Zen 免费预设默认为 public */
  apiKey: z.string().optional(),
  model: z.string().default("gpt-4o-mini"),
});
export type CoachSettings = z.infer<typeof CoachSettingsSchema>;

export function applyLlmProvider(
  providerId: LlmProviderId,
  current?: Partial<CoachSettings>,
): CoachSettings {
  const def = getLlmProvider(providerId);
  const model = pickModelForProvider(providerId, current?.model);
  const preset: CoachLlmPreset =
    providerId === "opencode-zen" ? "opencode-zen-free" : "custom";
  const sameProvider = inferProviderIdFromCoach(current ?? {}) === providerId;

  return CoachSettingsSchema.parse({
    provider: "llm",
    providerId,
    preset,
    baseUrl:
      providerId === "custom"
        ? current?.baseUrl?.trim() || def.baseUrl
        : def.baseUrl,
    apiKey:
      def.apiKeyDefault ??
      (sameProvider && current?.apiKey?.trim() ? current.apiKey.trim() : undefined),
    model,
  });
}

/** @deprecated 使用 applyLlmProvider("opencode-zen") */
export function applyOpencodeZenFreePreset(
  current?: Partial<CoachSettings>,
): CoachSettings {
  return applyLlmProvider("opencode-zen", current);
}

/** MVP 默认：OpenCode Zen 免费 + LLM，对话与精炼开箱可用 */
export const DEFAULT_COACH_SETTINGS: CoachSettings = applyLlmProvider("opencode-zen");

/** 将旧版 rules / preset 配置升级为带 providerId 的 LLM 设置 */
export function upgradeLegacyCoachSettings(coach: CoachSettings): CoachSettings {
  const providerId = inferProviderIdFromCoach(coach);
  if (coach.provider === "rules") {
    return applyLlmProvider("opencode-zen", coach);
  }
  if (providerId === "opencode-zen") {
    return applyLlmProvider("opencode-zen", coach);
  }
  if (!coach.apiKey?.trim()) {
    return applyLlmProvider("opencode-zen", coach);
  }
  return applyLlmProvider(providerId, coach);
}

/** 将渠道商解析为实际请求参数 */
export function resolveCoachSettings(coach: CoachSettings): CoachSettings {
  const providerId = inferProviderIdFromCoach(coach);
  const def = getLlmProvider(providerId);
  const model = pickModelForProvider(providerId, coach.model);

  if (providerId === "opencode-zen") {
    return {
      ...coach,
      provider: "llm",
      providerId,
      preset: "opencode-zen-free",
      baseUrl: OPENCODE_ZEN_BASE_URL,
      apiKey: coach.apiKey?.trim() || OPENCODE_ZEN_PUBLIC_API_KEY,
      model,
    };
  }

  const apiKey = coach.apiKey?.trim();
  const safeApiKey =
    apiKey && apiKey !== OPENCODE_ZEN_PUBLIC_API_KEY ? apiKey : undefined;

  return {
    ...coach,
    provider: "llm",
    providerId,
    preset: "custom",
    baseUrl: coach.baseUrl?.trim() || def.baseUrl,
    apiKey: safeApiKey,
    model,
  };
}
