import { useRef, useState, type PointerEvent } from "react";
import { TasksPanel } from "./components/TasksPanel";
import { ChatPanel } from "./components/ChatPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { ToolsPanel } from "./components/ToolsPanel";
import { NewGoalModal } from "./components/NewGoalModal";
import { BroadcastTicker } from "./components/BroadcastTicker";
import { LogStrip } from "./components/LogStrip";
import { SideNav } from "./components/SideNav";
import { TopBar } from "./components/TopBar";
import { SplitWorkspace } from "./components/SplitWorkspace";
import { GoalDetailPage } from "./components/GoalDetailPage";
import { HomeDashboard } from "./components/HomeDashboard";
import { ProjectPage } from "./components/ProjectPage";
import { ConsolePage } from "./components/ConsolePage";
import { PaneDivider } from "./components/PaneDivider";
import { SYSTEM_MAIN_CONVERSATION_ID, SYSTEM_PROJECT_ID } from "@openx/shared";
import { AppProvider, useAppState } from "./lib/app-state";
import { usePaneResize } from "./lib/use-pane-resize";
import { resolveBootSettings } from "./lib/boot-settings";
import { getRunState } from "./lib/run-state";
import { api } from "./api";
import { pickWorkspaceDirectory } from "./lib/workspace";
import "./styles/app.css";
import "./styles/panels.css";
import "./styles/settings-model.css";
import "./styles/settings-tools.css";
import "./styles/topbar.css";
import "./styles/log-strip.css";
import "./styles/hyperos-workspace.css";
import "./styles/cursor-workspace.css";
import "./styles/minimal.css";
import "./styles/layout-shell.css";
import "./styles/theme-overrides.css";
import "./styles/typography.css";

