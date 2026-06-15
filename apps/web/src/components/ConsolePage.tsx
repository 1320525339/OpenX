import { useCallback, useEffect, useMemo, useState } from "react";
import type { BatchGoalsAction, CliProfile, CoachMessageRecord, Conversation, Goal, GoalRunState, Project } from "@openx/shared";
import { goalMatchesDisplayFilter } from "@openx/shared";
import { api, type ExecutorInfo } from "../api";
import type { CoachReplyEvent, CoachStreamState } from "../lib/app-state";
import { buildConsoleAgentRows, type ConsoleConnection } from "../lib/console-agents";
import { useDesktopLayout } from "../lib/use-desktop-layout";
import type { CanvasWidgetId } from "../lib/flexible-desktop";
import { ChatPanel } from "./ChatPanel";
import { GoalsWorkspace } from "./GoalsWorkspace";
import { PreviewRail } from "./PreviewRail";
import { SmartCabinDesktop } from "./smart-cabin/SmartCabinDesktop";
import { FlexibleCanvas } from "./smart-cabin/FlexibleCanvas";
import { SmartStrip } from "./smart-cabin/SmartStrip";
import { ForemanDock } from "./smart-cabin/ForemanDock";
import { TaskIndexCard } from "./smart-cabin/TaskIndexCard";
import { ConsoleFleetPanel } from "./smart-cabin/ConsoleFleetPanel";
import { AwaitingReviewCompanion } from "./smart-cabin/ConsoleCompanionPanels";

type ConsoleData = {
  project: Project;
  conversation: Conversation;
  connections: ConsoleConnection[];
  stats: {
    systemRunning: number;
    systemAwaitingReview: number;
    crossProjectAwaitingReview: number;
    crossProjectRunning: number;
  };
  crossProjectReviewGoals: Goal[];
  systemGoals: Goal[];
  allGoals: Goal[];
};

