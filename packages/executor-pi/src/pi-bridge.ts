import type { AuthStorage } from "@earendil-works/pi-coding-agent";
import {
  parseModelRef,
  resolveModelCredentials,
  upgradeToModelConfig,
  type ModelSettingsSlice,
  type PiExecutorSettings,
} from "@openx/shared";

/** OpenX provider template/slug → Pi ModelRegistry 中的 provider id */
const OPENX_TO_PI_PROVIDER: Record<string, string> = {
  "opencode-zen": "opencode",
};

function toPiRegistryProvider(providerOrTemplate: string): string {
  return OPENX_TO_PI_PROVIDER[providerOrTemplate] ?? providerOrTemplate;
}

/** 将 OpenX providers 中的 API Key 注入 Pi AuthStorage（Coach 与 Pi 共用配置） */
export function applyOpenxAuthToPiStorage(
  authStorage: AuthStorage,
  modelSettings?: ModelSettingsSlice,
): void {
  if (!modelSettings) return;
  const upgraded = upgradeToModelConfig(modelSettings);
  const refs = new Set(
    [upgraded.model?.pi, upgraded.model?.coach, upgraded.model?.default].filter(
      (r): r is string => Boolean(r?.trim()),
    ),
  );
  for (const ref of refs) {
    const creds = resolveModelCredentials(upgraded, ref);
    if (!creds?.apiKey?.trim()) continue;
    const providerConfig = upgraded.providers?.[creds.slug];
    const piProvider = toPiRegistryProvider(providerConfig?.source?.template ?? creds.slug);
    authStorage.setRuntimeApiKey(piProvider, creds.apiKey.trim());
  }
}

/** 将 OpenX model.pi 引用合并到 Pi 执行器设置 */
export function mergePiSettingsFromModel(
  pi: PiExecutorSettings,
  modelSettings?: ModelSettingsSlice,
): PiExecutorSettings {
  if (!modelSettings?.model?.pi) return pi;

  const upgraded = upgradeToModelConfig(modelSettings);
  const creds = resolveModelCredentials(upgraded, upgraded.model!.pi);
  if (!creds) return pi;

  const providerConfig = upgraded.providers?.[creds.slug];
  const template = providerConfig?.source?.template;
  const provider = toPiRegistryProvider(template ?? creds.slug);

  return {
    ...pi,
    provider,
    model: creds.upstreamModelId,
  };
}

export function describePiModelRef(modelSettings?: ModelSettingsSlice): string | undefined {
  const ref = modelSettings?.model?.pi;
  if (!ref) return undefined;
  const parsed = parseModelRef(ref);
  if (!parsed) return ref;
  const name = modelSettings?.providers?.[parsed.slug]?.name ?? parsed.slug;
  return `${name} / ${parsed.modelId}`;
}
