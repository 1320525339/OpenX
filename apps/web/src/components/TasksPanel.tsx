import { useEffect, useMemo, useRef, useState } from "react";
import { useHorizontalPanScroll } from "../lib/use-horizontal-pan-scroll";
import type { BatchGoalsAction, Goal } from "@openx/shared";
import {
  canMutateGoal,
  goalMatchesDisplayFilter,
  type GoalAccessActor,
} from "@openx/shared";
import { goalsEligibleForAction } from "../lib/goal-batch";
import { buildGoalTreeList } from "../lib/goal-list";
import {
  countPinDeskFilter,
  matchesPinDeskSearch,
  PIN_DESK_FILTERS,
  sortPinDeskGoals,
  type PinDeskSort,
} from "../lib/task-desk-pin";
import { GoalTaskCard } from "./GoalTaskCard";
import type { GoalTaskActionHandlers } from "./GoalTaskActions";
import { VirtualList, type VirtualListHandle } from "./VirtualList";
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
  filterCounts?: {
    all: number;
    incomplete: number;
    failed: number;
    done: number;
    rework: number;
  };
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  loadError?: string | null;
  onRetryLoad?: () => void;
  /** Pin 桌面：调度台紧凑任务台样式 */
  embedInPin?: boolean;
  logs?: { goalId: string; level: string; message: string; timestamp: string }[];
};

function countForFilter(
  goals: Goal[],
  key: string,
  counts?: Props["filterCounts"],
): number {
  if (counts) {
    if (key === "all") return counts.all;
    if (key === "incomplete") return counts.incomplete;
    if (key === "failed") return counts.failed;
    if (key === "done") return counts.done;
    if (key === "rework") return counts.rework;
  }
  return goals.filter((g) => goalMatchesDisplayFilter(g, key)).length;
}

