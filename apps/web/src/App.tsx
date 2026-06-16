import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { ConversationWorkspace } from "./components/ConversationWorkspace";
import { GoalDetailPage } from "./components/GoalDetailPage";
import { SettingsPanel } from "./components/SettingsPanel";
import { ToolsPanel } from "./components/ToolsPanel";
import { NewGoalModal } from "./components/NewGoalModal";
import { BroadcastTicker } from "./components/BroadcastTicker";
import { LogStrip } from "./components/LogStrip";
import { SideNav } from "./components/SideNav";
import { TopBar } from "./components/TopBar";
import { HomeDashboard } from "./components/HomeDashboard";
import { ProjectPage } from "./components/ProjectPage";
import { ConsolePage } from "./components/ConsolePage";
import { PaneDivider } from "./components/PaneDivider";
import type { IslandAction } from "@openx/shared";
import { canMutateGoal, SYSTEM_MAIN_CONVERSATION_ID, SYSTEM_PROJECT_ID } from "@openx/shared";
import { islandFromSimpleMessage } from "./lib/island-payload";
import { completeIslandDisplay, requestIsland } from "./lib/island-queue";
import { AppProvider, useAppState } from "./lib/app-state";
import { usePaneResize } from "./lib/use-pane-resize";
import { useSidebar } from "./lib/use-sidebar";
import { resolveBootSettings } from "./lib/boot-settings";
import { setGoalAccessContext } from "./lib/goal-access-context";
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
import "./styles/smart-cabin.css";
import "./styles/pin-desktop.css";

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
    deleteProject,
    deleteConversation,
    saveSystemWorkspace,
    goalActions,
    handleTasksBatchAction,
    filteredGoals,
    conversationGoals,
    projectGoals,
    projectFilteredGoals,
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

  const { sidebarOpen, toggleSidebar } = useSidebar();

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

  useEffect(() => {
    if (state.view === "console") {
      setGoalAccessContext({ type: "console" });
      return;
    }
    if (state.view === "conversation" && state.selectedConversationId) {
      setGoalAccessContext({
        type: "conversation",
        conversationId: state.selectedConversationId,
      });
      return;
    }
    setGoalAccessContext({ type: "console" });
  }, [state.view, state.selectedConversationId]);

  const conversationTitleMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of state.conversations) {
      if (state.selectedProjectId && c.projectId !== state.selectedProjectId) continue;
      map[c.id] = c.title;
    }
    return map;
  }, [state.conversations, state.selectedProjectId]);

  const allConversationTitleMap = useMemo(
    () => Object.fromEntries(state.conversations.map((c) => [c.id, c.title])),
    [state.conversations],
  );

  const projectTitleMap = useMemo(
    () => Object.fromEntries(state.projects.map((p) => [p.id, p.name])),
    [state.projects],
  );

  const conversationProjectIdMap = useMemo(
    () => Object.fromEntries(state.conversations.map((c) => [c.id, c.projectId])),
    [state.conversations],
  );

  const conversationGoalAccess =
    state.selectedConversationId != null
      ? ({ type: "conversation", conversationId: state.selectedConversationId } as const)
      : ({ type: "console" } as const);

  const selectEditableProjectGoals = () => {
    if (!state.selectedConversationId) return;
    dispatch({
      type: "set_tasks_selected",
      ids: new Set(
        projectFilteredGoals
          .filter((g) => canMutateGoal(conversationGoalAccess, g))
          .map((g) => g.id),
      ),
    });
  };

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
    completeIslandDisplay();
  };

  const handleIslandAction = async (action: IslandAction, feedback?: string) => {
    switch (action.type) {
      case "dismiss":
        completeIslandDisplay();
        return;
      case "navigate":
        navigateToGoal(action.goalId);
        return;
      case "approve":
        await goalActions.onApprove(action.goalId);
        completeIslandDisplay();
        return;
      case "rework":
        await goalActions.onRework(action.goalId, action.reason ?? feedback);
        completeIslandDisplay();
        return;
      case "retry":
        await goalActions.onStart(action.goalId);
        return;
      case "trigger_review":
        try {
          await api.triggerGoalReview(action.goalId, { force: true });
          completeIslandDisplay();
        } catch (err) {
          requestIsland(
            islandFromSimpleMessage(
              `review-fail-${action.goalId}`,
              `审查触发失败：${err instanceof Error ? err.message : String(err)}`,
              { severity: "error", goalId: action.goalId },
            ),
          );
        }
        return;
    }
  };

  const handleAddProjectFromDashboard = async () => {
    const picked = await pickWorkspaceDirectory();
    if (picked.ok) await createProject(picked.path);
  };

  const handleDeleteProject = (projectId: string) => {
    const project = state.projects.find((p) => p.id === projectId);
    const name = project?.name ?? "该项目";
    if (!window.confirm(`确定删除项目「${name}」？\n将同时删除其下所有对话与任务，且不可恢复。`)) {
      return;
    }
    void deleteProject(projectId);
  };

  const handleDeleteConversation = (conversationId: string) => {
    const conv = state.conversations.find((c) => c.id === conversationId);
    const title = conv?.title ?? "该对话";
    if (!window.confirm(`确定删除对话「${title}」？\n将同时删除关联任务，且不可恢复。`)) {
      return;
    }
    void deleteConversation(conversationId);
  };

  const openNewGoal = () => {
    if (!state.selectedConversationId) {
      requestIsland(
        islandFromSimpleMessage(
          "new-goal-no-conversation",
          state.view === "console"
            ? "调度台会话未就绪，请稍后重试"
            : "请先在侧栏选择一个对话，再创建新目标",
        ),
      );
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
        requestIsland(
          islandFromSimpleMessage(
            "console-open-failed",
            `调度台数据刷新失败：${err instanceof Error ? err.message : String(err)}`,
            { severity: "error" },
          ),
        );
      });
  };

  return (
    <div
      ref={shellRef}
      className={`app-shell app-minimal app-shell-split${sidebarOpen ? " sidebar-open" : " sidebar-collapsed"}`}
      style={{
        gridTemplateColumns: sidebarOpen
          ? `${sidebarWidth}px var(--pane-divider-hit) minmax(0, 1fr)`
          : undefined,
      }}
    >
      <div
        className="app-sidebar-wrap"
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
        onDeleteProject={handleDeleteProject}
        onDeleteConversation={handleDeleteConversation}
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
      </div>

      <PaneDivider
        className="app-shell-divider"
        ariaLabel="调整侧栏宽度"
        onPointerDown={(e) => onSidebarDragStart(e, shellRef.current)}
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
            sidebarOpen={sidebarOpen}
            onSidebarToggle={toggleSidebar}
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
                  allGoals={state.view === "conversation" ? projectGoals : state.goals}
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
                  onDeleteConversation={handleDeleteConversation}
                  onBatchAction={handleTasksBatchAction}
                  goalActions={goalActions}
                />
              )}

              {!state.detailGoalId && state.view === "console" && state.selectedConversationId && (
                <ConsolePage
                  conversationId={state.selectedConversationId}
                  goals={state.goals}
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
                      ids: new Set(state.goals.map((g) => g.id)),
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
                  conversationTitles={allConversationTitleMap}
                  projectTitles={projectTitleMap}
                  conversationProjectIds={conversationProjectIdMap}
                />
              )}

              {!state.detailGoalId &&
                state.view === "conversation" &&
                state.selectedConversationId && (
                  <ConversationWorkspace
                    conversationId={state.selectedConversationId}
                    conversationTitle={
                      conversationTitleMap[state.selectedConversationId]
                    }
                    goals={conversationGoals}
                    selectedGoal={selected}
                    selectedId={state.selectedId}
                    runs={state.runs}
                    statusFilter={state.statusFilter}
                    onFilterChange={(filter) =>
                      dispatch({ type: "set_status_filter", filter })
                    }
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
                    onSelectAllVisible={selectEditableProjectGoals}
                    onClearSelection={() =>
                      dispatch({ type: "clear_tasks_selection" })
                    }
                    onBatchAction={handleTasksBatchAction}
                    locateRequest={locateRequest}
                    goalAccess={conversationGoalAccess}
                    goalActions={goalActions}
                    autoExecute={settings.autoExecute}
                    executors={state.executors}
                    defaultExecutorId={settings.defaultExecutorId}
                    onRefreshed={refreshGoals}
                    onLocateGoal={locateGoalInTasks}
                    coachReplyEvent={state.coachReplyEvent}
                    coachStream={state.coachStream}
                    coachMessageEvent={state.coachMessageEvent}
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
                      projectId={state.selectedProjectId}
                      goals={state.goals}
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
                        const saved = await api.saveSettingsFresh(s);
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
                        requestIsland(
                          islandFromSimpleMessage(
                            `cli-${goal.id}`,
                            `已创建 CLI 接入任务：${goal.title}（在「OpenX 系统」项目中跟踪）`,
                            { goalId: goal.id },
                          ),
                        );
                      }}
                      onConnectReady={(executorId) => {
                        void refreshExecutors();
                        requestIsland(
                          islandFromSimpleMessage(
                            `connect-${executorId}`,
                            `Connect Agent「${executorId}」已自动自举并上线`,
                          ),
                        );
                      }}
                      onSave={async (s) => {
                        const saved = await api.saveSettingsFresh(s);
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
        payload={state.islandPayload}
        onDismiss={() => completeIslandDisplay(state.islandPayload?.id)}
        onAction={handleIslandAction}
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