function AppContent() {
  const {
    state,
    dispatch,
    refreshGoals,
    refreshExecutors,
    refreshMeta,
    refreshProjects,
    createProject,
    createConversation,
    saveSystemWorkspace,
    goalActions,
    handleTasksBatchAction,
    filteredGoals,
    conversationGoals,
    selected,
    selectedProject,
    selectedConversation,
    inboxBadgeCount,
    consoleBadgeCount,
  } = useAppState();

  const shellRef = useRef<HTMLDivElement>(null);
  const {
    value: sidebarWidth,
    beginDrag: onSidebarDragStart,
    onDividerPointerMove,
    endDrag: onSidebarDragEnd,
  } = usePaneResize({
    mode: "width",
    storageKey: "openx.sidebarWidth",
    defaultWidth: 148,
    minWidth: 132,
    maxWidth: 300,
  });

  const onSidebarDividerMove = (e: PointerEvent<HTMLDivElement>) => {
    onDividerPointerMove(e, shellRef.current);
  };

  const [locateRequest, setLocateRequest] = useState<{
    goalId: string;
    tick: number;
  } | null>(null);

  const locateGoalInTasks = (goalId: string) => {
    dispatch({ type: "set_selected", id: goalId });
    if (state.statusFilter !== "all") {
      dispatch({ type: "set_status_filter", filter: "all" });
    }
    setLocateRequest({ goalId, tick: Date.now() });
  };

  const { settings: settingsState } = state;
  const settings = resolveBootSettings(settingsState);
  const settingsReady = settingsState !== null;
  const showGlobalLoadError =
    Boolean(state.loadError) && !settingsReady && state.view !== "settings";
  const detailGoal = state.detailGoalId
    ? state.goals.find((g) => g.id === state.detailGoalId)
    : undefined;

  const projectConversations = state.selectedProjectId
    ? state.conversations.filter((c) => c.projectId === state.selectedProjectId)
    : [];

  const projectGoals = state.selectedProjectId
    ? state.goals.filter((g) =>
        projectConversations.some((c) => c.id === g.conversationId),
      )
    : [];

  const openGoalDetail = (id: string) => dispatch({ type: "open_goal_detail", id });
  const closeGoalDetail = () => dispatch({ type: "close_goal_detail" });

  const navigateToGoal = (goalId: string) => {
    const goal = state.goals.find((g) => g.id === goalId);
    if (!goal) return;
    const conv = state.conversations.find((c) => c.id === goal.conversationId);
    if (!conv) return;
    dispatch({
      type: "open_conversation",
      projectId: conv.projectId,
      conversationId: conv.id,
      goalId,
    });
  };

  const handleAddProjectFromDashboard = async () => {
    const picked = await pickWorkspaceDirectory();
    if (picked.ok) await createProject(picked.path);
  };

  const openNewGoal = () => {
    if (!state.selectedConversationId) {
      dispatch({
        type: "show_island",
        alert: {
          id: "new-goal-no-conversation",
          message:
            state.view === "console"
              ? "调度台会话未就绪，请稍后重试"
              : "请先在侧栏选择一个对话，再创建新目标",
          kind: "info",
        },
      });
      return;
    }
    dispatch({ type: "set_show_new_goal", show: true });
  };

  const openConsole = () => {
    dispatch({
      type: "open_console",
      projectId: SYSTEM_PROJECT_ID,
      conversationId: SYSTEM_MAIN_CONVERSATION_ID,
    });
    void api
      .getSystemConsole()
      .then((data) => {
        dispatch({ type: "upsert_project", project: data.project });
        dispatch({ type: "upsert_conversation", conversation: data.conversation });
      })
      .catch((err) => {
        dispatch({
          type: "show_island",
          alert: {
            id: "console-open-failed",
            message: `调度台数据刷新失败：${err instanceof Error ? err.message : String(err)}`,
            kind: "error",
          },
        });
      });
  };

  return (
    <div
      ref={shellRef}
      className="app-shell app-minimal app-shell-split"
      style={{
        gridTemplateColumns: `${sidebarWidth}px var(--pane-divider-hit) minmax(0, 1fr)`,
      }}
    >
      <SideNav
        active={state.view}
        projects={state.projects}
        conversations={state.conversations}
        goals={state.goals}
        selectedProjectId={state.selectedProjectId}
        selectedConversationId={state.selectedConversationId}
        expandedProjectIds={state.expandedProjectIds}
        onHome={() => dispatch({ type: "set_view", view: "home" })}
        onOpenConsole={openConsole}
        onOpenProject={(projectId) => dispatch({ type: "open_project", projectId })}
        onOpenConversation={(projectId, conversationId) =>
          dispatch({ type: "open_conversation", projectId, conversationId })
        }
        onToggleProject={(projectId) =>
          dispatch({ type: "toggle_project_expanded", projectId })
        }
        onAddProject={async (workspaceDir) => {
          await createProject(workspaceDir);
        }}
        onNewConversation={(projectId) => void createConversation(projectId)}
        onSettings={() => {
          dispatch({ type: "set_view", view: "settings" });
          if (!settingsReady) void refreshMeta();
        }}
        onNewGoal={openNewGoal}
        inboxBadgeCount={inboxBadgeCount}
        consoleBadgeCount={consoleBadgeCount}
        systemWorkspaceRoot={settings.systemWorkspaceRoot}
        systemWorkspaceResolved={settings.systemWorkspaceResolved}
        onSystemWorkspaceSave={saveSystemWorkspace}
      />

      <PaneDivider
        className="app-shell-divider"
        ariaLabel="调整侧栏宽度"
        onPointerDown={onSidebarDragStart}
        onPointerMove={onSidebarDividerMove}
        onPointerUp={onSidebarDragEnd}
        onPointerCancel={onSidebarDragEnd}
      />

      <div className="app-main-column">
        {state.view !== "settings" && (
          <TopBar
            view={state.view}
            goals={
              state.view === "conversation" || state.view === "console"
                ? conversationGoals
                : state.view === "project"
                  ? projectGoals
                  : state.goals
            }
            statusFilter={state.statusFilter}
            filteredCount={filteredGoals.length}
            detailGoal={state.detailGoalId ? detailGoal : undefined}
            selectedProject={selectedProject}
            selectedConversation={selectedConversation}
            sseStatus={state.sseStatus}
            onUrgentClick={navigateToGoal}
            onNewGoal={openNewGoal}
          />
        )}

        <main className="app-main">
          {showGlobalLoadError ? (
            <div className="main-view loading-view">
              <p>{state.loadError}</p>
              <button type="button" className="btn primary" onClick={() => void refreshMeta()}>
                重试
              </button>
            </div>
          ) : (
            <>
              {state.detailGoalId &&
                (state.view === "conversation" || state.view === "console") && (
                <GoalDetailPage
                  goal={detailGoal}
                  logs={state.logs}
                  run={
                    detailGoal
                      ? getRunState(state.runs, detailGoal.id)
                      : undefined
                  }
                  allGoals={conversationGoals}
                  onBack={closeGoalDetail}
                  {...goalActions}
                />
              )}

              {!state.detailGoalId && state.view === "home" && (
                <HomeDashboard
                  goals={state.goals}
                  projects={state.projects}
                  conversations={state.conversations}
                  onOpenConversation={(projectId, conversationId, goalId) =>
                    dispatch({
                      type: "open_conversation",
                      projectId,
                      conversationId,
                      goalId,
                    })
                  }
                  onAddProject={() => void handleAddProjectFromDashboard()}
                />
              )}

              {!state.detailGoalId && state.view === "project" && selectedProject && (
                <ProjectPage
                  project={selectedProject}
                  conversations={projectConversations}
                  goals={projectGoals}
                  onOpenConversation={(conversationId, goalId) =>
                    dispatch({
                      type: "open_conversation",
                      projectId: selectedProject.id,
                      conversationId,
                      goalId,
                    })
                  }
                  onNewConversation={() => void createConversation(selectedProject.id)}
                  onBatchAction={handleTasksBatchAction}
                  goalActions={goalActions}
                />
              )}

              {!state.detailGoalId && state.view === "console" && state.selectedConversationId && (
                <ConsolePage
                  conversationId={state.selectedConversationId}
                  goals={conversationGoals}
                  filteredGoals={filteredGoals}
                  allGoals={conversationGoals}
                  statusFilter={state.statusFilter}
                  onFilterChange={(filter) =>
                    dispatch({ type: "set_status_filter", filter })
                  }
                  selectedId={state.selectedId}
                  onSelect={(id) => dispatch({ type: "set_selected", id })}
                  onOpenDetail={openGoalDetail}
                  onNewGoal={openNewGoal}
                  editMode={state.tasksEditMode}
                  onEditModeChange={(edit) =>
                    dispatch({ type: "set_tasks_edit_mode", edit })
                  }
                  selectedIds={state.tasksSelectedIds}
                  onToggleSelect={(id) =>
                    dispatch({ type: "toggle_task_select", id })
                  }
                  onSelectAllVisible={() =>
                    dispatch({
                      type: "set_tasks_selected",
                      ids: new Set(filteredGoals.map((g) => g.id)),
                    })
                  }
                  onClearSelection={() =>
                    dispatch({ type: "clear_tasks_selection" })
                  }
                  onBatchAction={handleTasksBatchAction}
                  locateRequest={locateRequest}
                  selectedGoal={selected}
                  runs={state.runs}
                  autoExecute={settings.autoExecute}
                  executors={state.executors}
                  cliProfiles={settings.cliProfiles ?? []}
                  defaultExecutorId={settings.defaultExecutorId}
                  onRefreshed={refreshGoals}
                  onOpenGoalDetail={openGoalDetail}
                  onLocateGoal={locateGoalInTasks}
                  onNavigateToGoal={navigateToGoal}
                  coachReplyEvent={state.coachReplyEvent}
                  coachStream={state.coachStream}
                  coachMessageEvent={state.coachMessageEvent}
                  goalActions={goalActions}
                />
              )}

              {!state.detailGoalId &&
                state.view === "conversation" &&
                state.selectedConversationId && (
                  <SplitWorkspace
                    className="main-view home-view cursor-workspace"
                    left={
                      <div className="workspace-pane workspace-pane-tasks">
                        <TasksPanel
                          goals={filteredGoals}
                          allGoals={conversationGoals}
                          filter={state.statusFilter}
                          onFilterChange={(filter) =>
                            dispatch({ type: "set_status_filter", filter })
                          }
                          selectedId={state.selectedId}
                          onSelect={(id) => dispatch({ type: "set_selected", id })}
                          onOpenDetail={openGoalDetail}
                          onNewGoal={openNewGoal}
                          hideFooterNewGoal
                          editMode={state.tasksEditMode}
                          onEditModeChange={(edit) =>
                            dispatch({ type: "set_tasks_edit_mode", edit })
                          }
                          selectedIds={state.tasksSelectedIds}
                          onToggleSelect={(id) =>
                            dispatch({ type: "toggle_task_select", id })
                          }
                          onSelectAllVisible={() =>
                            dispatch({
                              type: "set_tasks_selected",
                              ids: new Set(filteredGoals.map((g) => g.id)),
                            })
                          }
                          onClearSelection={() =>
                            dispatch({ type: "clear_tasks_selection" })
                          }
                          onBatchAction={handleTasksBatchAction}
                          locateRequest={locateRequest}
                          {...goalActions}
                        />
                      </div>
                    }
                    right={
                      <div className="workspace-pane workspace-pane-assistant">
                        <ChatPanel
                          conversationId={state.selectedConversationId}
                          goals={conversationGoals}
                          selectedGoal={selected}
                          runs={state.runs}
                          autoExecute={settings.autoExecute}
                          executors={state.executors}
                          defaultExecutorId={settings.defaultExecutorId}
                          onRefreshed={refreshGoals}
                          onOpenGoalDetail={openGoalDetail}
                          onLocateGoal={locateGoalInTasks}
                          onStartGoal={goalActions.onStart}
                          onApproveGoal={goalActions.onApprove}
                          onReworkGoal={goalActions.onRework}
                          coachReplyEvent={state.coachReplyEvent}
                          coachStream={state.coachStream}
                          coachMessageEvent={state.coachMessageEvent}
                        />
                      </div>
                    }
                  />
                )}

              {state.view === "settings" && (
                <div className="main-view single-view settings-page">
                  {!settingsReady ? (
                    <div className="loading-view settings-loading">
                      <p>{state.loadError ? `加载设置失败：${state.loadError}` : "加载设置…"}</p>
                      <button
                        type="button"
                        className="btn primary"
                        onClick={() => void refreshMeta()}
                      >
                        重试
                      </button>
                    </div>
                  ) : (
                  <>
                  <div className="settings-tabs" role="tablist" aria-label="设置分类">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={state.settingsTab === "general"}
                      className={`settings-tab${state.settingsTab === "general" ? " active" : ""}`}
                      onClick={() => dispatch({ type: "set_settings_tab", tab: "general" })}
                    >
                      常规
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={state.settingsTab === "tools"}
                      className={`settings-tab${state.settingsTab === "tools" ? " active" : ""}`}
                      onClick={() => dispatch({ type: "set_settings_tab", tab: "tools" })}
                    >
                      工具与 CLI
                    </button>
                  </div>
                  {state.settingsTab === "general" ? (
                    <SettingsPanel
                      settings={settingsState}
                      workspaceResolved={settings.systemWorkspaceResolved}
                      executors={state.executors}
                      onRefreshExecutors={refreshExecutors}
                      onReloadSettings={async () => {
                        const s = await api.getSettings();
                        dispatch({ type: "set_settings", settings: s });
                        const status = await api.getModelStatus().catch(() => null);
                        dispatch({
                          type: "set_coach_runtime",
                          runtime: status?.coach ?? null,
                        });
                      }}
                      onSave={async (s) => {
                        const saved = await api.putSettings(s);
                        dispatch({ type: "set_settings", settings: saved });
                        await refreshProjects();
                        await refreshExecutors();
                        const status = await api.getModelStatus().catch(() => null);
                        dispatch({
                          type: "set_coach_runtime",
                          runtime: status?.coach ?? null,
                        });
                      }}
                      onWorkspaceSave={saveSystemWorkspace}
                    />
                  ) : (
                    <ToolsPanel
                      settings={settingsState!}
                      executors={state.executors}
                      onChange={(s) => dispatch({ type: "set_settings", settings: s })}
                      onRefreshExecutors={refreshExecutors}
                      onIntegrationGoalCreated={(goal) => {
                        void refreshGoals();
                        void refreshProjects();
                        dispatch({
                          type: "show_island",
                          alert: {
                            id: `cli-${goal.id}`,
                            message: `已创建 CLI 接入任务：${goal.title}（在「OpenX 系统」项目中跟踪）`,
                            goalId: goal.id,
                            kind: "info",
                            status: goal.status,
                          },
                        });
                      }}
                      onConnectReady={(executorId) => {
                        void refreshExecutors();
                        dispatch({
                          type: "show_island",
                          alert: {
                            id: `connect-${executorId}`,
                            message: `Connect Agent「${executorId}」已自动自举并上线`,
                            kind: "info",
                          },
                        });
                      }}
                      onSave={async (s) => {
                        const saved = await api.putSettings(s);
                        dispatch({ type: "set_settings", settings: saved });
                        await refreshExecutors();
                      }}
                    />
                  )}
                  </>
                  )}
                </div>
              )}
            </>
          )}
        </main>

        <LogStrip
          logs={state.logs}
          selectedGoalId={state.selectedId}
          selectedGoalTitle={selected?.title}
          sseStatus={state.sseStatus}
          expanded={state.logStripExpanded}
          onToggleExpand={() => dispatch({ type: "toggle_log_strip" })}
        />
      </div>

      <BroadcastTicker
        alert={state.islandAlert}
        onDismiss={() => dispatch({ type: "dismiss_island" })}
        onNavigate={navigateToGoal}
      />

      {state.showNewGoal && state.selectedConversationId && (
        <NewGoalModal
          conversationId={state.selectedConversationId}
          autoExecute={settings.autoExecute}
          executors={state.executors}
          defaultExecutorId={settings.defaultExecutorId}
          connectOnly={state.view === "console"}
          modalTitle={state.view === "console" ? "发布系统任务" : "新目标"}
          onClose={() => dispatch({ type: "set_show_new_goal", show: false })}
          onCreated={(g) => {
            dispatch({ type: "set_selected", id: g.id });
            dispatch({ type: "set_show_new_goal", show: false });
            void refreshGoals();
          }}
        />
      )}
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
