import { useMemo } from "react";
import type { CoachMessageRecord, Goal, GoalRunState } from "@openx/shared";
import { goalMatchesDisplayFilter } from "@openx/shared";
import type { CoachReplyEvent, CoachStreamState } from "../lib/app-state";
import { useDesktopLayout } from "../lib/use-desktop-layout";
import type { ExecutorInfo } from "../api";
import type { BatchGoalsAction, GoalAccessActor } from "@openx/shared";
import { ChatPanel } from "./ChatPanel";
import { GoalsWorkspace } from "./GoalsWorkspace";
import { PreviewRail } from "./PreviewRail";
import { SmartCabinDesktop } from "./smart-cabin/SmartCabinDesktop";
import { FlexibleCanvas } from "./smart-cabin/FlexibleCanvas";
import { ForemanDock } from "./smart-cabin/ForemanDock";
import { TaskIndexCard } from "./smart-cabin/TaskIndexCard";
import { AwaitingReviewCompanion } from "./smart-cabin/ConsoleCompanionPanels";
import type { CanvasWidgetId } from "../lib/flexible-desktop";

type GoalActions = {
  onApprove: (id: string) => Promise<void>;
  onRework: (id: string, reason?: string) => Promise<void>;
  onStart: (id: string) => Promise<void>;
};

type Props = {
  conversationId: string;
  conversationTitle?: string;
  goals: Goal[];
  selectedGoal: Goal | undefined;
  selectedId: string | null;
  runs: Record<string, GoalRunState>;
  statusFilter: string;
  onFilterChange: (filter: string) => void;
  onSelect: (id: string) => void;
  onOpenDetail: (id: string) => void;
  onNewGoal: () => void;
  editMode: boolean;
  onEditModeChange: (edit: boolean) => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onSelectAllVisible: () => void;
  onClearSelection: () => void;
  onBatchAction: (action: BatchGoalsAction, ids: string[]) => Promise<void>;
  locateRequest?: { goalId: string; tick: number } | null;
  goalAccess: GoalAccessActor;
  goalActions: GoalActions;
  autoExecute: boolean;
  executors: ExecutorInfo[];
  defaultExecutorId?: string;
  onRefreshed: () => void;
  onLocateGoal: (goalId: string) => void;
  coachReplyEvent: CoachReplyEvent | null;
  coachStream: CoachStreamState | null;
  coachMessageEvent: CoachMessageRecord | null;
};

