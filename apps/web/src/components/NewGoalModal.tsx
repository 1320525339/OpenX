import { useEffect, useState } from "react";
import type { Goal } from "@openx/shared";
import type { DispatchPermissionMode } from "@openx/shared";
import { api, type ExecutorInfo } from "../api";
import { ExecutorPicker } from "./ExecutorPicker";
import { defaultExecutorChoice, defaultConnectExecutorChoice, filterConnectExecutors } from "../lib/executors";
import { loadPermissionSelection, permissionModeFromSelection } from "../lib/coach-context";
import { PERMISSION_PICKER_OPTIONS } from "../lib/workflow-ui";

type Props = {
  conversationId: string;
  autoExecute: boolean;
  executors: ExecutorInfo[];
  defaultExecutorId?: string;
  connectOnly?: boolean;
  modalTitle?: string;
  onClose: () => void;
  onCreated: (goal: Goal) => void;
};

export function NewGoalModal({
  conversationId,
  autoExecute,
  executors,
  defaultExecutorId,
  connectOnly = false,
  modalTitle = "新目标",
  onClose,
  onCreated,
}: Props) {
  const scopedExecutors = connectOnly ? filterConnectExecutors(executors) : executors;
  const [userDraft, setUserDraft] = useState("");
  const [title, setTitle] = useState("");
  const [acceptance, setAcceptance] = useState("");
  const [executionPrompt, setExecutionPrompt] = useState("");
  const [executorId, setExecutorId] = useState(() =>
    connectOnly
      ? defaultConnectExecutorChoice(filterConnectExecutors(executors))
      : defaultExecutorChoice(executors, defaultExecutorId),
  );
  const [step, setStep] = useState<"draft" | "review">("draft");
  const [autoReview, setAutoReview] = useState(true);
  const [permissionMode, setPermissionMode] = useState<
    DispatchPermissionMode | undefined
  >(() => permissionModeFromSelection(loadPermissionSelection()));
  const [loading, setLoading] = useState(false);
  const [refineWarn, setRefineWarn] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setExecutorId(
      connectOnly
        ? defaultConnectExecutorChoice(scopedExecutors)
        : defaultExecutorChoice(scopedExecutors, defaultExecutorId),
    );
  }, [executors, defaultExecutorId, connectOnly, scopedExecutors]);

  const refine = async () => {
    if (!userDraft.trim()) return;
    setLoading(true);
    setRefineWarn(undefined);
    setError(null);
    try {
      const refined = await api.coachRefine(userDraft.trim());
      setTitle(refined.title);
      setAcceptance(refined.acceptance);
      setExecutionPrompt(refined.executionPrompt);
      if (refined.meta?.quotaExceeded) {
        setRefineWarn(refined.meta.llmError);
      }
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "优化失败");
    } finally {
      setLoading(false);
    }
  };

  const submit = async (start: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const { goal } = await api.createGoal({
        conversationId,
        userDraft: userDraft.trim(),
        executorId,
        title,
        acceptance,
        executionPrompt,
        autoStart: start,
        autoReview,
        dispatchContext: {
          agentId: "coder",
          ...(permissionMode ? { permissionMode } : {}),
        },
      });
      onCreated(goal);
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="mech-panel modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">{modalTitle}</h2>

        {error && (
          <p className="approve-confirm" style={{ marginBottom: "0.5rem", borderColor: "var(--red)", color: "var(--red)" }}>
            {error}
          </p>
        )}

        {step === "draft" && (
          <>
            <div className="form-field">
              <label className="form-label">目标草稿</label>
              <textarea
                className="mech-textarea"
                value={userDraft}
                onChange={(e) => setUserDraft(e.target.value)}
                rows={4}
                placeholder="描述要达成什么、验收标准…"
              />
            </div>
            <ExecutorPicker
              value={executorId}
              onChange={setExecutorId}
              executors={scopedExecutors}
              includeAuto={!connectOnly}
            />
            <div className="modal-actions">
              <button type="button" className="btn" onClick={onClose}>
                取消
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={loading || !userDraft.trim()}
                onClick={() => void refine()}
              >
                {loading ? "Coach 优化中…" : "优化提示词 →"}
              </button>
            </div>
          </>
        )}

        {step === "review" && (
          <>
            {refineWarn && (
              <p className="approve-confirm" style={{ marginBottom: "0.5rem" }}>
                ⚠ {refineWarn}
              </p>
            )}
            <ExecutorPicker
              value={executorId}
              onChange={setExecutorId}
              executors={scopedExecutors}
              includeAuto={!connectOnly}
            />
            <div className="form-field">
              <label className="form-label">派单权限</label>
              <select
                className="mech-input"
                value={permissionMode ?? "default"}
                onChange={(e) => {
                  const v = e.target.value;
                  setPermissionMode(
                    v === "default" ? undefined : (v as DispatchPermissionMode),
                  );
                }}
              >
                {PERMISSION_PICKER_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label} — {opt.description}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label className="form-label">标题</label>
              <input
                className="mech-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label className="form-label">验收标准</label>
              <textarea
                className="mech-textarea"
                value={acceptance}
                onChange={(e) => setAcceptance(e.target.value)}
                rows={2}
              />
            </div>
            <div className="form-field">
              <label className="form-label">执行提示词（发给 CLI）</label>
              <textarea
                className="mech-textarea"
                value={executionPrompt}
                onChange={(e) => setExecutionPrompt(e.target.value)}
                rows={5}
              />
            </div>
            <div className="form-field">
              <label
                className="form-label"
                style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}
              >
                <input
                  type="checkbox"
                  checked={autoReview}
                  onChange={(e) => setAutoReview(e.target.checked)}
                />
                自动验收循环（Coach 按验收标准判定，不达标自动返工，最多 5 轮）
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn" disabled={loading} onClick={() => setStep("draft")}>
                返回
              </button>
              {!autoExecute && (
                <button
                  type="button"
                  className="btn"
                  disabled={loading}
                  onClick={() => void submit(false)}
                >
                  保存草稿
                </button>
              )}
              <button
                type="button"
                className="btn primary"
                disabled={loading}
                onClick={() => void submit(true)}
              >
                {loading ? "提交中…" : autoExecute ? "创建并执行" : "开始执行"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