function buildActionHandlers(
  g: Goal,
  editable: boolean,
  onStart: (id: string) => Promise<void>,
  onApprove: (id: string) => Promise<void>,
  onRework: (id: string) => Promise<void>,
  onOpenDetail?: (id: string) => void,
): GoalTaskActionHandlers {
  if (editable) {
    return {
      onStart,
      onApprove,
      onRework,
      onOpenDetail: onOpenDetail ? () => onOpenDetail(g.id) : undefined,
    };
  }
  return {
    onOpenDetail: onOpenDetail ? () => onOpenDetail(g.id) : undefined,
  };
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
  filterCounts,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  loadError = null,
  onRetryLoad,
  embedInPin = false,
  logs = [],
}: Props) {
  const [batchBusy, setBatchBusy] = useState(false);
  const [expandedGoalId, setExpandedGoalId] = useState<string | null>(null);
  const [pinSearch, setPinSearch] = useState("");
  const [pinSort, setPinSort] = useState<PinDeskSort>("default");
  const listRef = useRef<HTMLDivElement | null>(null);
  const virtualListRef = useRef<VirtualListHandle>(null);
  const { ref: filterTabsRef, panning: filterTabsPanning } =
    useHorizontalPanScroll<HTMLDivElement>();

  const canEditGoal = (goal: Goal) => canMutateGoal(goalAccess, goal);

  const displayGoals = useMemo(() => {
    let list = goals;
    if (embedInPin && pinSearch.trim()) {
      list = list.filter((g) => matchesPinDeskSearch(g, pinSearch));
    }
    if (embedInPin) {
      list = sortPinDeskGoals(list, pinSort);
    }
    return list;
  }, [embedInPin, goals, pinSearch, pinSort]);

  const treeGoals = buildGoalTreeList(displayGoals, {
    contextGoals: allGoals,
    preserveOrder: Boolean(onLoadMore) || embedInPin,
  });
  const useVirtualList = treeGoals.length > 12 && !expandedGoalId && !editMode && !embedInPin;

  const renderGoalEntry = ({ goal: g, depth }: (typeof treeGoals)[number]) => {
    const editable = canEditGoal(g);
    const selected = editMode ? selectedIds.has(g.id) : selectedId === g.id;
    const expanded = !editMode && !embedInPin && expandedGoalId === g.id;
    const handlers = buildActionHandlers(g, editable, onStart, onApprove, onRework, onOpenDetail);
    const handleCardClick = () => {
      if (editMode) {
        if (!editable) return;
        onToggleSelect(g.id);
        return;
      }
      onSelect(g.id);
      if (!embedInPin) {
        setExpandedGoalId((prev) => (prev === g.id ? null : g.id));
      }
    };

    const latestLog = embedInPin
      ? logs.filter((l) => l.goalId === g.id).slice(-1)[0]
      : undefined;

    return (
      <GoalTaskCard
        goal={g}
        depth={depth}
        allGoals={allGoals}
        selected={selected}
        expanded={expanded}
        editMode={editMode}
        editable={editable}
        selectedIds={selectedIds}
        onToggleSelect={onToggleSelect}
        handlers={handlers}
        onCardClick={handleCardClick}
        showConnectClaimStatus={showConnectClaimStatus}
        conversationTitles={conversationTitles}
        projectTitles={projectTitles}
        conversationProjectIds={conversationProjectIds}
        pinVariant={embedInPin}
        latestLogMessage={latestLog?.message}
      />
    );
  };

  useEffect(() => {
    if (!locateRequest) return;

    if (useVirtualList) {
      const idx = treeGoals.findIndex((t) => t.goal.id === locateRequest.goalId);
      if (idx >= 0) {
        virtualListRef.current?.scrollToIndex(idx, { align: "center" });
        requestAnimationFrame(() => {
          const el = virtualListRef.current
            ?.getScrollElement()
            ?.querySelector<HTMLElement>(`[data-goal-id="${locateRequest.goalId}"]`);
          if (!el) return;
          el.classList.add("locate-flash");
          setTimeout(() => el.classList.remove("locate-flash"), 1800);
        });
      }
      return;
    }

    setExpandedGoalId(locateRequest.goalId);

    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-goal-id="${locateRequest.goalId}"]`,
    );
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("locate-flash");
    const timer = setTimeout(() => el.classList.remove("locate-flash"), 1800);
    return () => clearTimeout(timer);
  }, [locateRequest, treeGoals, useVirtualList]);

  const selectedGoals = allGoals.filter(
    (g) => selectedIds.has(g.id) && canEditGoal(g),
  );
  const startN = goalsEligibleForAction(selectedGoals, "start").length;
  const cancelN = goalsEligibleForAction(selectedGoals, "cancel").length;
  const approveN = goalsEligibleForAction(selectedGoals, "approve").length;
  const deleteN = selectedIds.size;
  const allVisibleSelected =
    displayGoals.length > 0 &&
    displayGoals.filter(canEditGoal).every((g) => selectedIds.has(g.id));

  const activeFilters = embedInPin ? PIN_DESK_FILTERS : FILTERS;

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

  return (
    <section
      className={`mech-panel tasks-panel${editMode ? " tasks-panel-editing" : ""}${embedInPin ? " tasks-panel-pin" : ""}`}
    >
      <div className="mech-panel-body panel-stack">
        {embedInPin ? (
          <div className="tasks-desk-head">
            <div
              ref={filterTabsRef}
              className={`filter-row filter-tabs tasks-desk-tabs${filterTabsPanning ? " is-panning" : ""}`}
              role="tablist"
              aria-label="任务台筛选"
            >
              {activeFilters.map(({ key, label }) => {
                const n = countPinDeskFilter(allGoals, key);
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
                    {n > 0 ? ` (${n})` : ""}
                  </button>
                );
              })}
            </div>
            <div className="tasks-desk-tools">
              <select
                className="tasks-desk-sort"
                value={pinSort}
                onChange={(e) => setPinSort(e.target.value as PinDeskSort)}
                aria-label="排序"
              >
                <option value="default">默认排序</option>
                <option value="updated">最近更新</option>
                <option value="orderNo">工单号</option>
              </select>
              <input
                type="search"
                className="tasks-desk-search"
                placeholder="搜索任务标题或 WO 编号"
                value={pinSearch}
                onChange={(e) => setPinSearch(e.target.value)}
                aria-label="搜索任务"
              />
            </div>
          </div>
        ) : null}

        <div className={`tasks-toolbar${embedInPin ? " tasks-toolbar-pin-edit" : ""}`}>
          {!embedInPin ? (
          <div
            ref={filterTabsRef}
            className={`filter-row filter-tabs${filterTabsPanning ? " is-panning" : ""}`}
            role="tablist"
            aria-label="目标筛选"
          >
            {activeFilters.map(({ key, label }) => {
              const n = countForFilter(allGoals, key, filterCounts);
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
          ) : null}
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

        <div
          ref={listRef}
          className={`panel-scroll${useVirtualList ? " tasks-virtual-scroll" : ""}`}
          style={
            useVirtualList
              ? undefined
              : { display: "flex", flexDirection: "column", gap: "0.4rem" }
          }
        >
          {goals.length === 0 && !loadError && (
            <p className="empty-hint">
              {filter === "all" || embedInPin
                ? embedInPin
                  ? "当前筛选下暂无任务。"
                  : "还没有目标。说出你想推进的事，OpenX 会帮你整理。"
                : "这里暂时没有目标。"}
            </p>
          )}
          {displayGoals.length === 0 && goals.length > 0 && embedInPin && !loadError ? (
            <p className="empty-hint">没有匹配搜索条件的任务。</p>
          ) : null}
          {loadError ? (
            <p className="empty-hint tasks-load-error">
              加载失败：{loadError}
              {onRetryLoad ? (
                <>
                  {" "}
                  <button type="button" className="btn btn-ghost btn-sm" onClick={onRetryLoad}>
                    重试
                  </button>
                </>
              ) : null}
            </p>
          ) : null}
          {useVirtualList ? (
            <VirtualList
              ref={virtualListRef}
              items={treeGoals}
              estimateSize={120}
              className="tasks-virtual-list"
              onReachEnd={hasMore ? onLoadMore : undefined}
              getItemKey={(entry) => entry.goal.id}
              renderItem={(entry) => (
                <div style={{ paddingBottom: "0.4rem" }}>{renderGoalEntry(entry)}</div>
              )}
            />
          ) : (
          treeGoals.map((entry) => (
            <div key={entry.goal.id}>{renderGoalEntry(entry)}</div>
          ))
          )}
          {loadingMore ? <p className="empty-hint">加载更多目标…</p> : null}
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
