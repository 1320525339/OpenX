import { useEffect, useMemo, useState } from "react";
import type { AcpCliConfigSnapshot, Settings } from "@openx/shared";
import {
  formatModelRef,
  isAcpClaudeEligibleProvider,
  isCodexProxyEligibleProvider,
  parseModelRef,
} from "@openx/shared";
import { api } from "../../api";

type Props = {
  executorId: string | null;
  settings: Settings;
  onClose: () => void;
  onSaved?: (settings: Settings) => void;
};

export function AcpCliConfigDialog({
  executorId,
  settings,
  onClose,
  onSaved,
}: Props) {
  const [config, setConfig] = useState<AcpCliConfigSnapshot | null>(null);
  const [providerSlug, setProviderSlug] = useState("");
  const [modelId, setModelId] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const providers = useMemo(() => {
    const entries = Object.entries(settings.providers ?? {}).filter(
      ([, provider]) => !provider.disabled,
    );
    if (executorId === "acp:claude") {
      return entries.filter(([, provider]) => isAcpClaudeEligibleProvider(provider));
    }
    if (executorId === "acp:codex") {
      return entries.filter(([, provider]) => isCodexProxyEligibleProvider(provider));
    }
    return entries;
  }, [executorId, settings.providers]);

  const modelsForProvider = useMemo(() => {
    const provider = settings.providers?.[providerSlug];
    if (!provider) return [];
    return Object.entries(provider.models).filter(([, model]) => !model.disabled);
  }, [providerSlug, settings.providers]);

  useEffect(() => {
    if (!executorId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void api
      .getAcpCliConfig(executorId)
      .then(({ config: snapshot }) => {
        if (cancelled) return;
        setConfig(snapshot);
        const ref = snapshot.modelRef;
        const parsed = ref ? parseModelRef(ref) : null;
        if (parsed && settings.providers?.[parsed.slug]) {
          setProviderSlug(parsed.slug);
          setModelId(parsed.modelId);
          return;
        }
        const firstProvider = providers[0];
        if (firstProvider) {
          setProviderSlug(firstProvider[0]);
          const firstModel = Object.keys(firstProvider[1].models).find(
            (id) => !firstProvider[1].models[id]?.disabled,
          );
          setModelId(firstModel ?? "");
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "加载配置失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [executorId, providers, settings.providers]);

  useEffect(() => {
    if (!providerSlug) return;
    const provider = settings.providers?.[providerSlug];
    if (!provider) return;
    if (provider.models[modelId] && !provider.models[modelId]?.disabled) return;
    const first = Object.keys(provider.models).find((id) => !provider.models[id]?.disabled);
    if (first) setModelId(first);
  }, [providerSlug, modelId, settings.providers]);

  if (!executorId) return null;

  const selectedProvider = settings.providers?.[providerSlug];
  const modelRef =
    providerSlug && modelId ? formatModelRef(providerSlug, modelId) : "";

  const handleSave = async () => {
    if (!config || !modelRef) return;
    setSaving(true);
    setError(null);
    try {
      const { config: next, settings: nextSettings } = await api.updateAcpCliConfig(
        executorId,
        { modelRef },
      );
      setConfig(next);
      onSaved?.(nextSettings);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="acp-cli-config-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-panel tools-acp-config-modal">
        <div className="tools-add-cli-head">
          <h4 id="acp-cli-config-title">{config?.label ?? "CLI 模型映射"}</h4>
          <button type="button" className="btn linkish" onClick={onClose}>
            关闭
          </button>
        </div>

        <p className="settings-hint tools-acp-config-lead">
          从 OpenX 已配置的渠道与模型中选择，保存后自动写入本机 CLI 配置（Codex：
          <code>~/.codex</code>，Claude：<code>~/.claude/settings.json</code>）。
        </p>

        {loading ? (
          <p className="settings-hint">加载配置…</p>
        ) : config ? (
          <>
            {providers.length === 0 ? (
              <p className="settings-hint warn-text">
                请先在「设置 → 模型」中添加渠道并配置 API Key。
              </p>
            ) : (
              <>
                <div className="form-field">
                  <label className="form-label" htmlFor="acp-provider">
                    渠道
                  </label>
                  <select
                    id="acp-provider"
                    className="field-input"
                    value={providerSlug}
                    onChange={(e) => setProviderSlug(e.target.value)}
                  >
                    {providers.map(([slug, provider]) => (
                      <option key={slug} value={slug}>
                        {provider.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-field">
                  <label className="form-label" htmlFor="acp-model">
                    模型
                  </label>
                  <select
                    id="acp-model"
                    className="field-input"
                    value={modelId}
                    onChange={(e) => setModelId(e.target.value)}
                    disabled={modelsForProvider.length === 0}
                  >
                    {modelsForProvider.map(([id, model]) => (
                      <option key={id} value={id}>
                        {model.name && model.name !== id ? `${model.name} (${id})` : id}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedProvider && (
                  <p className="settings-hint">
                    {executorId === "acp:codex" ? (
                      <>
                        Codex 经本地 Responses 代理（<code>{config.baseUrl}</code>）路由到渠道{" "}
                        <code>{selectedProvider.api.baseUrl}</code>。请先运行{" "}
                        <code>node scripts/start-codex-proxy.mjs</code>。
                      </>
                    ) : (
                      <>
                        Claude 直连上游 Anthropic 兼容端点（<code>{selectedProvider.api.baseUrl}</code>
                        ），不经 Responses 代理。
                      </>
                    )}
                    {config.synced ? " · 本机已同步" : " · 保存后写入本机"}
                  </p>
                )}
              </>
            )}

            {error && <p className="settings-hint warn-text">{error}</p>}

            <div className="modal-actions">
              <button type="button" className="btn" onClick={onClose} disabled={saving}>
                取消
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={saving || providers.length === 0 || !modelRef}
                onClick={() => void handleSave()}
              >
                {saving ? "同步中…" : "保存并同步"}
              </button>
            </div>
          </>
        ) : (
          <>
            {error && <p className="settings-hint warn-text">{error}</p>}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={onClose}>
                关闭
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
