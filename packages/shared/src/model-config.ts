import { z } from "zod";
import type { CoachSettings } from "./coach-settings.js";
import { resolveCoachSettings } from "./coach-settings.js";
import {
  getLlmProvider,
  inferProviderIdFromCoach,
  LLM_PROVIDERS,
  OPENCODE_ZEN_BASE_URL,
  OPENCODE_ZEN_FREE_MODELS,
  OPENCODE_ZEN_PUBLIC_API_KEY,
  type LlmProviderId,
} from "./llm-providers.js";
import { normalizeOpenAiCompatibleBaseUrl } from "./llm-endpoints.js";
/** 模型配置相关 settings 切片（避免与 settings.ts 循环依赖） */
export type ModelSettingsSlice = {
  model?: ModelSection;
  providers?: ProvidersMap;
  coach?: CoachSettings;
};

/** provider slug：小写字母开头，2–32 字符 */
export const ProviderSlugSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{1,31}$/, "slug 须为小写字母、数字、连字符，2–32 字符")
  .refine((s) => s !== "default", { message: "default 为保留字" });
export type ProviderSlug = z.infer<typeof ProviderSlugSchema>;

export const ModelRefSchema = z.string().min(1);
export type ModelRef = z.infer<typeof ModelRefSchema>;

export const DEFAULT_MODEL_REF = "zen/big-pickle";

export const ProviderApiSchema = z.object({
  type: z.literal("openai-compatible").default("openai-compatible"),
  baseUrl: z.string().url(),
});
export type ProviderApi = z.infer<typeof ProviderApiSchema>;

export const ProviderAuthSchema = z.object({
  apiKey: z.string().optional(),
  env: z.string().optional(),
});
export type ProviderAuth = z.infer<typeof ProviderAuthSchema>;

export const ModelConfigSchema = z.object({
  name: z.string().optional(),
  disabled: z.boolean().optional(),
  api: z.object({ id: z.string().optional() }).optional(),
});
export type ModelConfig = z.infer<typeof ModelConfigSchema>;

export const ProviderSourceSchema = z.object({
  template: z.string().optional(),
});
export type ProviderSource = z.infer<typeof ProviderSourceSchema>;