function mergeGoals(fromState: Goal[], fromApi: Goal[]): Goal[] {
  const map = new Map<string, Goal>();
  for (const goal of fromApi) map.set(goal.id, goal);
  for (const goal of fromState) map.set(goal.id, goal);
  return [...map.values()].sort((a, b) => {
    if (a.orderNo !== b.orderNo) return a.orderNo - b.orderNo;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

function filterPoolGoals(goals: Goal[], statusFilter: string): Goal[] {
  return goals.filter((g) => goalMatchesDisplayFilter(g, statusFilter));
}

type Props = {
  conversationId: string;
  goals: Goal[];
  statusFilter: string;
  onFilterChange: (filter: string) => void;
  selectedId: string | null;
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
  goalActions: {
    onApprove: (id: string) => Promise<void>;
    onRework: (id: string, reason?: string) => Promise<void>;
    onStart: (id: string) => Promise<void>;
    onCancel: (id: string) => Promise<void>;
  };
  locateRequest: { goalId: string; tick: number } | null;
  selectedGoal?: Goal;
  runs: Record<string, GoalRunState>;
  autoExecute: boolean;
  executors: ExecutorInfo[];
  cliProfiles: CliProfile[];
  defaultExecutorId?: string;
  onRefreshed: () => Promise<void>;
  onOpenGoalDetail: (id: string) => void;
  onLocateGoal: (id: string) => void;
  onNavigateToGoal: (goalId: string) => void;
  coachReplyEvent: CoachReplyEvent | null;
  coachStream: CoachStreamState | null;
  coachMessageEvent: CoachMessageRecord | null;
  conversationTitles?: Record<string, string>;
  projectTitles?: Record<string, string>;
  conversationProjectIds?: Record<string, string>;
};

export function ConsolePage(props: Props) {
  const {
    conversationId,
    goals,
    statusFilter,
    onFilterChange,
    selectedId,
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
    goalActions,
    locateRequest,
    selectedGoal,
    runs,
    autoExecute,
    executors,
    cliProfiles,
    defaultExecutorId,
    onRefreshed,
    onOpenGoalDetail,
    onLocateGoal,
    onNavigateToGoal,
    coachReplyEvent,
    coachStream,
    coachMessageEvent,
    conversationTitles,
    projectTitles,
    conversationProjectIds,
  } = props;

  const [consoleData, setConsoleData] = useState<ConsoleData | null>(null);
  const { scene, setScene, dockMode, setDockMode, sceneLabel } =
    useDesktopLayout("dispatch");

  const loadConsole = useCallback(async () => {
    try {
      const data = await api.getSystemConsole();
      setConsoleData(data);
    } catch {
      /* ignore transient errors */
    }
  }, []);

  useEffect(() => {
    void onRefreshed();
    void loadConsole();
    const timer = setInterval(() => void loadConsole(), 15_000);
    return () => clearInterval(timer);
  }, [loadConsole, onRefreshed]);

  useEffect(() => {
    void loadConsole();
  }, [loadConsole, goals.length]);

  const allConsoleGoals = useMemo(
    () => mergeGoals(goals, consoleData?.allGoals ?? []),
    [goals, consoleData?.allGoals],
  );

  const allConsoleFiltered = useMemo(
    () => filterPoolGoals(allConsoleGoals, statusFilter),
    [allConsoleGoals, statusFilter],
  );

  const connections = consoleData?.connections ?? [];
  const agentRows = useMemo(
    () => buildConsoleAgentRows(executors, cliProfiles, connections),
    [executors, cliProfiles, connections],
  );
  const executorOnlineCount = agentRows.filter((r) => r.statusTone === "ok").length;

  const consoleChatGoals = useMemo(
    () => goals.filter((g) => g.conversationId === conversationId),
    [goals, conversationId],
  );

  const awaitingReviewGoals = useMemo(
    () => allConsoleGoals.filter((g) => g.status === "awaiting_review"),
    [allConsoleGoals],
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
      goals: consoleChatGoals,
      selectedGoal,
      runs,
      autoExecute,
      executors,
      defaultExecutorId,
      onRefreshed,
      onOpenGoalDetail,
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
            goals={allConsoleFiltered}
            allGoals={allConsoleGoals}
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
            showConnectClaimStatus
            conversationTitles={conversationTitles}
            projectTitles={projectTitles}
            conversationProjectIds={conversationProjectIds}
            goalAccess={{ type: "console" }}
            goalActions={goalActions}
            defaultViewMode="kanban"
            embedKanbanOnly
          />
        </div>
      ),
      artifacts: (
        <div className="flexible-widget-fill workspace-pane workspace-pane-preview">
          <PreviewRail
            goal={selectedGoal}
            run={selectedRun}
            goals={consoleChatGoals}
            onSelectGoal={onSelect}
          />
        </div>
      ),
      review: (
        <div className="flexible-widget-fill">
          <AwaitingReviewCompanion goals={awaitingReviewGoals} onSelect={onSelect} />
        </div>
      ),
      fleet: (
        <div className="flexible-widget-fill">
          <ConsoleFleetPanel
            executors={executors}
            cliProfiles={cliProfiles}
            connections={connections}
            crossProjectReviewGoals={consoleData?.crossProjectReviewGoals ?? []}
            crossProjectAwaitingReview={
              consoleData?.stats.crossProjectAwaitingReview ?? 0
            }
            onNavigateToGoal={onNavigateToGoal}
          />
        </div>
      ),
    };
  }, [
    allConsoleFiltered,
    allConsoleGoals,
    autoExecute,
    awaitingReviewGoals,
    cliProfiles,
    coachMessageEvent,
    coachReplyEvent,
    coachStream,
    connections,
    consoleChatGoals,
    consoleData,
    conversationId,
    conversationProjectIds,
    conversationTitles,
    defaultExecutorId,
    editMode,
    executors,
    goalActions,
    locateRequest,
    onBatchAction,
    onClearSelection,
    onEditModeChange,
    onFilterChange,
    onLocateGoal,
    onNavigateToGoal,
    onNewGoal,
    onOpenDetail,
    onOpenGoalDetail,
    onRefreshed,
    onSelect,
    onSelectAllVisible,
    onToggleSelect,
    projectTitles,
    runs,
    selectedGoal,
    selectedId,
    selectedIds,
    selectedRun,
    statusFilter,
  ]);

  return (
    <SmartCabinDesktop
      className="cursor-workspace console-smart-cabin"
      strip={
        <SmartStrip
          title="调度台"
          subtitle={consoleData?.conversation.title ?? "系统对话"}
          scene={scene}
          sceneLabel={sceneLabel}
          onSceneChange={setScene}
          selectedGoal={selectedGoal}
          awaitingReviewCount={awaitingReviewGoals.length}
          executorOnlineCount={executorOnlineCount}
          executorTotalCount={agentRows.length}
          totalGoals={allConsoleGoals.length}
        />
      }
      left={
        <TaskIndexCard
          goals={allConsoleGoals}
          filter={statusFilter}
          onFilterChange={onFilterChange}
          selectedId={selectedId}
          onSelect={onSelect}
          totalCount={allConsoleGoals.length}
        />
      }
      canvas={
        <FlexibleCanvas scope="console" dockMode={dockMode} widgets={flexWidgets} />
      }
      dock={
        <ForemanDock
          dockMode={dockMode}
          onDockModeChange={setDockMode}
          selectedGoal={selectedGoal}
          taskCount={allConsoleGoals.length}
          awaitingReviewCount={awaitingReviewGoals.length}
          artifactsEnabled={artifactsEnabled}
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
