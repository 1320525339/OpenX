import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Goal, BatchGoalsAction, GoalAccessActor } from "@openx/shared";
import { goalMatchesDisplayFilter } from "@openx/shared";
import { TasksPanel } from "./TasksPanel";
import { usePaginatedGoals } from "../lib/use-paginated-goals";

type GoalActions = {
  onApprove: (id: string) => Promise<void>;
  onRework: (id: string, reason?: string) => Promise<void>;
  onStart: (id: string) => Promise<void>;
};

type Props = {
  goals: Goal[];
  allGoals: Goal[];
  filter: string;
  onFilterChange: (filter: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenDetail?: (id: string) => void;
  onNewGoal: () => void;
  hideFooterNewGoal?: boolean;
  editMode: boolean;
  onEditModeChange: (edit: boolean) => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  /** 可选传入当前可见目标 id；分页列表由工作区自行解析 */
  onSelectAllVisible: (visibleIds?: string[]) => void;
  onClearSelection: () => void;
  onBatchAction: (action: BatchGoalsAction, ids: string[]) => Promise<void>;
  locateRequest?: { goalId: string; tick: number } | null;
  showConnectClaimStatus?: boolean;
  conversationTitles?: Record<string, string>;
  projectTitles?: Record<string, string>;
  conversationProjectIds?: Record<string, string>;
  goalAccess?: GoalAccessActor;
  goalActions: GoalActions;
  /** 启用服务端分页 */
  paginationScope?: { conversationId?: string; projectId?: string };
  /** Pin 桌面嵌入：紧凑任务台样式 */
  embedInPin?: boolean;
  logs?: { goalId: string; level: string; message: string; timestamp: string }[];
};

export function GoalsWorkspace({
  goals,
  allGoals,
  filter,
  onFilterChange,
  selectedId,
  onSelect,
  onOpenDetail,
  onNewGoal,
  hideFooterNewGoal,
  editMode,
  onEditModeChange,
  selectedIds,
  onToggleSelect,
  onSelectAllVisible,
  onClearSelection,
  onBatchAction,
  locateRequest,
  showConnectClaimStatus,
  conversationTitles,
  projectTitles,
  conversationProjectIds,
  goalAccess,
  goalActions,
  paginationScope,
  embedInPin = false,
  logs,
}: Props) {
  const paginationEnabled = Boolean(paginationScope);
  const paginated = usePaginatedGoals(paginationScope ?? {}, filter, paginationEnabled);

  const clientFilteredGoals = useMemo(
    () => goals.filter((g) => goalMatchesDisplayFilter(g, filter)),
    [goals, filter],
  );

  const listGoals = paginationEnabled ? paginated.goals : clientFilteredGoals;
  const knownAllGoalIdsRef = useRef<Set<string>>(new Set());
  const paginationScopeKey = `${paginationScope?.projectId ?? ""}:${paginationScope?.conversationId ?? ""}:${filter}`;

  useEffect(() => {
    if (!paginationEnabled) return;
    knownAllGoalIdsRef.current = new Set();
  }, [paginationScopeKey, paginationEnabled]);

  useEffect(() => {
    if (!paginationEnabled) return;

    const allById = new Map(allGoals.map((g) => [g.id, g]));
    const prevKnown = knownAllGoalIdsRef.current;
    let addedNew = false;

    if (prevKnown.size > 0) {
      for (const g of allGoals) {
        if (prevKnown.has(g.id)) continue;
        if (!goalMatchesDisplayFilter(g, filter)) continue;
        paginated.mergeGoal(g);
        addedNew = true;
      }
    }

    knownAllGoalIdsRef.current = new Set(allGoals.map((g) => g.id));

    if (addedNew) {
      void paginated.refreshCounts();
    }

    for (const pg of paginated.goals) {
      const latest = allById.get(pg.id);
      if (!latest) {
        paginated.removeGoal(pg.id);
        continue;
      }
      if (!goalMatchesDisplayFilter(latest, filter)) {
        paginated.removeGoal(pg.id);
        continue;
      }
      paginated.mergeGoal(latest);
    }
  }, [
    allGoals,
    filter,
    paginationEnabled,
    paginated.goals,
    paginated.mergeGoal,
    paginated.removeGoal,
    paginated.refreshCounts,
  ]);

  const handleSelectAllVisible = useCallback(() => {
    if (paginationEnabled) {
      onSelectAllVisible(paginated.goals.map((g) => g.id));
      return;
    }
    onSelectAllVisible();
  }, [onSelectAllVisible, paginated.goals, paginationEnabled]);

  const handleBatchAction = useCallback(
    async (action: BatchGoalsAction, ids: string[]) => {
      await onBatchAction(action, ids);
      if (paginationEnabled) paginated.reload();
    },
    [onBatchAction, paginated, paginationEnabled],
  );

  return (
    <div className={`goals-workspace${embedInPin ? " goals-workspace-embedded goals-workspace-pin" : ""}`}>
      <TasksPanel
        goals={listGoals}
        allGoals={allGoals}
        filter={filter}
        onFilterChange={onFilterChange}
        filterCounts={paginationEnabled ? paginated.counts : undefined}
        hasMore={paginationEnabled ? paginated.hasMore : false}
        loadingMore={paginationEnabled ? paginated.loading : false}
        onLoadMore={paginationEnabled ? paginated.loadMore : undefined}
        loadError={paginationEnabled ? paginated.error : null}
        onRetryLoad={paginationEnabled ? paginated.reload : undefined}
        selectedId={selectedId}
        onSelect={onSelect}
        onOpenDetail={onOpenDetail}
        onNewGoal={onNewGoal}
        hideFooterNewGoal={hideFooterNewGoal}
        editMode={editMode}
        onEditModeChange={onEditModeChange}
        selectedIds={selectedIds}
        onToggleSelect={onToggleSelect}
        onSelectAllVisible={handleSelectAllVisible}
        onClearSelection={onClearSelection}
        onBatchAction={handleBatchAction}
        locateRequest={locateRequest}
        showConnectClaimStatus={showConnectClaimStatus}
        conversationTitles={conversationTitles}
        projectTitles={projectTitles}
        conversationProjectIds={conversationProjectIds}
        goalAccess={goalAccess}
        embedInPin={embedInPin}
        logs={logs}
        {...goalActions}
      />
    </div>
  );
}