export const ProviderConfigSchema = z.object({
  name: z.string().min(1),
  api: ProviderApiSchema,
  auth: ProviderAuthSchema.optional(),
  models: z.record(z.string(), ModelConfigSchema).refine(
    (m) => Object.keys(m).length > 0,
    { message: "至少配置一个模型" },
  ),
  source: ProviderSourceSchema.optional(),
  disabled: z.boolean().optional(),
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

/** 拉取远程模型列表时的最小渠道字段（允许 models 为空） */
export const FetchModelsProviderSchema = z.object({
  api: ProviderApiSchema,
  auth: ProviderAuthSchema.optional(),
  source: ProviderSourceSchema.optional(),
});
export type FetchModelsProvider = z.infer<typeof FetchModelsProviderSchema>;

export const ModelSectionSchema = z.object({
  coach: ModelRefSchema.default(DEFAULT_MODEL_REF),
  pi: ModelRefSchema.default(DEFAULT_MODEL_REF),
  /** 审查员专用；未配置时回退 coach */
  reviewer: ModelRefSchema.optional(),
  default: ModelRefSchema.default(DEFAULT_MODEL_REF),
});
export type ModelSection = z.infer<typeof ModelSectionSchema>;

export const ProvidersMapSchema = z.record(z.string(), ProviderConfigSchema);
export type ProvidersMap = z.infer<typeof ProvidersMapSchema>;

export type ParsedModelRef = { slug: string; modelId: string };

export function formatModelRef(slug: string, modelId: string): string {
  return `${slug}/${modelId}`;
}

export function parseModelRef(ref: string): ParsedModelRef | null {
  const trimmed = ref.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash === trimmed.length - 1) return null;
  return {
    slug: trimmed.slice(0, slash),
    modelId: trimmed.slice(slash + 1),
  };
}

/** 内存默认 providers（不落盘，直到用户保存） */
export function createDefaultZenProvider(): ProviderConfig {
  const models: Record<string, ModelConfig> = {};
  for (const id of OPENCODE_ZEN_FREE_MODELS) {
    models[id] = { name: id };
  }
  return {
    name: "OpenCode Zen",
    api: { type: "openai-compatible", baseUrl: OPENCODE_ZEN_BASE_URL },
    auth: { apiKey: OPENCODE_ZEN_PUBLIC_API_KEY },
    models,
    source: { template: "opencode-zen" },
  };
}

export function createDefaultProvidersMap(): ProvidersMap {
  return { zen: createDefaultZenProvider() };
}

export function createDefaultModelSection(): ModelSection {
  return ModelSectionSchema.parse({});
}

export function providerConfigFromTemplate(
  templateId: LlmProviderId,
  overrides?: Partial<ProviderConfig>,
): ProviderConfig {
  const tpl = getLlmProvider(templateId);
  const models: Record<string, ModelConfig> = {};
  if (tpl.models) {
    for (const id of tpl.models) {
      models[id] = { name: id };
    }
  } else {
    models[tpl.defaultModel] = { name: tpl.defaultModel };
  }
  return ProviderConfigSchema.parse({
    name: tpl.name,
    api: { type: "openai-compatible", baseUrl: tpl.baseUrl },
    auth: tpl.apiKeyDefault
      ? { apiKey: tpl.apiKeyDefault, env: tpl.envVar }
      : tpl.envVar
        ? { env: tpl.envVar }
        : undefined,
    models,
    source: { template: templateId },
    ...overrides,
  });
}

export function resolveProviderConfig(
  settings: Pick<ModelSettingsSlice, "providers">,
  slug: string,
): ProviderConfig | null {
  const providers = settings.providers ?? {};
  const config = providers[slug];
  if (!config || config.disabled) return null;
  return config;
}

export type ResolvedModelCredentials = {
  apiKey: string;
  baseUrl: string;
  model: string;
  slug: string;
  modelId: string;
  upstreamModelId: string;
};

export type LlmEnvOverride = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
};

export function resolveModelCredentials(
  settings: Pick<ModelSettingsSlice, "providers" | "model">,
  ref: string,
  env: LlmEnvOverride = {},
): ResolvedModelCredentials | null {
  const parsed = parseModelRef(ref);
  if (!parsed) return null;

  const provider = resolveProviderConfig(settings, parsed.slug);
  if (!provider) return null;

  const modelEntry = provider.models[parsed.modelId];
  if (!modelEntry || modelEntry.disabled) return null;

  const upstreamModelId = modelEntry.api?.id?.trim() || parsed.modelId;

  const apiKey =
    provider.auth?.apiKey?.trim() ||
    (provider.auth?.env
      ? process.env[provider.auth.env]?.trim()
      : undefined) ||
    env.apiKey?.trim() ||
    process.env.OPENX_LLM_API_KEY?.trim();

  if (!apiKey) return null;

  const template = provider.source?.template;
  const rawBaseUrl =
    provider.api.baseUrl.trim() ||
    env.baseUrl?.trim() ||
    process.env.OPENX_LLM_BASE_URL?.trim() ||
    "https://api.openai.com/v1";

  const baseUrl = normalizeOpenAiCompatibleBaseUrl(rawBaseUrl, template);

  const model =
    upstreamModelId ||
    env.model?.trim() ||
    process.env.OPENX_LLM_MODEL?.trim() ||
    parsed.modelId;

  return {
    apiKey,
    baseUrl,
    model,
    slug: parsed.slug,
    modelId: parsed.modelId,
    upstreamModelId,
  };
}

export function listConfiguredModelRefs(
  settings: Pick<ModelSettingsSlice, "providers">,
): { ref: string; label: string }[] {
  const providers = settings.providers ?? {};
  const out: { ref: string; label: string }[] = [];
  for (const [slug, provider] of Object.entries(providers)) {
    if (provider.disabled) continue;
    for (const [modelId, model] of Object.entries(provider.models)) {
      if (model.disabled) continue;
      const ref = formatModelRef(slug, modelId);
      const label = model.name
        ? `${provider.name} / ${model.name}`
        : `${provider.name} / ${modelId}`;
      out.push({ ref, label });
    }
  }
  return out;
}

