import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { BatchGoalsAction, CliProfile, CoachMessageRecord, Conversation, Goal, GoalRunState, Project } from "@openx/shared";
import { goalMatchesDisplayFilter } from "@openx/shared";
import { api, type ExecutorInfo } from "../api";
import type { CoachReplyEvent, CoachStreamState } from "../lib/app-state";
import { usePinDesktop } from "../lib/use-pin-desktop";
import { usePinDockDrag } from "../lib/use-pin-dock-drag";
import type { PinWidgetId } from "../lib/pin-desktop";
import { extWidgetId } from "../lib/oxsp-catalog";
import type { ConsoleConnection } from "../lib/console-agents";
import { ChatPanel } from "./ChatPanel";
import { GoalsWorkspace } from "./GoalsWorkspace";
import { PreviewRail } from "./PreviewRail";
import { HyperPinDesktop } from "./smart-cabin/HyperPinDesktop";
import { PinDesktopCanvas } from "./smart-cabin/PinDesktopCanvas";
import { PinDesktopPager } from "./smart-cabin/PinDesktopPager";
import { OxspSlotRenderer } from "./smart-cabin/OxspSlotRenderer";
import { PinDock } from "./smart-cabin/PinDock";
import { TaskDetailPanel } from "./TaskDetailPanel";

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
  logs: { goalId: string; level: string; message: string; timestamp: string }[];
  onSettings?: () => void;
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
    coachReplyEvent,
    coachStream,
    coachMessageEvent,
    conversationTitles,
    projectTitles,
    conversationProjectIds,
    logs,
    onSettings,
  } = props;

  const [consoleData, setConsoleData] = useState<ConsoleData | null>(null);
  const {
    layout,
    slotCatalog,
    activePage,
    pageCount,
    pinnedCount,
    setPage,
    isPinned,
    togglePin,
    unpin,
    addDockCardAtCol,
    addSlotFromTemplate,
    registerSlotFromTemplate,
    extDockItems,
    getSlotLabel,
    applyDrop,
    placeAtDrop,
    commitSeamResize,
  } = usePinDesktop("console");
  const getCellRectRef = useRef<(col: number) => DOMRect | null>(() => null);
  const {
    dockDrag,
    onGridRectChange,
    onDockDragStart,
    onDockDragMove,
    onDockDragEnd,
    onDockDragCancel,
  } = usePinDockDrag(layout, placeAtDrop, () => getCellRectRef.current);

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

  const consoleChatGoals = useMemo(
    () => goals.filter((g) => g.conversationId === conversationId),
    [goals, conversationId],
  );

  const selectedRun = selectedGoal ? runs[selectedGoal.id] : undefined;

  const selectedGoals = useMemo(
    () => allConsoleGoals.filter((g) => selectedIds.has(g.id)),
    [allConsoleGoals, selectedIds],
  );

  const pinWidgets = useMemo((): Partial<Record<PinWidgetId, ReactNode>> => {
    const chatPanelProps = {
      conversationId,
      projectId: conversationProjectIds?.[conversationId],
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

    const builtinWidgets: Partial<Record<PinWidgetId, ReactNode>> = {
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
            embedInPin
            logs={logs}
          />
        </div>
      ),
      detail: (
        <div className="flexible-widget-fill workspace-pane workspace-pane-detail">
          <TaskDetailPanel
            goal={selectedGoal}
            allGoals={allConsoleGoals}
            editMode={editMode}
            selectedGoals={selectedGoals}
            logs={logs}
            run={selectedRun}
            onApprove={goalActions.onApprove}
            onRework={goalActions.onRework}
            onStart={goalActions.onStart}
            onOpenDetail={onOpenGoalDetail}
            surface="pin"
            conversationTitles={conversationTitles}
          />
        </div>
      ),
      evidence: (
        <div className="flexible-widget-fill workspace-pane workspace-pane-preview">
          <PreviewRail
            goal={selectedGoal}
            run={selectedRun}
            goals={allConsoleGoals}
            logs={logs}
            onSelectGoal={onSelect}
            surface="evidence"
          />
        </div>
      ),
    };

    const extEntries = slotCatalog.slots.map((slot) => {
      const widget = extWidgetId(slot.id);
      return [
        widget,
        (
          <OxspSlotRenderer
            key={slot.id}
            widget={widget}
            catalog={slotCatalog}
            builtinWidgets={builtinWidgets}
            desktopScope="console"
          />
        ),
      ] as const;
    });

    return { ...builtinWidgets, ...Object.fromEntries(extEntries) };
  }, [
    allConsoleFiltered,
    allConsoleGoals,
    autoExecute,
    cliProfiles,
    coachMessageEvent,
    coachReplyEvent,
    coachStream,
    consoleChatGoals,
    conversationId,
    conversationProjectIds,
    conversationTitles,
    defaultExecutorId,
    editMode,
    executors,
    goalActions,
    locateRequest,
    logs,
    onBatchAction,
    onClearSelection,
    onEditModeChange,
    onFilterChange,
    onLocateGoal,
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
    selectedGoals,
    selectedId,
    selectedIds,
    selectedRun,
    statusFilter,
    slotCatalog,
  ]);

  return (
    <HyperPinDesktop
      className="cursor-workspace console-smart-cabin hyper-pin-desktop"
      canvas={
        <PinDesktopPager
          pageIndex={activePage}
          pageCount={pageCount}
          onPageChange={setPage}
        >
          <PinDesktopCanvas
            layout={layout}
            widgets={pinWidgets}
            getSlotLabel={getSlotLabel}
            onUnpin={unpin}
            onApplyDrop={applyDrop}
            onSeamCommit={commitSeamResize}
            dockDragWidget={dockDrag?.widget ?? null}
            dockDragOverCol={dockDrag?.overCol ?? null}
            dockDragOverZone={dockDrag?.overZone ?? null}
            onGridRectChange={onGridRectChange}
            onBindCellRect={(getter) => {
              getCellRectRef.current = getter;
            }}
            onPinWidgetAtCol={addDockCardAtCol}
            onAddTemplateAtCol={addSlotFromTemplate}
            isDockWidgetPinned={isPinned}
            pageIndex={activePage}
            pageCount={pageCount}
          />
        </PinDesktopPager>
      }
      dock={
        <PinDock
          extItems={extDockItems}
          isPinned={isPinned}
          pinnedCount={pinnedCount}
          onTogglePin={togglePin}
          onRegisterTemplate={registerSlotFromTemplate}
          onDockDragStart={onDockDragStart}
          onDockDragMove={onDockDragMove}
          onDockDragEnd={onDockDragEnd}
          onDockDragCancel={onDockDragCancel}
          onRemoveTab={unpin}
          onSettings={onSettings}
        />
      }
    />
  );
}
