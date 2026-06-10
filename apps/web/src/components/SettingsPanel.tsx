import { useEffect, useState } from "react";
import type { Settings } from "@openx/shared";
import type { ExecutorInfo } from "../api";
import { ExecutorPicker } from "./ExecutorPicker";
import { ModelProviderSettings } from "./ModelProviderSettings";
import { WorkspacePicker } from "./WorkspacePicker";

type Props = {
  settings: Settings | null;
  workspaceResolved?: string;
  executors: ExecutorInfo[];
  onSave: (s: Settings) => Promise<void>;
  onWorkspaceSave: (path: string) => Promise<void>;
  onRefreshExecutors: () => Promise<void>;
  onReloadSettings: () => Promise<void>;
};

export function SettingsPanel({
  settings,
  workspaceResolved,
  executors,
  onSave,
  onWorkspaceSave,
  onRefreshExecutors,
  onReloadSettings,
}: Props) {
  const [local, setLocal] = useState<Settings | null>(settings);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [detecting, setDetecting] = useState(false);

  useEffect(() => {
    setLocal(settings);
  }, [settings]);

  if (!local) {
    return (
      <section className="mech-panel">
        <div className="mech-panel-head">
          <h3>设置</h3>
        </div>
        <div className="mech-panel-body">加载中…</div>
      </section>
    );
  }

  const dirty =
    settings && local
      ? JSON.stringify(local) !== JSON.stringify(settings)
      : false;

  const piExecutor = executors.find((e) => e.id === "pi");

  const save = async () => {
    setSaving(true);
    try {
      await onSave(local);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  const detectExecutors = async () => {
    setDetecting(true);
    try {
      await onRefreshExecutors();
    } finally {
      setDetecting(false);
    }
  };

  return (
    <section className="mech-panel">
      <div className="mech-panel-head">
        <h3>设置</h3>
        <span>
          {savedFlash && <span className="settings-saved">已保存</span>}
          {!savedFlash && dirty && <span className="settings-dirty">未保存</span>}
        </span>
      </div>
      <div className="mech-panel-body panel-stack">
        <div className="panel-scroll">
        <h4 className="settings-section-title">默认执行器</h4>
        <ExecutorPicker
          value={local.defaultExecutorId}
          onChange={(id) => setLocal({ ...local, defaultExecutorId: id })}
          executors={executors}
          label="新建目标时的默认执行器"
        />

        <h4 className="settings-section-title">Pi 执行底座（本机）</h4>
        <p className="settings-hint">
          OpenX 进程内嵌 Pi SDK。执行模型在下方「Pi 执行模型」选择，与 Coach 共用 providers 池。
        </p>

        <label className="field-label">单次运行超时（分钟）</label>
        <input
          type="number"
          className="field-input"
          min={1}
          max={60}
          value={Math.round((local.executors.pi.runTimeoutMs ?? 600_000) / 60_000)}
          onChange={(e) => {
            const minutes = Math.max(1, Math.min(60, Number(e.target.value) || 10));
            setLocal({
              ...local,
              executors: {
                pi: { ...local.executors.pi, runTimeoutMs: minutes * 60_000 },
              },
            });
          }}
        />

        <label style={{ fontSize: "0.75rem", color: "var(--text-dim)", display: "block", marginBottom: 4 }}>
          工作目录
        </label>
        <WorkspacePicker
          variant="settings"
          value={settings?.workspaceRoot ?? local.workspaceRoot}
          resolvedPath={workspaceResolved}
          onSave={async (path) => {
            setLocal({ ...local, workspaceRoot: path });
            await onWorkspaceSave(path);
          }}
        />
        <p className="settings-hint">
          与左侧导航的工作目录同步；修改后立即生效。Web 版也可直接粘贴完整路径。
        </p>

        <div className="mech-switch">
          <span>自动执行</span>
          <input
            type="checkbox"
            checked={local.autoExecute}
            onChange={(e) => setLocal({ ...local, autoExecute: e.target.checked })}
          />
        </div>
        <div className="mech-switch">
          <span>完成后通知</span>
          <input
            type="checkbox"
            checked={local.notifyOnComplete}
            onChange={(e) => setLocal({ ...local, notifyOnComplete: e.target.checked })}
          />
        </div>

        <ModelProviderSettings
          settings={local}
          onChange={setLocal}
          onReload={onReloadSettings}
        />

        <p className="settings-hint" style={{ marginBottom: "0.5rem" }}>
          <span style={{ color: piExecutor?.available ? "var(--green)" : "var(--red)" }}>
            {piExecutor?.available ? "●" : "○"}
          </span>{" "}
          {piExecutor?.hint ?? "Pi 内嵌底座"}
        </p>
        <button
          type="button"
          className="btn"
          style={{ width: "100%", marginBottom: "0.75rem", fontSize: "0.72rem" }}
          disabled={detecting}
          onClick={() => void detectExecutors()}
        >
          {detecting ? "检测中…" : "检测 Pi 状态"}
        </button>
        </div>

        <div className="panel-footer">
          <button
            type="button"
            className="btn primary"
            style={{ width: "100%" }}
            disabled={saving}
            onClick={() => void save()}
          >
            保存设置
          </button>
        </div>
      </div>
    </section>
  );
}
