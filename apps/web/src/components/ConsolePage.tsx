import { useCallback, useEffect, useMemo, useState } from "react";
import type { CliProfile, Conversation, Goal, Project } from "@openx/shared";
import { api, type ExecutorInfo } from "../api";
import { ChatPanel } from "./ChatPanel";
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
};

type Props = {
  conversationId: string;
  goals: Goal[];
  filteredGoals: Goal[];
  allGoals: Goal[];
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
};

export function ConsolePage({
  conversationId,
  goals,
  filteredGoals,
  allGoals,
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
    void loadConsole();
    const timer = setInterval(() => void loadConsole(), 15_000);
    return () => clearInterval(timer);
  }, [loadConsole, goals.length]);

  const connections = consoleData?.connections ?? [];
  const agentRows = useMemo(
    () => buildConsoleAgentRows(executors, cliProfiles, connections),
    [executors, cliProfiles, connections],
  );
  const availableAgents = agentRows.filter((row) => row.available);
  const connectLinkedCount = connections.length;

  return (
    <SplitWorkspace
      className="main-view home-view cursor-workspace console-workspace"
      left={
        <div className="workspace-pane workspace-pane-tasks console-left">
          <section className="console-section">
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
              <>
                <ul className="console-cli-list">
                  {agentRows.map((row) => (
                    <li
                      key={row.id}
                      className={`console-cli-card${row.available ? " console-cli-card-online" : ""}`}
                    >
                      <div className="console-cli-name-row">
                        <span className="console-cli-name">{row.label}</span>
                        <span className={`console-cli-kind ${row.kind}`}>
                          {consoleAgentKindBadge(row.kind)}
                        </span>
                      </div>
                      <div className="console-cli-meta">
                        <span>{row.id}</span>
                        <span className={row.available ? "console-cli-status-ok" : ""}>
                          {row.statusLabel}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
                {connectLinkedCount === 0 && availableAgents.some((r) => r.kind !== "connect") ? (
                  <p className="console-muted console-hint">
                    当前 ACP/Pi 在本机就绪，但任务池「任意在线 CLI」仅由 Connect
                    心跳客户端认领。Connect 任务请在设置 → 工具与 CLI 中自举接入。
                  </p>
                ) : null}
              </>
            )}
          </section>

          {consoleData && consoleData.crossProjectReviewGoals.length > 0 ? (
            <section className="console-section">
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

          <section className="console-section console-section-pool">
            <div className="console-section-head">
              <h3 className="console-section-title">系统任务池</h3>
            </div>
            <TasksPanel
              goals={filteredGoals}
              allGoals={allGoals}
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
              {...goalActions}
            />
          </section>
        </div>
      }
      right={
        <div className="workspace-pane workspace-pane-assistant">
          <ChatPanel
            conversationId={conversationId}
            goals={allGoals}
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
