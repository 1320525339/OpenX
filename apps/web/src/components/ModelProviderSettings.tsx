import { useCallback, useEffect, useState } from "react";
import type { Settings, ProviderConfig, LlmProviderId } from "@openx/shared";
import { listConfiguredModelRefs, providerConfigFromTemplate } from "@openx/shared";
import { api, type LlmTemplateInfo, type ModelRuntime } from "../api";

type Props = {
  settings: Settings;
  onChange: (settings: Settings) => void;
  onReload: () => Promise<void>;
};

type EditorState = {
  mode: "add" | "edit";
  slug: string;
  config: ProviderConfig;
  templateId?: LlmProviderId;
};

function slugFromTemplate(id: LlmProviderId, existing: Record<string, unknown>): string {
  const base = id === "opencode-zen" ? "zen" : id;
  if (!existing[base]) return base;
  let i = 2;
  while (existing[`${base}-${i}`]) i += 1;
  return `${base}-${i}`;
}

function mergeModelsIntoConfig(
  config: ProviderConfig,
  fetched: { id: string; name?: string }[],
): ProviderConfig {
  const models = { ...config.models };
  for (const item of fetched) {
    const id = item.id.trim();
    if (!id) continue;
    const prev = models[id];
    models[id] = {
      ...prev,
      name: item.name ?? prev?.name ?? id,
      disabled: prev?.disabled,
    };
  }
  return { ...config, models };
}

function toggleModelInEditor(editor: EditorState, modelId: string, enabled: boolean): EditorState {
  return {
    ...editor,
    config: {
      ...editor.config,
      models: {
        ...editor.config.models,
        [modelId]: {
          ...editor.config.models[modelId],
          disabled: enabled ? undefined : true,
        },
      },
    },
  };
}

function removeModelFromEditor(editor: EditorState, modelId: string): EditorState {
  const models = { ...editor.config.models };
  delete models[modelId];
  return { ...editor, config: { ...editor.config, models } };
}

function addManualModel(editor: EditorState, modelId: string): EditorState | null {
  const id = modelId.trim();
  if (!id) return null;
  return {
    ...editor,
    config: {
      ...editor.config,
      models: {
        ...editor.config.models,
        [id]: editor.config.models[id] ?? { name: id },
      },
    },
  };
}

function roleStatusLabel(runtime: ModelRuntime | undefined): string {
  if (!runtime) return "—";
  return runtime.ready ? "已连接" : "待配置";
}