function uniqueSlug(base: string, existing: Record<string, unknown>): string {
  if (!existing[base]) return base;
  let i = 2;
  while (existing[`${base}-${i}`]) i += 1;
  return `${base}-${i}`;
}

function coachToProviderConfig(coach: CoachSettings): ProviderConfig {
  const resolved = resolveCoachSettings(coach);
  const providerId = inferProviderIdFromCoach(resolved);
  const tpl = getLlmProvider(providerId);
  const modelId = resolved.model || tpl.defaultModel;
  const models: Record<string, ModelConfig> = {
    [modelId]: { name: modelId },
  };
  if (tpl.models) {
    for (const id of tpl.models) {
      if (!models[id]) models[id] = { name: id };
    }
  }
  return ProviderConfigSchema.parse({
    name: tpl.name,
    api: { type: "openai-compatible", baseUrl: resolved.baseUrl },
    auth: resolved.apiKey
      ? { apiKey: resolved.apiKey, env: tpl.envVar }
      : tpl.envVar
        ? { env: tpl.envVar }
        : undefined,
    models,
    source: { template: providerId },
  });
}

export function resolveReviewerModelRef(model?: ModelSection): string {
  const section = model ?? createDefaultModelSection();
  return section.reviewer?.trim() || section.coach || section.default || DEFAULT_MODEL_REF;
}

function hasResolvableModelRef(model: ModelSection, providers: ProvidersMap): boolean {
  return [model.coach, model.pi, model.reviewer, model.default]
    .filter((ref): ref is string => Boolean(ref?.trim()))
    .some((ref) => {
    const parsed = parseModelRef(ref);
    if (!parsed) return false;
    const provider = providers[parsed.slug];
    if (!provider || provider.disabled) return false;
    const entry = provider.models[parsed.modelId];
    return Boolean(entry && !entry.disabled);
  });
}

/** 是否为出厂默认工头/Pi 模型（OpenCode Zen） */
export function isDefaultZenModelSection(model?: ModelSection): boolean {
  if (!model) return true;
  return (
    model.coach === DEFAULT_MODEL_REF &&
    model.pi === DEFAULT_MODEL_REF &&
    model.default === DEFAULT_MODEL_REF
  );
}

/** 将旧 coach 扁平配置迁移为 model + providers */
export function upgradeToModelConfig<T extends ModelSettingsSlice>(settings: T): T {
  const providers = { ...(settings.providers ?? {}) };
  let model = settings.model
    ? ModelSectionSchema.parse(settings.model)
    : createDefaultModelSection();

  if (Object.keys(providers).length === 0 && settings.coach) {
    const coach = settings.coach;
    const providerId = inferProviderIdFromCoach(coach);
    let slug = providerId === "custom" ? "custom" : providerId;
    slug = uniqueSlug(slug, providers);
    providers[slug] = coachToProviderConfig(coach);
    const resolved = resolveCoachSettings(coach);
    const ref = formatModelRef(slug, resolved.model);
    model = { coach: ref, pi: ref, default: ref };
  }

  if (Object.keys(providers).length === 0) {
    Object.assign(providers, createDefaultProvidersMap());
  }

  // 仅当当前 model 引用无法解析到任何渠道时才回退 zen/big-pickle
  if (!hasResolvableModelRef(model, providers)) {
    model = createDefaultModelSection();
  }

  return {
    ...settings,
    model,
    providers,
  };
}

/** 保存前剥离废弃 coach 字段 */
export function stripLegacyCoachForSave<T extends ModelSettingsSlice>(settings: T): Omit<T, "coach"> {
  const upgraded = upgradeToModelConfig(settings);
  const { coach: _coach, ...rest } = upgraded;
  return rest;
}

