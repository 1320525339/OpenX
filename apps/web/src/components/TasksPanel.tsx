import { useEffect, useRef, useState } from "react";
import { useHorizontalPanScroll } from "../lib/use-horizontal-pan-scroll";
import type { BatchGoalsAction, Goal } from "@openx/shared";
import {
  canMutateGoal,
  goalDisplayHint,
  goalDisplayLabel,
  goalDisplayOutcome,
  goalMatchesDisplayFilter,
  type GoalAccessActor,
} from "@openx/shared";
import { EXECUTOR_AUTO, CONNECT_ANY_EXECUTOR_ID } from "@openx/shared";
import { connectClaimStatus, executorDisplayLabel } from "../lib/executors";
import { goalsEligibleForAction } from "../lib/goal-batch";
import { buildGoalContext, formatDispatchSummary, truncate } from "../lib/goal-detail";
import { buildGoalTreeList } from "../lib/goal-list";
import { GoalTaskExpandBody, goalResultTeaser } from "./GoalTaskExpandBody";
import { GoalTaskActions, goalHasTaskActions } from "./GoalTaskActions";
import { WorkOrderIdBadge } from "./WorkOrderIdBadge";

const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "incomplete", label: "未完成" },
  { key: "failed", label: "失败" },
  { key: "done", label: "已完成" },
  { key: "rework", label: "返工中" },
];