export function ModelProviderSettings({ settings, onChange, onReload }: Props) {
  const [templates, setTemplates] = useState<LlmTemplateInfo[]>([]);
  const [status, setStatus] = useState<{ coach: ModelRuntime; pi: ModelRuntime } | null>(null);
  const [testing, setTesting] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [busy, setBusy] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [manualModelId, setManualModelId] = useState("");
  const [fetchNotice, setFetchNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const providers = settings.providers ?? {};
  const modelRefs = listConfiguredModelRefs(settings);
  const hasZen = Object.values(providers).some((p) => p.source?.template === "opencode-zen");

  const refreshStatus = useCallback(() => {
    void api.getModelStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    void api.getModelTemplates().then((r) => setTemplates(r.templates));
    refreshStatus();
  }, [settings, refreshStatus]);

  const applyZenPreset = async () => {
    setBusy(true);
    setError(null);
    try {
      const config = providerConfigFromTemplate("opencode-zen");
      const slug = providers.zen ? "zen" : slugFromTemplate("opencode-zen", providers);
      const result = providers[slug]
        ? await api.updateModelProvider(slug, config)
        : await api.createModelProvider(slug, config);
      const coachRef = `${slug}/big-pickle`;
      onChange({
        ...result.settings,
        model: {
          coach: coachRef,
          pi: coachRef,
          default: coachRef,
        },
      });
      await onReload();
      refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const startAdd = (templateId: LlmProviderId) => {
    const slug = slugFromTemplate(templateId, providers);
    setEditor({
      mode: "add",
      slug,
      templateId,
      config: providerConfigFromTemplate(templateId),
    });
    setManualModelId("");
    setFetchNotice(null);
    setError(null);
  };

  const startEdit = (slug: string) => {
    const config = providers[slug];
    if (!config) return;
    setEditor({
      mode: "edit",
      slug,
      config: structuredClone(config),
      templateId: config.source?.template as LlmProviderId | undefined,
    });
    setManualModelId("");
    setFetchNotice(null);
    setError(null);
  };

  const fetchModelsForEditor = async () => {
    if (!editor) return;
    setFetchingModels(true);
    setFetchNotice(null);
    setError(null);
    try {
      const result = await api.fetchProviderModels({
        slug: editor.slug,
        config: editor.config,
      });
      if (!result.ok || !result.models?.length) {
        setError(result.error ?? "未能获取模型列表");
        return;
      }
      setEditor((prev) =>
        prev
          ? { ...prev, config: mergeModelsIntoConfig(prev.config, result.models!) }
          : prev,
      );
      if (result.warning) setFetchNotice(result.warning);
      else if (result.source === "template") setFetchNotice("已使用模板内置模型列表");
      else setFetchNotice(`已获取 ${result.models.length} 个模型`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetchingModels(false);
    }
  };

  const saveProvider = async () => {
    if (!editor) return;
    const enabledCount = Object.values(editor.config.models).filter((m) => !m.disabled).length;
    if (enabledCount === 0) {
      setError("至少保留一个可用模型");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result =
        editor.mode === "add"
          ? await api.createModelProvider(editor.slug, editor.config)
          : await api.updateModelProvider(editor.slug, editor.config);
      onChange(result.settings);
      setEditor(null);
      await onReload();
      refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const removeProvider = async (slug: string) => {
    if (!confirm(`确定删除渠道「${slug}」？`)) return;
    setBusy(true);
    try {
      const result = await api.deleteModelProvider(slug);
      onChange(result.settings);
      await onReload();
      refreshStatus();
    } finally {
      setBusy(false);
    }
  };

  const testProvider = async (slug?: string, config?: ProviderConfig) => {
    setTesting(true);
    try {
      const result = await api.testModelConnection(
        slug && config ? { slug, config } : { role: "coach" },
      );
      refreshStatus();
      if (!result.ok) {
        setError(result.error ?? "连接失败");
      } else {
        setError(null);
      }
    } finally {
      setTesting(false);
    }
  };

  const popular = templates.filter((t) => t.popular);
  const others = templates.filter((t) => !t.popular);

  return (
    <section className="settings-section model-provider-settings">
      <h4 className="settings-section-title">模型渠道</h4>

      {!hasZen && !editor && (
        <div className="provider-quick-actions">
          <button
            type="button"
            className="btn primary compact"
            disabled={busy}
            onClick={() => void applyZenPreset()}
          >
            应用 OpenCode Zen 免费预设
          </button>
        </div>
      )}

      <div className="model-role-grid">
        <div className="model-role-field">
          <label className="field-label">助手模型</label>
          <select
            className="field-input"
            value={settings.model?.coach ?? ""}
            onChange={(e) =>
              onChange({
                ...settings,
                model: { ...settings.model!, coach: e.target.value },
              })
            }
          >
            {modelRefs.map((m) => (
              <option key={m.ref} value={m.ref}>
                {m.label}
              </option>
            ))}
          </select>
          <span className={`model-role-status${status?.coach.ready ? " ok" : ""}`}>
            {roleStatusLabel(status?.coach)}
          </span>
        </div>

        <div className="model-role-field">
          <label className="field-label">Pi 执行模型</label>
          <select
            className="field-input"
            value={settings.model?.pi ?? ""}
            onChange={(e) =>
              onChange({
                ...settings,
                model: { ...settings.model!, pi: e.target.value },
              })
            }
          >
            {modelRefs.map((m) => (
              <option key={m.ref} value={m.ref}>
                {m.label}
              </option>
            ))}
          </select>
          <span className={`model-role-status${status?.pi.ready ? " ok" : ""}`}>
            {roleStatusLabel(status?.pi)}
          </span>
        </div>
      </div>

      <div className="model-role-actions">
        <button
          type="button"
          className="btn compact"
          disabled={testing}
          onClick={() => void testProvider()}
        >
          {testing ? "测试中…" : "测试助手连接"}
        </button>
        {hasZen && !editor && (
          <button
            type="button"
            className="btn compact"
            disabled={busy}
            onClick={() => void applyZenPreset()}
          >
            重置 Zen 预设
          </button>
        )}
      </div>

      <div className="provider-section-label">已配置渠道</div>
      {Object.keys(providers).length === 0 ? (
        <p className="settings-hint settings-hint-tight">暂无渠道，请从下方模板添加。</p>
      ) : (
        <ul className="provider-list">
          {Object.entries(providers).map(([slug, config]) => (
            <li key={slug} className="provider-list-item">
              <div>
                <strong>{config.name}</strong>
                <span className="provider-list-slug">{slug}</span>
                <p className="settings-hint settings-hint-tight">{config.api.baseUrl}</p>
              </div>
              <div className="provider-list-actions">
                <button type="button" className="btn compact" onClick={() => startEdit(slug)}>
                  编辑
                </button>
                <button
                  type="button"
                  className="btn compact"
                  disabled={busy}
                  onClick={() => void removeProvider(slug)}
                >
                  删除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!editor && (
        <>
          <div className="provider-section-label">从模板新增</div>
          <div className="provider-grid">
            {popular.map((t) => (
              <button
                key={t.id}
                type="button"
                className="provider-chip"
                disabled={busy}
                onClick={() => startAdd(t.id)}
              >
                <span className="provider-chip-name">{t.name}</span>
                <span className="provider-chip-desc">{t.tagline}</span>
              </button>
            ))}
          </div>
          <div className="provider-grid compact">
            {others.map((t) => (
              <button
                key={t.id}
                type="button"
                className="provider-chip"
                disabled={busy}
                onClick={() => startAdd(t.id)}
              >
                <span className="provider-chip-name">{t.name}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {editor && (
        <div className="provider-editor">
          <h4 className="settings-section-title">
            {editor.mode === "add" ? "新增渠道" : "编辑渠道"}
          </h4>

          <label className="field-label">Slug</label>
          <input
            className="field-input"
            value={editor.slug}
            disabled={editor.mode === "edit"}
            onChange={(e) => setEditor({ ...editor, slug: e.target.value.toLowerCase() })}
            placeholder="zen / corp-openai"
          />

          <label className="field-label">显示名称</label>
          <input
            className="field-input"
            value={editor.config.name}
            onChange={(e) =>
              setEditor({
                ...editor,
                config: { ...editor.config, name: e.target.value },
              })
            }
          />

          <label className="field-label">API Base URL</label>
          <input
            className="field-input"
            value={editor.config.api.baseUrl}
            onChange={(e) =>
              setEditor({
                ...editor,
                config: {
                  ...editor.config,
                  api: { ...editor.config.api, baseUrl: e.target.value },
                },
              })
            }
          />

          <label className="field-label">API Key</label>
          <input
            className="field-input"
            type="password"
            value={editor.config.auth?.apiKey ?? ""}
            onChange={(e) =>
              setEditor({
                ...editor,
                config: {
                  ...editor.config,
                  auth: { ...editor.config.auth, apiKey: e.target.value || undefined },
                },
              })
            }
            autoComplete="off"
          />

          <label className="field-label">模型列表</label>
          <div className="provider-model-toolbar">
            <button
              type="button"
              className="btn compact"
              disabled={fetchingModels || busy}
              onClick={() => void fetchModelsForEditor()}
            >
              {fetchingModels ? "获取中…" : "自动获取模型列表"}
            </button>
            <div className="provider-model-add">
              <input
                className="field-input provider-model-add-input"
                placeholder="手动添加模型 ID"
                value={manualModelId}
                onChange={(e) => setManualModelId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  const next = addManualModel(editor, manualModelId);
                  if (!next) return;
                  setEditor(next);
                  setManualModelId("");
                }}
              />
              <button
                type="button"
                className="btn compact"
                disabled={!manualModelId.trim() || busy}
                onClick={() => {
                  const next = addManualModel(editor, manualModelId);
                  if (!next) return;
                  setEditor(next);
                  setManualModelId("");
                }}
              >
                添加
              </button>
            </div>
          </div>
          {fetchNotice && <p className="settings-hint settings-hint-tight">{fetchNotice}</p>}
          {Object.keys(editor.config.models).length === 0 ? (
            <p className="settings-hint settings-hint-tight">
              填写 API Key 后获取模型列表，或手动添加模型 ID。
            </p>
          ) : (
            <ul className="provider-model-list">
              {Object.entries(editor.config.models)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([id, model]) => (
                  <li key={id} className="provider-model-item">
                    <label className="provider-model-check">
                      <input
                        type="checkbox"
                        checked={!model.disabled}
                        onChange={(e) =>
                          setEditor(toggleModelInEditor(editor, id, e.target.checked))
                        }
                      />
                      <span className="provider-model-id">{id}</span>
                      {model.name && model.name !== id && (
                        <span className="provider-model-name">{model.name}</span>
                      )}
                    </label>
                    <button
                      type="button"
                      className="btn compact"
                      disabled={busy}
                      onClick={() => setEditor(removeModelFromEditor(editor, id))}
                    >
                      移除
                    </button>
                  </li>
                ))}
            </ul>
          )}

          <div className="provider-editor-actions">
            <button
              type="button"
              className="btn compact"
              disabled={testing}
              onClick={() => void testProvider(editor.slug, editor.config)}
            >
              {testing ? "测试中…" : "测试连接"}
            </button>
            <button type="button" className="btn primary compact" disabled={busy} onClick={() => void saveProvider()}>
              {busy ? "保存中…" : "保存渠道"}
            </button>
            <button type="button" className="btn compact" onClick={() => setEditor(null)}>
              取消
            </button>
          </div>
        </div>
      )}

      {error && <p className="settings-hint warn">{error}</p>}
    </section>
  );
}
