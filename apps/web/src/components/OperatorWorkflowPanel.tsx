import { useCallback, useEffect, useMemo, useState } from "react";
import type { Goal } from "@openx/shared";
import {
  BUILTIN_WORKFLOW_SUMMARIES,
  DISPATCH_PERMISSION_LABELS,
  operatorToolsEnabled,
  type Settings,
} from "@openx/shared";
import { api } from "../api";
import { WORKFLOW_VAR_SCHEMA } from "../lib/workflow-ui";

type Props = {
  /** 已保存到服务端的设置 */
  savedSettings: Settings | null;
  /** 设置面板当前编辑中的草稿 */
  draftSettings: Settings;
  projectId?: string | null;
  goals?: Goal[];
};

export function OperatorWorkflowPanel({
  savedSettings,
  draftSettings,
  projectId,
  goals = [],
}: Props) {
  const draftTier = draftSettings.operatorTier ?? "off";
  const savedTier = savedSettings?.operatorTier ?? "off";
  const draftEnabled = operatorToolsEnabled(draftTier);
  const savedEnabled = operatorToolsEnabled(savedTier);
  const tierDirty = savedTier !== draftTier;

  const workflows = BUILTIN_WORKFLOW_SUMMARIES;
  const [selectedId, setSelectedId] = useState(workflows[0]?.id ?? "");
  const [vars, setVars] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    ok: boolean;
    steps: Array<{ id: string; ok: boolean; detail: string }>;
  } | null>(null);

  useEffect(() => {
    if (!draftEnabled) return;
    setSelectedId((prev) => prev || workflows[0]?.id || "");
  }, [draftEnabled, workflows]);

  const selected = workflows.find((w) => w.id === selectedId);
  const varFields = selectedId ? WORKFLOW_VAR_SCHEMA[selectedId]?.fields ?? [] : [];

  const defaultVars = useMemo(() => {
    const next: Record<string, string> = {};
    if (selectedId === "memory_distill" && projectId) {
      next.projectId = projectId;
    }
    if (selectedId === "goal_review_batch") {
      const awaiting = goals.find((g) => g.status === "awaiting_review");
      if (awaiting) next.goalId = awaiting.id;
    }
    return next;
  }, [selectedId, projectId, goals]);

  useEffect(() => {
    setVars(defaultVars);
    setResult(null);
    setError(null);
  }, [selectedId, defaultVars]);

  const updateVar = useCallback((key: string, value: string) => {
    setVars((prev) => ({ ...prev, [key]: value }));
  }, []);

  const canRun = savedEnabled && !tierDirty && Boolean(selectedId);

  const runWorkflow = async () => {
    if (!selectedId || !canRun) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const payloadVars = Object.fromEntries(
        Object.entries(vars).filter(([, v]) => v.trim()),
      );
      const res = await api.runOperatorWorkflow(selectedId, {
        vars: payloadVars,
        stopOnError: true,
      });
      setResult(res);
      if (!res.ok) {
        setError("部分步骤未成功，请查看下方明细");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/403|off|权限/i.test(message)) {
        setError("服务端工头权限未开启：请保存设置（工头自控权限 ≥ 只读）后重试");
      } else {
        setError(message);
      }
    } finally {
      setRunning(false);
    }
  };

  if (!draftEnabled) {
    return (
      <section className="settings-section">
        <h4 className="settings-section-title">自动化 Workflow</h4>
        <p className="settings-hint settings-hint-tight">
          将工头自控权限设为 read 及以上后，可在此运行内置自动化流程（Connect 自举、审查触发、记忆蒸馏等）。
        </p>
      </section>
    );
  }

  return (
    <section className="settings-section operator-workflow-section">
      <h4 className="settings-section-title">自动化 Workflow</h4>
      <p className="settings-hint settings-hint-tight">
        按步骤调用 OpenX 内部 API；admin 写操作若需确认，会在对话中出现待确认卡片。
      </p>

      {tierDirty ? (
        <p className="settings-hint settings-hint-warn">
          工头权限已修改但未保存。请先点击底部「保存设置」，再运行 Workflow。
        </p>
      ) : !savedEnabled ? (
        <p className="settings-hint settings-hint-warn">
          当前服务端仍为关闭状态。请保存设置（工头自控权限 ≥ 只读）后再运行。
        </p>
      ) : null}

      <div className="operator-workflow-grid">
        <label className="field-label">选择流程</label>
        <select
          className="mech-input"
          value={selectedId}
          onChange={(e) => {
            setSelectedId(e.target.value);
            setResult(null);
            setError(null);
            setVars({});
          }}
        >
          {workflows.length === 0 ? (
            <option value="">（无可用流程）</option>
          ) : (
            workflows.map((flow) => (
              <option key={flow.id} value={flow.id}>
                {flow.title}（{flow.stepCount} 步）
              </option>
            ))
          )}
        </select>
        {selected?.description ? (
          <p className="settings-hint settings-hint-tight">{selected.description}</p>
        ) : null}

        {varFields.length > 0 ? (
          <div className="operator-workflow-vars">
            {varFields.map((field) => (
              <div key={field.key} className="form-field">
                <label className="form-label">
                  {field.label}
                  {field.required ? " *" : ""}
                </label>
                <input
                  className="mech-input"
                  value={vars[field.key] ?? ""}
                  placeholder={field.placeholder}
                  onChange={(e) => updateVar(field.key, e.target.value)}
                />
              </div>
            ))}
          </div>
        ) : null}

        <div className="operator-workflow-actions">
          <button
            type="button"
            className="btn primary"
            disabled={running || !canRun}
            onClick={() => void runWorkflow()}
          >
            {running ? "运行中…" : "运行 Workflow"}
          </button>
        </div>

        {error ? <p className="settings-hint settings-hint-warn">{error}</p> : null}

        {result ? (
          <ul className="operator-workflow-steps" aria-live="polite">
            {result.steps.map((step) => (
              <li
                key={step.id}
                className={`operator-workflow-step${step.ok ? " ok" : " fail"}`}
              >
                <span className="operator-workflow-step-id">{step.id}</span>
                <span className="operator-workflow-step-detail">{step.detail}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

export function formatPermissionModeLabel(
  mode?: import("@openx/shared").DispatchPermissionMode,
): string | null {
  if (!mode) return null;
  return DISPATCH_PERMISSION_LABELS[mode]?.label ?? mode;
}
