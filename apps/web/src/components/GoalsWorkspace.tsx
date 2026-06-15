import { useMemo, useState } from "react";
import type { Goal } from "@openx/shared";
import { goalMatchesDisplayFilter } from "@openx/shared";
import { GoalKanban } from "./GoalKanban";
import { TasksPanel } from "./TasksPanel";
import type { BatchGoalsAction } from "@openx/shared";
import type { GoalAccessActor } from "@openx/shared";

const VIEW_MODE_KEY = "openx.goalsViewMode";

function loadViewMode(defaultMode: "list" | "kanban"): "list" | "kanban" {
  try {
    const raw = localStorage.getItem(VIEW_MODE_KEY);
    if (raw === "kanban" || raw === "list") return raw;
  } catch {
    /* ignore */
  }
  return defaultMode;
}

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
  onSelectAllVisible: () => void;
  onClearSelection: () => void;
  onBatchAction: (action: BatchGoalsAction, ids: string[]) => Promise<void>;
  locateRequest?: { goalId: string; tick: number } | null;
  showConnectClaimStatus?: boolean;
  conversationTitles?: Record<string, string>;
  projectTitles?: Record<string, string>;
  conversationProjectIds?: Record<string, string>;
  goalAccess?: GoalAccessActor;
  goalActions: GoalActions;
  defaultViewMode?: "list" | "kanban";
  /** 嵌入 Smart Cabin 中卡：固定看板，隐藏列表/看板切换 */
  embedKanbanOnly?: boolean;
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
  defaultViewMode = "list",
  embedKanbanOnly = false,
}: Props) {
  const [viewMode, setViewMode] = useState<"list" | "kanban">(() =>
    embedKanbanOnly ? "kanban" : loadViewMode(defaultViewMode),
  );

  const filteredGoals = useMemo(
    () => goals.filter((g) => goalMatchesDisplayFilter(g, filter)),
    [goals, filter],
  );

  const setViewModePersisted = (mode: "list" | "kanban") => {
    setViewMode(mode);
    try {
      localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className={`goals-workspace${embedKanbanOnly ? " goals-workspace-embedded" : ""}`}>
      {!embedKanbanOnly ? (
        <div className="goals-workspace-toolbar">
          <div className="goals-view-toggle" role="tablist" aria-label="任务视图">
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "list"}
              className={viewMode === "list" ? "active" : ""}
              onClick={() => setViewModePersisted("list")}
            >
              列表
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "kanban"}
              className={viewMode === "kanban" ? "active" : ""}
              onClick={() => setViewModePersisted("kanban")}
            >
              看板
            </button>
          </div>
        </div>
      ) : null}

      {viewMode === "kanban" ? (
        <div className="goals-workspace-kanban panel-scroll">
          <GoalKanban
            goals={filteredGoals}
            selectedId={selectedId}
            onSelect={onSelect}
            onOpenDetail={onOpenDetail}
            conversationTitles={conversationTitles}
          />
        </div>
      ) : (
        <TasksPanel
          goals={filteredGoals}
          allGoals={allGoals}
          filter={filter}
          onFilterChange={onFilterChange}
          selectedId={selectedId}
          onSelect={onSelect}
          onOpenDetail={onOpenDetail}
          onNewGoal={onNewGoal}
          hideFooterNewGoal={hideFooterNewGoal}
          editMode={editMode}
          onEditModeChange={onEditModeChange}
          selectedIds={selectedIds}
          onToggleSelect={onToggleSelect}
          onSelectAllVisible={onSelectAllVisible}
          onClearSelection={onClearSelection}
          onBatchAction={onBatchAction}
          locateRequest={locateRequest}
          showConnectClaimStatus={showConnectClaimStatus}
          conversationTitles={conversationTitles}
          projectTitles={projectTitles}
          conversationProjectIds={conversationProjectIds}
          goalAccess={goalAccess}
          {...goalActions}
        />
      )}
    </div>
  );
}
