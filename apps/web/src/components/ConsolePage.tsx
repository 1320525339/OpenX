import { useCallback, useEffect, useMemo, useState } from "react";
import type { CliProfile, Conversation, Goal, Project } from "@openx/shared";
import { goalMatchesDisplayFilter } from "@openx/shared";
import { api, type ExecutorInfo } from "../api";
import { ChatPanel } from "./ChatPanel";
import { SplitPaneStack } from "./SplitPaneStack";
import { SplitWorkspace } from "./SplitWorkspace";
import { TasksPanel } from "./TasksPanel";
import type { CoachMessageRecord } from "@openx/shared";
import type { CoachReplyEvent, CoachStreamState } from "../lib/app-state";
import {
  buildConsoleAgentRows,
  consoleAgentKindBadge,
  consoleAgentSummary,
  type ConsoleConnection,
} from "../lib/console-agents";

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
  onBatchAction: (
    action: import("@openx/shared").BatchGoalsAction,
    ids: string[],
  ) => Promise<void>;
  goalActions: {
    onApprove: (id: string) => Promise<void>;
    onRework: (id: string, reason?: string) => Promise<void>;
    onStart: (id: string) => Promise<void>;
    onCancel: (id: string) => Promise<void>;
  };
  locateRequest: { goalId: string; tick: number } | null;
  selectedGoal?: Goal;
  runs: Record<string, import("@openx/shared").GoalRunState>;
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

export function ConsolePage({
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
}: Props) {
  const [consoleData, setConsoleData] = useState<ConsoleData | null>(null);

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
  const connectLinkedCount = connections.length;

  const consoleChatGoals = useMemo(
    () => goals.filter((g) => g.conversationId === conversationId),
    [goals, conversationId],
  );

  return (
    <SplitWorkspace
      className="main-view home-view cursor-workspace console-workspace"
      left={
        <SplitPaneStack
          className="workspace-pane workspace-pane-tasks console-left"
          storageKey="openx.consoleTopRatio"
          defaultRatio={0.34}
          minRatio={0.18}
          maxRatio={0.62}
          ariaLabel="调整执行器与任务池高度"
          swappedStorageKey="openx.consoleStackSwapped"
          swapAriaLabel="交换执行器与任务池位置"
          top={
            <>
              <section className="console-section console-section-executors">
                <div className="console-section-head">
                  <h3 className="console-section-title">在线执行器</h3>
                  <span className="console-section-meta">
                    {consoleAgentSummary(agentRows, connectLinkedCount)}
                  </span>
                </div>
                {agentRows.length === 0 ? (
                  <p className="console-muted">
                    尚未配置 CLI。请在设置 → 工具与 CLI 中添加或同步 Skills。
                  </p>
                ) : (
                  <ul className="console-cli-list">
                    {agentRows.map((row) => (
                      <li
                        key={row.id}
                        className="console-cli-card"
                        title={row.statusLabel}
                      >
                        <span
                          className="console-cli-status-dot"
                          data-tone={row.statusTone}
                          aria-label={row.statusLabel}
                        />
                        <span className="console-cli-name">{row.label}</span>
                        <span className={`console-cli-kind ${row.kind}`}>
                          {consoleAgentKindBadge(row.kind)}
                        </span>
                        <span className="console-cli-id">{row.id}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {consoleData && consoleData.crossProjectReviewGoals.length > 0 ? (
                <section className="console-section console-section-review">
                  <div className="console-section-head">
                    <h3 className="console-section-title">跨项目待确认</h3>
                    <span className="console-section-meta">
                      {consoleData.stats.crossProjectAwaitingReview} 项
                    </span>
                  </div>
                  <ul className="console-review-list">
                    {consoleData.crossProjectReviewGoals.map((goal) => (
                      <li key={goal.id}>
                        <button
                          type="button"
                          className="console-review-item"
                          onClick={() => onNavigateToGoal(goal.id)}
                        >
                          <span className="console-review-title">{goal.title}</span>
                          <span className="console-review-meta">等你确认 →</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          }
          bottom={
            <section className="console-section console-section-pool">
              <div className="console-section-head">
                <h3 className="console-section-title">全部任务单</h3>
                <span className="console-section-meta">{allConsoleGoals.length} 项</span>
              </div>
              <TasksPanel
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
                {...goalActions}
              />
            </section>
          }
        />
      }
      right={
        <div className="workspace-pane workspace-pane-assistant">
          <ChatPanel
            conversationId={conversationId}
            goals={consoleChatGoals}
            selectedGoal={selectedGoal}
            runs={runs}
            autoExecute={autoExecute}
            executors={executors}
            defaultExecutorId={defaultExecutorId}
            onRefreshed={onRefreshed}
            onOpenGoalDetail={onOpenGoalDetail}
            onLocateGoal={onLocateGoal}
            onStartGoal={goalActions.onStart}
            onApproveGoal={goalActions.onApprove}
            onReworkGoal={goalActions.onRework}
            coachReplyEvent={coachReplyEvent}
            coachStream={coachStream}
            coachMessageEvent={coachMessageEvent}
          />
        </div>
      }
    />
  );
}