type Props = {
  goals: Goal[];
  allGoals: Goal[];
  filter: string;
  onFilterChange: (f: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenDetail?: (id: string) => void;
  onNewGoal: () => void;
  hideFooterNewGoal?: boolean;
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
  /** 对话区任务芯片点击定位：滚动到对应任务并高亮 */
  locateRequest?: { goalId: string; tick: number } | null;
  showConnectClaimStatus?: boolean;
  /** 项目看板：按对话标注任务来源 */
  conversationTitles?: Record<string, string>;
  /** 项目看板：按项目标注（调度台） */
  projectTitles?: Record<string, string>;
  /** 对话 → 项目 id（配合 projectTitles 展示所属项目） */
  conversationProjectIds?: Record<string, string>;
  /** 当前操作者权限（调度台可改全部；对话内仅本对话可改） */
  goalAccess?: GoalAccessActor;
};

function countForFilter(goals: Goal[], key: string): number {
  return goals.filter((g) => goalMatchesDisplayFilter(g, key)).length;
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
  onOpenDetail,
  onNewGoal,
  hideFooterNewGoal = false,
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
  locateRequest,
  showConnectClaimStatus = false,
  conversationTitles,
  projectTitles,
  conversationProjectIds,
  goalAccess = { type: "console" },
}: Props) {
  const [batchBusy, setBatchBusy] = useState(false);
  const [expandedGoalId, setExpandedGoalId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const { ref: filterTabsRef, panning: filterTabsPanning } =
    useHorizontalPanScroll<HTMLDivElement>();

  const canEditGoal = (goal: Goal) => canMutateGoal(goalAccess, goal);

  useEffect(() => {
    if (!locateRequest) return;
    setExpandedGoalId(locateRequest.goalId);
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-goal-id="${locateRequest.goalId}"]`,
    );
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("locate-flash");
    const timer = setTimeout(() => el.classList.remove("locate-flash"), 1800);
    return () => clearTimeout(timer);
  }, [locateRequest]);

  const selectedGoals = allGoals.filter(
    (g) => selectedIds.has(g.id) && canEditGoal(g),
  );
  const startN = goalsEligibleForAction(selectedGoals, "start").length;
  const cancelN = goalsEligibleForAction(selectedGoals, "cancel").length;
  const approveN = goalsEligibleForAction(selectedGoals, "approve").length;
  const deleteN = selectedIds.size;
  const allVisibleSelected =
    goals.length > 0 &&
    goals.filter(canEditGoal).every((g) => selectedIds.has(g.id));

  const runBatch = async (action: BatchGoalsAction) => {
    if (selectedIds.size === 0 || batchBusy) return;
    const ids = [...selectedIds];

    if (action === "delete") {
      const ok = window.confirm(
        `确定彻底删除 ${ids.length} 个目标？\n将同时移除子目标，且不可恢复。`,
      );
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

  const treeGoals = buildGoalTreeList(goals);

  return (
    <section className={`mech-panel tasks-panel${editMode ? " tasks-panel-editing" : ""}`}>
      <div className="mech-panel-body panel-stack">
        <div className="tasks-toolbar">
          <div
            ref={filterTabsRef}
            className={`filter-row filter-tabs${filterTabsPanning ? " is-panning" : ""}`}
            role="tablist"
            aria-label="目标筛选"
          >
            {FILTERS.map(({ key, label }) => {
              const n = countForFilter(allGoals, key);
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={filter === key}
                  className={`filter-chip${filter === key ? " active" : ""}`}
                  onClick={() => onFilterChange(key)}
                >
                  {label}
                  {n > 0 ? ` ${n}` : ""}
                </button>
              );
            })}
          </div>
          {editMode ? (
            <button type="button" className="btn-text tasks-edit-toggle" onClick={exitEditMode}>
              完成
            </button>
          ) : (
            <button
              type="button"
              className="btn-text tasks-edit-toggle"
              onClick={() => onEditModeChange(true)}
            >
              编辑
            </button>
          )}
        </div>

        <div ref={listRef} className="panel-scroll" style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          {goals.length === 0 && (
            <p className="empty-hint">
              {filter === "all"
                ? "还没有目标。说出你想推进的事，OpenX 会帮你整理。"
                : "这里暂时没有目标。"}
            </p>
          )}
          {treeGoals.map(({ goal: g, depth }) => {
            const selected = editMode ? selectedIds.has(g.id) : selectedId === g.id;
            const expanded = !editMode && expandedGoalId === g.id;
            const editable = canEditGoal(g);
            const { parent, dependencies } = buildGoalContext(allGoals, g);
            const resultTeaser = goalResultTeaser(g);
            const actionHandlers = editable
              ? {
                  onStart,
                  onApprove,
                  onRework,
                  onOpenDetail: onOpenDetail ? () => onOpenDetail(g.id) : undefined,
                }
              : {
                  onOpenDetail: onOpenDetail ? () => onOpenDetail(g.id) : undefined,
                };
            const showCollapsedActions =
              !editMode && !expanded && goalHasTaskActions(g, actionHandlers);

            const handleCardClick = () => {
              if (editMode) {
                if (!editable) return;
                onToggleSelect(g.id);
                return;
              }
              onSelect(g.id);
              setExpandedGoalId((prev) => (prev === g.id ? null : g.id));
            };

            return (
              <div
                key={g.id}
                data-goal-id={g.id}
                role="button"
                tabIndex={0}
                className={`goal-card${selected ? " selected" : ""}${expanded ? " expanded" : ""}${g.status === "awaiting_review" ? " awaiting_review" : ""}${editMode ? " edit-mode" : ""}${depth > 0 ? " goal-card-child" : ""}${!editable ? " goal-card-readonly" : ""}`}
                style={depth > 0 ? { marginLeft: `${depth * 0.75}rem` } : undefined}
                onClick={handleCardClick}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  handleCardClick();
                }}
              >
                {g.orderNo > 0 ? (
                  <div className="goal-card-order-banner">
                    <WorkOrderIdBadge orderNo={g.orderNo} />
                  </div>
                ) : null}
                <div className="goal-card-head">
                  {editMode ? (
                    <label
                      className="goal-card-check"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        disabled={!editable}
                        checked={selectedIds.has(g.id)}
                        onChange={() => onToggleSelect(g.id)}
                      />
                    </label>
                  ) : (
                    <div
                      className="progress-ring"
                      style={{ ["--goal-progress" as string]: `${g.progress}%` }}
                    >
                      {g.progress}%
                    </div>
                  )}
                  <div className="goal-card-body">
                    <div className="goal-card-title-row">
                      <strong className="goal-card-title">{g.title}</strong>
                      {conversationTitles?.[g.conversationId] ? (
                        <span className="goal-card-conv" title="所属对话">
                          {conversationTitles[g.conversationId]}
                        </span>
                      ) : null}
                      {conversationProjectIds &&
                      projectTitles?.[conversationProjectIds[g.conversationId]] ? (
                        <span className="goal-card-project" title="所属项目">
                          {projectTitles[conversationProjectIds[g.conversationId]]}
                        </span>
                      ) : null}
                      {!editable ? (
                        <span className="goal-card-readonly-tag">只读</span>
                      ) : null}
                      <span
                        className={`status-pill outcome-${goalDisplayOutcome(g)}${g.status === "awaiting_review" ? " awaiting_review" : ""}`}
                      >
                        {goalDisplayLabel(g)}
                      </span>
                      {goalDisplayHint(g) ? (
                        <span className="status-hint">{goalDisplayHint(g)}</span>
                      ) : null}
                      <span className="executor-tag">{executorLabel(g.executorId)}</span>
                      {!editMode && (
                        <span
                          className={`goal-card-chevron${expanded ? " open" : ""}`}
                          aria-hidden
                        />
                      )}
                      {showConnectClaimStatus ? (
                        (() => {
                          const claim = connectClaimStatus(g);
                          return claim ? (
                            <span
                              className={`status-pill ${g.executorId === CONNECT_ANY_EXECUTOR_ID ? "draft" : "running"}`}
                            >
                              {claim}
                            </span>
                          ) : null;
                        })()
                      ) : null}
                    </div>
                    {!editMode && !expanded && g.status === "running" && (
                      <div className="progress-bar">
                        <span style={{ width: `${g.progress}%` }} />
                      </div>
                    )}
                    {!editMode && !expanded && resultTeaser && (
                      <p className="goal-card-result-teaser">{truncate(resultTeaser, 140)}</p>
                    )}
                    {editMode && (
                      <p className="goal-card-meta">
                        进度 {g.progress}%
                        {g.parentGoalId ? " · 子目标" : ""}
                      </p>
                    )}
                    {!expanded && formatDispatchSummary(g) && (
                      <p className="goal-card-dispatch">{formatDispatchSummary(g)}</p>
                    )}
                    {(parent || dependencies.length > 0) && !editMode && !expanded && (
                      <p className="goal-card-meta">
                        {parent ? `子任务 · ${parent.title}` : "子任务"}
                        {dependencies.length > 0
                          ? ` · 等待 ${dependencies.map((d) => d.title).join("、")}`
                          : ""}
                      </p>
                    )}

                    {showCollapsedActions && (
                      <div
                        className="goal-task-actions-slot"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <GoalTaskActions
                          goal={g}
                          handlers={actionHandlers}
                          compact
                        />
                      </div>
                    )}

                    {!editMode && expanded && (
                      <div
                        className="goal-card-expand-wrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <GoalTaskExpandBody goal={g} handlers={actionHandlers} />
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
                onClick={() =>
                  allVisibleSelected
                    ? onClearSelection()
                    : onSelectAllVisible()
                }
              >
                {allVisibleSelected
                  ? "取消全选"
                  : `全选可编辑 (${goals.filter(canEditGoal).length})`}
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
        ) : hideFooterNewGoal ? null : (
          <div className="panel-footer tasks-panel-footer">
            <button type="button" className="btn-text tasks-new-goal" onClick={onNewGoal}>
              ＋ 新目标
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