export function ConversationWorkspace(props: Props) {
  const {
    conversationId,
    conversationTitle,
    goals,
    selectedGoal,
    selectedId,
    runs,
    statusFilter,
    onFilterChange,
    onSelect,
    onOpenDetail,
    onNewGoal,
    editMode,
    onEditModeChange,
    selectedIds,
    onToggleSelect,
    onSelectAllVisible,
    onClearSelection,
    onBatchAction,
    locateRequest,
    goalAccess,
    goalActions,
    autoExecute,
    executors,
    defaultExecutorId,
    onRefreshed,
    onLocateGoal,
    coachReplyEvent,
    coachStream,
    coachMessageEvent,
  } = props;

  const { dockMode, setDockMode } = useDesktopLayout("planning", "conversation");

  const filteredGoals = useMemo(
    () => goals.filter((g) => goalMatchesDisplayFilter(g, statusFilter)),
    [goals, statusFilter],
  );

  const awaitingReviewGoals = useMemo(
    () => goals.filter((g) => g.status === "awaiting_review"),
    [goals],
  );

  const selectedRun = selectedGoal ? runs[selectedGoal.id] : undefined;

  const artifactsEnabled = Boolean(
    selectedGoal &&
      (selectedGoal.status === "running" ||
        selectedGoal.status === "awaiting_review" ||
        selectedGoal.status === "done" ||
        selectedRun?.active ||
        (selectedRun?.events.length ?? 0) > 0),
  );

  const flexWidgets = useMemo((): Partial<Record<CanvasWidgetId, React.ReactNode>> => {
    const chatPanelProps = {
      conversationId,
      goals,
      selectedGoal,
      runs,
      autoExecute,
      executors,
      defaultExecutorId,
      onRefreshed,
      onOpenGoalDetail: onOpenDetail,
      onLocateGoal,
      onStartGoal: goalActions.onStart,
      onApproveGoal: goalActions.onApprove,
      onReworkGoal: goalActions.onRework,
      coachReplyEvent,
      coachStream,
      coachMessageEvent,
    };

    return {
      chat: (
        <div className="flexible-widget-fill workspace-pane workspace-pane-assistant">
          <ChatPanel {...chatPanelProps} />
        </div>
      ),
      tasks: (
        <div className="flexible-widget-fill console-task-stage">
          <GoalsWorkspace
            goals={filteredGoals}
            allGoals={goals}
            filter={statusFilter}
            onFilterChange={onFilterChange}
            selectedId={selectedId}
            onSelect={onSelect}
            onOpenDetail={onOpenDetail}
            onNewGoal={onNewGoal}
            hideFooterNewGoal
            editMode={editMode}
            onEditModeChange={onEditModeChange}
            selectedIds={selectedIds}
            onToggleSelect={onToggleSelect}
            onSelectAllVisible={onSelectAllVisible}
            onClearSelection={onClearSelection}
            onBatchAction={onBatchAction}
            locateRequest={locateRequest}
            goalAccess={goalAccess}
            goalActions={goalActions}
            defaultViewMode="list"
          />
        </div>
      ),
      artifacts: (
        <div className="flexible-widget-fill workspace-pane workspace-pane-preview">
          <PreviewRail
            goal={selectedGoal}
            run={selectedRun}
            goals={goals}
            onSelectGoal={onSelect}
          />
        </div>
      ),
      review: (
        <div className="flexible-widget-fill">
          <AwaitingReviewCompanion goals={awaitingReviewGoals} onSelect={onSelect} />
        </div>
      ),
    };
  }, [
    autoExecute,
    awaitingReviewGoals,
    coachMessageEvent,
    coachReplyEvent,
    coachStream,
    conversationId,
    defaultExecutorId,
    editMode,
    executors,
    filteredGoals,
    goalAccess,
    goalActions,
    goals,
    locateRequest,
    onBatchAction,
    onClearSelection,
    onEditModeChange,
    onFilterChange,
    onLocateGoal,
    onNewGoal,
    onOpenDetail,
    onRefreshed,
    onSelect,
    onSelectAllVisible,
    onToggleSelect,
    selectedGoal,
    selectedId,
    selectedIds,
    selectedRun,
    statusFilter,
  ]);

  return (
    <SmartCabinDesktop
      className="main-view cursor-workspace conversation-smart-cabin"
      strip={
        <header className="smart-strip conversation-strip">
          <div className="smart-strip-main">
            <div className="smart-strip-titles">
              <h2 className="smart-strip-title">项目对话</h2>
              {conversationTitle ? (
                <span className="smart-strip-subtitle">{conversationTitle}</span>
              ) : null}
            </div>
          </div>
          <div className="smart-strip-stats">
            <span className="smart-strip-stat">
              本对话任务 <strong>{goals.length}</strong>
            </span>
            <span className="smart-strip-stat">
              待验收 <strong>{awaitingReviewGoals.length}</strong>
            </span>
          </div>
        </header>
      }
      left={
        <TaskIndexCard
          goals={goals}
          filter={statusFilter}
          onFilterChange={onFilterChange}
          selectedId={selectedId}
          onSelect={onSelect}
          totalCount={goals.length}
        />
      }
      canvas={
        <FlexibleCanvas
          scope="conversation"
          dockMode={dockMode}
          widgets={flexWidgets}
        />
      }
      dock={
        <ForemanDock
          dockMode={dockMode}
          onDockModeChange={setDockMode}
          selectedGoal={selectedGoal}
          taskCount={goals.length}
          awaitingReviewCount={awaitingReviewGoals.length}
          artifactsEnabled={artifactsEnabled}
          visibleModes={["chat", "tasks", "artifacts"]}
          approveEnabled={selectedGoal?.status === "awaiting_review"}
          startEnabled={selectedGoal != null && selectedGoal.status === "draft"}
          onApprove={
            selectedGoal ? () => void goalActions.onApprove(selectedGoal.id) : undefined
          }
          onRework={
            selectedGoal ? () => void goalActions.onRework(selectedGoal.id) : undefined
          }
          onStart={
            selectedGoal ? () => void goalActions.onStart(selectedGoal.id) : undefined
          }
        />
      }
    />
  );
}
