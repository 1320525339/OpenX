import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { ModelSettingsSlice, PiExecutorSettings } from "@openx/shared";
import { applyOpenxAuthToPiStorage } from "./pi-bridge.js";

type PiModel = NonNullable<ReturnType<ModelRegistry["find"]>>;

export async function createPiModelRegistry(modelSettings?: ModelSettingsSlice) {
  const authStorage = AuthStorage.create();
  applyOpenxAuthToPiStorage(authStorage, modelSettings);
  const modelRegistry = ModelRegistry.create(authStorage);
  return { authStorage, modelRegistry };
}

/** 按 OpenX 设置解析 Pi 模型（对齐 CLI --provider / --model 语义子集） */
export async function resolvePiModel(
  pi: PiExecutorSettings,
  modelRegistry: ModelRegistry,
): Promise<{ model?: PiModel; error?: string }> {
  if (!pi.provider?.trim() && !pi.model?.trim()) {
    return { model: undefined };
  }

  const all = modelRegistry.getAll();
  if (all.length === 0) {
    return { model: undefined, error: "Pi 模型表为空，请检查 ~/.pi/agent/models.json" };
  }

  const provider = pi.provider?.trim();
  const rawModel = pi.model?.trim();

  if (provider && rawModel) {
    const found = modelRegistry.find(provider, rawModel);
    if (found) return { model: found };
    return { model: undefined, error: `未找到模型：${provider}/${rawModel}` };
  }

  if (rawModel) {
    const lower = rawModel.toLowerCase();
    const slash = rawModel.indexOf("/");
    if (slash !== -1) {
      const maybeProvider = rawModel.slice(0, slash);
      const maybeId = rawModel.slice(slash + 1);
      const found = modelRegistry.find(maybeProvider, maybeId);
      if (found) return { model: found };
    }

    const exact = all.find(
      (m) =>
        m.id.toLowerCase() === lower ||
        `${m.provider}/${m.id}`.toLowerCase() === lower,
    );
    if (exact) return { model: exact };

    const partial = all.filter((m) => m.id.toLowerCase().includes(lower));
    if (partial.length === 1) return { model: partial[0] };
    if (partial.length > 1) {
      return {
        model: undefined,
        error: `模型「${rawModel}」匹配到多个结果，请写全 provider/model`,
      };
    }
    return { model: undefined, error: `未找到模型：${rawModel}` };
  }

  if (provider) {
    const available = await modelRegistry.getAvailable();
    const candidates = available.filter((m) => m.provider === provider);
    if (candidates.length === 1) return { model: candidates[0] };
    if (candidates.length > 1) {
      return {
        model: undefined,
        error: `Provider「${provider}」下有多个模型，请在设置中指定 model`,
      };
    }
    return { model: undefined, error: `Provider「${provider}」下没有可用模型` };
  }

  return { model: undefined };
}
