import { useMemo, useRef, type ReactNode } from "react";
import type { CoachMessageRecord, Goal, GoalRunState } from "@openx/shared";
import type { CoachReplyEvent, CoachStreamState } from "../lib/app-state";
import { useAppState } from "../lib/app-state";
import { usePinDesktop } from "../lib/use-pin-desktop";
import { usePinDockDrag } from "../lib/use-pin-dock-drag";
import type { PinWidgetId } from "../lib/pin-desktop";
import { extWidgetId } from "../lib/oxsp-catalog";
import type { ExecutorInfo } from "../api";
import type { BatchGoalsAction, GoalAccessActor } from "@openx/shared";
import { ChatPanel } from "./ChatPanel";
import { GoalsWorkspace } from "./GoalsWorkspace";
import { PreviewRail } from "./PreviewRail";
import { OxspSlotRenderer } from "./smart-cabin/OxspSlotRenderer";
import { PinWorkspaceShell } from "./smart-cabin/PinWorkspaceShell";
type GoalActions = {
  onApprove: (id: string) => Promise<boolean>;
  onRework: (id: string, reason?: string) => Promise<boolean>;
  onStart: (id: string) => Promise<boolean>;
};

type Props = {
  conversationId: string;
  conversationTitle?: string;
  conversationMode?: "foreman" | "roundtable";
  projectId?: string;
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
  upsertGoals: (goals: Goal[]) => void;
  onLocateGoal: (goalId: string) => void;
  coachReplyEvent: CoachReplyEvent | null;
  coachStream: CoachStreamState | null;
  coachMessageEvent: CoachMessageRecord | null;
};

export function ConversationWorkspace(props: Props) {
  const {
    conversationId,
    conversationMode: conversationModeProp = "foreman",
    projectId,
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
    upsertGoals,
    onLocateGoal,
    coachReplyEvent,
    coachStream,
    coachMessageEvent,
  } = props;

  const { state, enableRoundtable } = useAppState();
  const conversationMode =
    state.conversations.find((c) => c.id === conversationId)?.mode ??
    conversationModeProp;

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
  } = usePinDesktop("conversation");
  const getCellRectRef = useRef<(col: number) => DOMRect | null>(() => null);
  const {
    dockDrag,
    onGridRectChange,
    onDockDragStart,
    onDockDragMove,
    onDockDragEnd,
    onDockDragCancel,
  } = usePinDockDrag(layout, placeAtDrop, () => getCellRectRef.current);

  const selectedRun = selectedGoal ? runs[selectedGoal.id] : undefined;

  const pinWidgets = useMemo((): Partial<Record<PinWidgetId, ReactNode>> => {
    const chatPanelProps = {
      conversationId,
      conversationMode,
      projectId,
      goals,
      selectedGoal,
      runs,
      autoExecute,
      executors,
      defaultExecutorId,
      onRefreshed,
      upsertGoals,
      onOpenGoalDetail: onOpenDetail,
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
            goals={goals}
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
            embedInPin
          />
        </div>
      ),
      detail: (
        <div className="flexible-widget-fill workspace-pane workspace-pane-preview">
          <PreviewRail
            goal={selectedGoal}
            run={selectedRun}
            goals={goals}
            onSelectGoal={onSelect}
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
            desktopScope="conversation"
          />
        ),
      ] as const;
    });

    return { ...builtinWidgets, ...Object.fromEntries(extEntries) };
  }, [
    autoExecute,
    coachMessageEvent,
    coachReplyEvent,
    coachStream,
    conversationId,
    conversationMode,
    projectId,
    defaultExecutorId,
    editMode,
    executors,
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
    upsertGoals,
    onSelect,
    onSelectAllVisible,
    onToggleSelect,
    selectedGoal,
    selectedId,
    selectedIds,
    selectedRun,
    statusFilter,
    slotCatalog,
  ]);

  return (
    <PinWorkspaceShell
      className="main-view cursor-workspace conversation-smart-cabin hyper-pin-desktop"
      layout={layout}
      widgets={pinWidgets}
      activePage={activePage}
      pageCount={pageCount}
      setPage={setPage}
      getSlotLabel={getSlotLabel}
      unpin={unpin}
      applyDrop={applyDrop}
      commitSeamResize={commitSeamResize}
      dockDrag={dockDrag}
      onGridRectChange={onGridRectChange}
      getCellRectRef={getCellRectRef}
      addDockCardAtCol={addDockCardAtCol}
      addSlotFromTemplate={addSlotFromTemplate}
      isPinned={isPinned}
      pinnedCount={pinnedCount}
      togglePin={togglePin}
      registerSlotFromTemplate={registerSlotFromTemplate}
      extDockItems={extDockItems}
      onDockDragStart={onDockDragStart}
      onDockDragMove={onDockDragMove}
      onDockDragEnd={onDockDragEnd}
      onDockDragCancel={onDockDragCancel}
      onEnableRoundtable={() => {
        void enableRoundtable(conversationId).then((result) => {
          if (result && !isPinned("chat")) togglePin("chat");
        });
      }}
      roundtableActive={conversationMode === "roundtable"}
    />
  );
}
