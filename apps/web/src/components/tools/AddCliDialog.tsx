import { useEffect, useMemo, useState } from "react";
import type { Goal, Settings } from "@openx/shared";
import {
  buildCliIntegrationGoal,
  listAvailableCliTemplates,
  slugifyExecutorId,
  type CliTemplate,
} from "@openx/shared";
import { api } from "../../api";
import { getApiBase } from "../../lib/api-base";

type Props = {
  open: boolean;
  autoExecute: boolean;
  onClose: () => void;
  existingIds: string[];
  onCreated: (goal: Goal) => void;
  onSettingsChange?: (settings: Settings) => void;
  onConnectReady?: (executorId: string) => void;
  autoBootstrapConnect?: boolean;
};

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function AddCliDialog({
  open,
  autoExecute,
  onClose,
  existingIds,
  onCreated,
  onSettingsChange,
  onConnectReady,
  autoBootstrapConnect = true,
}: Props) {
  const availableTemplates = useMemo(
    () => listAvailableCliTemplates(existingIds),
    [existingIds],
  );
  const [templateId, setTemplateId] = useState(availableTemplates[0]?.id ?? "");
  const [tutorialUrl, setTutorialUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [connectDisplayName, setConnectDisplayName] = useState("");
  const [connectExecutorId, setConnectExecutorId] = useState("");
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
    setConnectDisplayName(first.name);
    setConnectExecutorId(slugifyExecutorId(first.suggestedExecutorId));
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
    setConnectDisplayName(t.name);
    setConnectExecutorId(slugifyExecutorId(t.suggestedExecutorId));
    setError(null);
  };

  const urlValid = isValidUrl(tutorialUrl);
  const isConnect = template.kind === "connect";
  const executorIdValid = /^[a-z][a-z0-9_-]*$/i.test(connectExecutorId.trim());
  const executorIdTaken = existingIds.includes(connectExecutorId.trim());

  const submit = async () => {
    if (!urlValid) {
      setError("请填写有效的 http(s) 教程链接");
      return;
    }
    if (isConnect) {
      if (!executorIdValid) {
        setError("派单 ID 须以小写字母开头，仅含字母、数字、下划线或连字符");
        return;
      }
      if (executorIdTaken) {
        setError(`派单 ID「${connectExecutorId.trim()}」已存在，请换一个`);
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const trimmedExecutorId = connectExecutorId.trim();
      const serverBaseUrl = getApiBase() || window.location.origin;

      if (isConnect) {
        const { settings: nextSettings, bootstrap } = await api.addCliProfile({
          executorId: trimmedExecutorId,
          displayName: connectDisplayName.trim() || template.name,
          kind: "connect",
          tutorialUrl: tutorialUrl.trim(),
          templateId: template.id,
          addedAt: new Date().toISOString(),
        });
        onSettingsChange?.(nextSettings);

        if (autoBootstrapConnect && bootstrap?.online) {
          onConnectReady?.(trimmedExecutorId);
          onClose();
          return;
        }
        if (autoBootstrapConnect && bootstrap) {
          const phase = bootstrap.status?.phase;
          const hint =
            bootstrap.error?.trim() ||
            bootstrap.status?.lastError?.trim() ||
            (phase === "exited"
              ? `connect-client 已退出（code=${bootstrap.status?.exitCode ?? "?"}）`
              : phase === "running" || phase === "spawning"
                ? `自举进程已启动（pid=${bootstrap.pid ?? bootstrap.status?.pid ?? "?"}），Agent 注册中…`
                : "等待 Agent 上线超时");
          if (phase === "running" || phase === "spawning") {
            onConnectReady?.(trimmedExecutorId);
            setError(`${hint} 可在「工具 → CLI」查看状态；无需创建 Pi 接入任务。`);
            onClose();
            return;
          }
          setError(`自动自举未完成：${hint}。将创建 Pi 接入任务继续排查。`);
        }
      }

      const payload = buildCliIntegrationGoal({
        cliName: connectDisplayName.trim() || template.name,
        tutorialUrl: tutorialUrl.trim(),
        kind: template.kind,
        targetExecutorId: template.kind === "acp" ? template.suggestedExecutorId : undefined,
        connectExecutorId: isConnect ? trimmedExecutorId : undefined,
        serverBaseUrl,
        notes: notes.trim() || undefined,
      });
      const { conversation } = await api.getCliSystemConversation();
      const { goal } = await api.createGoal({
        ...payload,
        conversationId: conversation.id,
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

        {isConnect && (
          <>
            <label className="form-field">
              <span className="form-label">Agent 显示名称</span>
              <input
                className="mech-input"
                value={connectDisplayName}
                onChange={(e) => {
                  setConnectDisplayName(e.target.value);
                  if (!connectExecutorId || connectExecutorId === slugifyExecutorId(template.suggestedExecutorId)) {
                    setConnectExecutorId(slugifyExecutorId(e.target.value || template.name));
                  }
                }}
                placeholder="例如：我的 Codex Worker"
              />
            </label>
            <label className="form-field">
              <span className="form-label">派单 ID（executorId）</span>
              <input
                className="mech-input"
                value={connectExecutorId}
                onChange={(e) => setConnectExecutorId(e.target.value)}
                placeholder="custom-agent"
              />
              {executorIdTaken && (
                <span className="settings-hint warn-text">该 ID 已存在</span>
              )}
            </label>
            <p className="settings-hint">
              创建任务前会先将 CliProfile 写入设置；Pi 只需调用 bootstrap API 启动 connect-client。
            </p>
          </>
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
            disabled={busy || !urlValid || (isConnect && (!executorIdValid || executorIdTaken))}
            onClick={() => void submit()}
          >
            {busy ? "创建中…" : "创建接入任务"}
          </button>
        </div>
      </div>
    </div>
  );
}
