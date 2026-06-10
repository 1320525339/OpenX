import { useEffect, useMemo, useState } from "react";
import type { Goal } from "@openx/shared";
import {
  buildCliIntegrationGoal,
  listAvailableCliTemplates,
  type CliTemplate,
} from "@openx/shared";
import { api } from "../../api";

type Props = {
  open: boolean;
  autoExecute: boolean;
  onClose: () => void;
  existingIds: string[];
  onCreated: (goal: Goal) => void;
};

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function AddCliDialog({ open, autoExecute, onClose, existingIds, onCreated }: Props) {
  const availableTemplates = useMemo(
    () => listAvailableCliTemplates(existingIds),
    [existingIds],
  );
  const [templateId, setTemplateId] = useState(availableTemplates[0]?.id ?? "");
  const [tutorialUrl, setTutorialUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const template = useMemo(
    () => availableTemplates.find((t) => t.id === templateId) ?? availableTemplates[0],
    [availableTemplates, templateId],
  );

  useEffect(() => {
    if (!open) return;
    const first = availableTemplates[0];
    if (!first) return;
    setTemplateId(first.id);
    setTutorialUrl(first.tutorialUrl);
    setNotes("");
    setError(null);
  }, [open, availableTemplates]);

  if (!open) return null;

  if (!template || availableTemplates.length === 0) {
    return (
      <div className="modal-overlay" role="dialog" aria-modal="true">
        <div className="modal-panel tools-add-cli-modal">
          <div className="tools-add-cli-head">
            <h4>添加 Agent CLI</h4>
            <button type="button" className="btn linkish" onClick={onClose}>
              关闭
            </button>
          </div>
          <p className="settings-hint">当前预置 ACP 运行均已可用。如需 Connect Agent，请稍后再试。</p>
        </div>
      </div>
    );
  }

  const applyTemplate = (t: CliTemplate) => {
    setTemplateId(t.id);
    setTutorialUrl(t.tutorialUrl);
    setError(null);
  };

  const urlValid = isValidUrl(tutorialUrl);

  const submit = async () => {
    if (!urlValid) {
      setError("请填写有效的 http(s) 教程链接");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = buildCliIntegrationGoal({
        cliName: template.name,
        tutorialUrl: tutorialUrl.trim(),
        kind: template.kind,
        targetExecutorId: template.kind === "acp" ? template.suggestedExecutorId : undefined,
        notes: notes.trim() || undefined,
      });
      const { goal } = await api.createGoal({
        ...payload,
        executorId: "pi",
        autoStart: autoExecute,
      });
      onCreated(goal);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-panel tools-add-cli-modal">
        <div className="tools-add-cli-head">
          <h4>添加 Agent CLI</h4>
          <button type="button" className="btn linkish" onClick={onClose}>
            关闭
          </button>
        </div>

        <p className="settings-hint">
          选择 CLI 类型并填入接入教程链接，OpenX 将创建 Pi 接入任务，由 Pi 完成安装与配置（无需手动填写派单 ID）。
        </p>

        <div className="tools-template-grid">
          {availableTemplates.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`tools-template-card${t.id === templateId ? " active" : ""}`}
              onClick={() => applyTemplate(t)}
            >
              <strong>{t.name}</strong>
              <span>{t.description}</span>
            </button>
          ))}
        </div>

        <label className="form-field">
          <span className="form-label">接入教程链接</span>
          <input
            className="mech-input"
            value={tutorialUrl}
            onChange={(e) => setTutorialUrl(e.target.value)}
            placeholder="https://..."
          />
        </label>

        {urlValid && (
          <a
            className="tools-tutorial-link"
            href={tutorialUrl.trim()}
            target="_blank"
            rel="noopener noreferrer"
          >
            预览教程 ↗
          </a>
        )}

        <label className="form-field">
          <span className="form-label">补充说明（可选）</span>
          <textarea
            className="mech-input"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="例如：使用公司代理安装、指定安装路径等"
          />
        </label>

        {error && <p className="settings-hint warn-text">{error}</p>}

        <div className="tools-add-cli-actions">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !urlValid}
            onClick={() => void submit()}
          >
            {busy ? "创建中…" : "创建接入任务"}
          </button>
        </div>
      </div>
    </div>
  );
}