/** config.json 落盘：渠道写入 ~/.openx/providers.json，核心配置不含 providers */
export function stripProvidersForCoreConfigSave<T extends ModelSettingsSlice>(
  settings: T,
): Omit<T, "coach" | "providers"> {
  const { coach: _coach, providers: _providers, ...rest } = settings;
  return rest as Omit<T, "coach" | "providers">;
}

export function upsertProvider<T extends ModelSettingsSlice>(
  settings: T,
  slug: string,
  config: ProviderConfig,
): T {
  ProviderSlugSchema.parse(slug);
  const parsed = ProviderConfigSchema.parse(config);
  const providers = { ...(settings.providers ?? {}), [slug]: parsed };
  let model = settings.model ?? createDefaultModelSection();

  const firstModelId = Object.keys(parsed.models).find(
    (id) => !parsed.models[id]?.disabled,
  );
  if (firstModelId) {
    const ref = formatModelRef(slug, firstModelId);
    const coachParsed = parseModelRef(model.coach);
    if (!coachParsed || coachParsed.slug === slug) {
      model = { ...model, coach: ref };
    }
    const piParsed = parseModelRef(model.pi);
    if (!piParsed || piParsed.slug === slug) {
      model = { ...model, pi: ref };
    }
  }

  return { ...settings, providers, model };
}

function fallbackRef(
  settings: ModelSettingsSlice,
  excludeSlug: string,
): string {
  const model = settings.model ?? createDefaultModelSection();
  const candidates = [model.default, model.coach, model.pi, DEFAULT_MODEL_REF];
  for (const ref of candidates) {
    const parsed = parseModelRef(ref);
    if (!parsed || parsed.slug === excludeSlug) continue;
    if (resolveProviderConfig(settings, parsed.slug)) return ref;
  }
  for (const [slug, provider] of Object.entries(settings.providers ?? {})) {
    if (slug === excludeSlug || provider.disabled) continue;
    const modelId = Object.keys(provider.models).find(
      (id) => !provider.models[id]?.disabled,
    );
    if (modelId) return formatModelRef(slug, modelId);
  }
  return DEFAULT_MODEL_REF;
}

function retargetRef(ref: string, excludeSlug: string, fallback: string): string {
  const parsed = parseModelRef(ref);
  if (parsed?.slug === excludeSlug) return fallback;
  return ref;
}

export function deleteProvider<T extends ModelSettingsSlice>(settings: T, slug: string): T {
  const providers = { ...(settings.providers ?? {}) };
  if (!(slug in providers)) return settings;
  delete providers[slug];

  const model = settings.model ?? createDefaultModelSection();
  const fallback = fallbackRef({ ...settings, providers }, slug);

  return {
    ...settings,
    providers,
    model: {
      coach: retargetRef(model.coach, slug, fallback),
      pi: retargetRef(model.pi, slug, fallback),
      reviewer: model.reviewer ? retargetRef(model.reviewer, slug, fallback) : undefined,
      default: retargetRef(model.default, slug, fallback),
    },
  };
}

export function listLlmProviderTemplates() {
  return Object.values(LLM_PROVIDERS);
}

export type ModelRuntimeStatus = {
  ref: string;
  ready: boolean;
  model?: string;
  baseUrl?: string;
  slug?: string;
  error?: string;
};

export function getModelRuntimeStatus(
  settings: ModelSettingsSlice,
  role: "coach" | "pi" | "reviewer",
  env?: LlmEnvOverride,
): ModelRuntimeStatus {
  const upgraded = upgradeToModelConfig(settings);
  const ref =
    role === "coach"
      ? upgraded.model?.coach ?? DEFAULT_MODEL_REF
      : role === "reviewer"
        ? resolveReviewerModelRef(upgraded.model)
        : upgraded.model?.pi ?? DEFAULT_MODEL_REF;
  const creds = resolveModelCredentials(upgraded, ref, env);
  return {
    ref,
    ready: !!creds,
    model: creds?.model,
    baseUrl: creds?.baseUrl,
    slug: creds?.slug,
  };
}
