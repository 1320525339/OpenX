import { useState } from "react";
import type { BatchGoalsAction, Goal } from "@openx/shared";
import { EXECUTOR_AUTO } from "@openx/shared";
import { executorDisplayLabel } from "../lib/executors";
import { goalsEligibleForAction } from "../lib/goal-batch";

const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "draft", label: "先放着" },
  { key: "running", label: "正在推进" },
  { key: "awaiting_review", label: "等你确认" },
  { key: "done", label: "已完成" },
  { key: "rework", label: "需要返工" },
];

type Props = {
  goals: Goal[];
  allGoals: Goal[];
  filter: string;
  onFilterChange: (f: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewGoal: () => void;
  editMode: boolean;
  onEditModeChange: (edit: boolean) => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onSelectAllVisible: () => void;
  onClearSelection: () => void;
  onBatchAction: (action: BatchGoalsAction, ids: string[]) => Promise<void>;
  onApprove: (id: string) => Promise<void>;
  onRework: (id: string, reason?: string) => Promise<void>;
  onStart: (id: string) => Promise<void>;
};

function countForFilter(goals: Goal[], key: string): number {
  if (key === "all") return goals.length;
  if (key === "rework") return goals.filter((g) => g.effectStatus === "rework").length;
  return goals.filter((g) => g.status === key).length;
}

function userStatusLabel(goal: Goal): string {
  if (goal.effectStatus === "rework") return "需要返工";
  if (goal.status === "draft") return "先放着";
  if (goal.status === "running") return "正在推进";
  if (goal.status === "awaiting_review") return "等你确认";
  if (goal.status === "done") return "已完成";
  if (goal.status === "failed") return "卡住了";
  return goal.status;
}

function executorLabel(executorId: Goal["executorId"]): string {
  if (executorId === EXECUTOR_AUTO) return "自动";
  return executorDisplayLabel(executorId);
}

export function TasksPanel({
  goals,
  allGoals,
  filter,
  onFilterChange,
  selectedId,
  onSelect,
  onNewGoal,
  editMode,
  onEditModeChange,
  selectedIds,
  onToggleSelect,
  onSelectAllVisible,
  onClearSelection,
  onBatchAction,
  onApprove,
  onRework,
  onStart,
}: Props) {
  const [approveId, setApproveId] = useState<string | null>(null);
  const [reworkId, setReworkId] = useState<string | null>(null);
  const [reworkReason, setReworkReason] = useState("");
  const [batchBusy, setBatchBusy] = useState(false);

  const doneRate =
    allGoals.length > 0
      ? Math.round(
          (allGoals.filter((g) => g.status === "done").length / allGoals.length) * 100,
        )
      : 0;

  const selectedGoals = allGoals.filter((g) => selectedIds.has(g.id));
  const startN = goalsEligibleForAction(selectedGoals, "start").length;
  const cancelN = goalsEligibleForAction(selectedGoals, "cancel").length;
  const approveN = goalsEligibleForAction(selectedGoals, "approve").length;
  const deleteN = selectedIds.size;
  const allVisibleSelected =
    goals.length > 0 && goals.every((g) => selectedIds.has(g.id));

  const runBatch = async (action: BatchGoalsAction) => {
    if (selectedIds.size === 0 || batchBusy) return;
    const ids = [...selectedIds];

    if (action === "delete") {
      const ok = window.confirm(
        `确定彻底删除 ${ids.length} 个目标？\n将同时移除子目标，且不可恢复。`,
      );
      if (!ok) return;
    } else if (action === "approve") {
      const eligible = goalsEligibleForAction(selectedGoals, "approve");
      if (eligible.length === 0) return;
      const ok = window.confirm(`确认将 ${eligible.length} 个目标标记为已完成？`);
      if (!ok) return;
    }

    setBatchBusy(true);
    try {
      const targetIds =
        action === "start"
          ? goalsEligibleForAction(selectedGoals, "start").map((g) => g.id)
          : action === "cancel"
            ? goalsEligibleForAction(selectedGoals, "cancel").map((g) => g.id)
            : action === "approve"
              ? goalsEligibleForAction(selectedGoals, "approve").map((g) => g.id)
              : ids;
      if (targetIds.length === 0) return;
      await onBatchAction(action, targetIds);
    } finally {
      setBatchBusy(false);
    }
  };

  const exitEditMode = () => {
    onClearSelection();
    onEditModeChange(false);
  };

  return (
    <section className={`mech-panel${editMode ? " tasks-panel-editing" : ""}`}>
      <div className="mech-panel-head">
        <div className="tasks-panel-head-left">
          <h3>目标</h3>
          <span className="coach-badge">
            {allGoals.length} 个目标 · 完成 {doneRate}%
          </span>
        </div>
        {editMode ? (
          <button type="button" className="btn tasks-edit-toggle" onClick={exitEditMode}>
            完成
          </button>
        ) : (
          <button
            type="button"
            className="btn tasks-edit-toggle"
            onClick={() => onEditModeChange(true)}
          >
            编辑
          </button>
        )}
      </div>
      <div className="mech-panel-body panel-stack">
        <div className="filter-row">
          {FILTERS.map(({ key, label }) => {
            const n = countForFilter(allGoals, key);
            return (
              <button
                key={key}
                type="button"
                className={`filter-chip${filter === key ? " active" : ""}`}
                onClick={() => onFilterChange(key)}
              >
                {label}
                {n > 0 ? ` (${n})` : ""}
              </button>
            );
          })}
        </div>

        <div className="panel-scroll" style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          {goals.length === 0 && (
            <p className="empty-hint">
              {filter === "all"
                ? "还没有目标。说出你想推进的事，OpenX 会帮你整理。"
                : "这里暂时没有目标。"}
            </p>
          )}
          {goals.map((g) => {
            const selected = editMode ? selectedIds.has(g.id) : selectedId === g.id;
            const showApprove = !editMode && g.status === "awaiting_review" && selected;
            const showReworkForm = reworkId === g.id;

            return (
              <div
                key={g.id}
                role="button"
                tabIndex={0}
                className={`goal-card${selected ? " selected" : ""}${g.status === "awaiting_review" ? " awaiting_review" : ""}${editMode ? " edit-mode" : ""}`}
                onClick={() => {
                  if (editMode) {
                    onToggleSelect(g.id);
                  } else {
                    onSelect(g.id);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  if (editMode) onToggleSelect(g.id);
                  else onSelect(g.id);
                }}
              >
                <div className="goal-card-head">
                  {editMode ? (
                    <label
                      className="goal-card-check"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(g.id)}
                        onChange={() => onToggleSelect(g.id)}
                      />
                    </label>
                  ) : (
                    <div className="progress-ring">{g.progress}%</div>
                  )}
                  <div className="goal-card-body">
                    <div className="goal-card-title-row">
                      <strong className="goal-card-title">{g.title}</strong>
                      <span className={`status-pill ${g.status}`}>
                        {userStatusLabel(g)}
                      </span>
                      {g.effectStatus === "rework" && (
                        <span className="status-pill rework-tag">再改一下</span>
                      )}
                      <span className="executor-tag">{executorLabel(g.executorId)}</span>
                    </div>
                    {!editMode && (
                      <div className="progress-bar">
                        <span style={{ width: `${g.progress}%` }} />
                      </div>
                    )}
                    {editMode && (
                      <p className="goal-card-meta">
                        进度 {g.progress}%
                        {g.parentGoalId ? " · 子目标" : ""}
                      </p>
                    )}
                    {g.acceptance && (
                      <p className="goal-card-acceptance">{g.acceptance}</p>
                    )}
                    {(g.parentGoalId || (g.dependsOn?.length ?? 0) > 0) && !editMode && (
                      <p className="goal-card-meta">
                        {g.parentGoalId ? "子目标" : ""}
                        {(g.dependsOn?.length ?? 0) > 0
                          ? `${g.parentGoalId ? " · " : ""}等待 ${g.dependsOn.length} 个前置`
                          : ""}
                      </p>
                    )}

                    {!editMode && (g.status === "draft" || g.status === "failed") &&
                      selected &&
                      !showReworkForm &&
                      approveId !== g.id && (
                        <div className="goal-actions">
                          <button
                            type="button"
                            className="btn primary"
                            onClick={(e) => {
                              e.stopPropagation();
                              void onStart(g.id);
                            }}
                          >
                            开始推进
                          </button>
                        </div>
                      )}

                    {!editMode && showApprove && approveId !== g.id && !showReworkForm && (
                      <div className="goal-actions">
                        <button
                          type="button"
                          className="btn primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            setApproveId(g.id);
                            setReworkId(null);
                          }}
                        >
                          确认完成
                        </button>
                        <button
                          type="button"
                          className="btn danger"
                          onClick={(e) => {
                            e.stopPropagation();
                            setReworkId(g.id);
                            setApproveId(null);
                            setReworkReason("");
                          }}
                        >
                          还要修改
                        </button>
                      </div>
                    )}

                    {!editMode && showApprove && approveId === g.id && (
                      <div
                        className="goal-actions"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="approve-confirm">
                          你之前说“做好”的标准：{g.acceptance || "（未填写）"}
                        </div>
                        <button
                          type="button"
                          className="btn primary"
                          onClick={() => {
                            void onApprove(g.id).then(() => setApproveId(null));
                          }}
                        >
                          确认已经做好
                        </button>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => setApproveId(null)}
                        >
                          取消
                        </button>
                      </div>
                    )}

                    {!editMode && showReworkForm && (
                      <div
                        className="rework-box"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span style={{ fontSize: "0.72rem", color: "var(--copper)" }}>
                          想让它怎么改？（可选）
                        </span>
                        <input
                          value={reworkReason}
                          onChange={(e) => setReworkReason(e.target.value)}
                          placeholder="例如：内容不够完整，帮我补充测试和说明…"
                        />
                        <div className="goal-actions">
                          <button
                            type="button"
                            className="btn danger"
                            onClick={() => {
                              void onRework(g.id, reworkReason.trim() || undefined).then(
                                () => {
                                  setReworkId(null);
                                  setReworkReason("");
                                },
                              );
                            }}
                          >
                            让它继续改
                          </button>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => setReworkId(null)}
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {editMode ? (
          <div className="panel-footer tasks-batch-footer">
            <div className="tasks-batch-meta">
              <span className="tasks-batch-count">已选 {selectedIds.size} 项</span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={goals.length === 0}
                onClick={() => (allVisibleSelected ? onClearSelection() : onSelectAllVisible())}
              >
                {allVisibleSelected ? "取消全选" : `全选当前列表 (${goals.length})`}
              </button>
            </div>
            <div className="tasks-batch-actions">
              <button
                type="button"
                className="btn primary"
                disabled={startN === 0 || batchBusy}
                onClick={() => void runBatch("start")}
              >
                开始推进{startN > 0 ? ` (${startN})` : ""}
              </button>
              <button
                type="button"
                className="btn"
                disabled={cancelN === 0 || batchBusy}
                onClick={() => void runBatch("cancel")}
              >
                取消{cancelN > 0 ? ` (${cancelN})` : ""}
              </button>
              <button
                type="button"
                className="btn"
                disabled={approveN === 0 || batchBusy}
                onClick={() => void runBatch("approve")}
              >
                确认完成{approveN > 0 ? ` (${approveN})` : ""}
              </button>
              <button
                type="button"
                className="btn danger"
                disabled={deleteN === 0 || batchBusy}
                onClick={() => void runBatch("delete")}
              >
                删除{deleteN > 0 ? ` (${deleteN})` : ""}
              </button>
            </div>
          </div>
        ) : (
          <div className="panel-footer">
            <button type="button" className="btn primary" style={{ width: "100%" }} onClick={onNewGoal}>
              ＋ 新目标
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
