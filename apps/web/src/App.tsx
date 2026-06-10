import { TasksPanel } from "./components/TasksPanel";
import { TaskDetailPanel } from "./components/TaskDetailPanel";
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
import { AppProvider, useAppState } from "./lib/app-state";
import { api } from "./api";
import "./styles/app.css";
import "./styles/panels.css";
import "./styles/settings-model.css";
import "./styles/settings-tools.css";
import "./styles/typography.css";
import "./styles/topbar.css";
import "./styles/log-strip.css";
import "./styles/hyperos-workspace.css";

function AppContent() {
  const {
    state,
    dispatch,
    refreshGoals,
    refreshExecutors,
    refreshMeta,
    saveWorkspace,
    goalActions,
    handleTasksBatchAction,
    filteredGoals,
    selected,
    runningCount,
    reviewCount,
    tasksSelectedGoals,
  } = useAppState();

  const { settings } = state;
  const detailGoal = state.detailGoalId
    ? state.goals.find((g) => g.id === state.detailGoalId)
    : undefined;

  const openGoalDetail = (id: string) => dispatch({ type: "open_goal_detail", id });
  const closeGoalDetail = () => dispatch({ type: "close_goal_detail" });

  return (
    <div className="app-shell app-shell-nav">
      <SideNav
        active={state.view}
        onChange={(view) => dispatch({ type: "set_view", view })}
        onNewGoal={() => dispatch({ type: "set_show_new_goal", show: true })}
        runningCount={runningCount}
        reviewCount={reviewCount}
        workspaceRoot={settings?.workspaceRoot}
        workspaceResolved={settings?.workspaceResolved}
        onWorkspaceSave={saveWorkspace}
      />

      <div className="app-main-column">
        <TopBar
          executorScope={state.executorScope}
          onExecutorScopeChange={(scope) =>
            dispatch({ type: "set_executor_scope", scope })
          }
          executors={state.executors}
          sseStatus={state.sseStatus}
          coachRuntime={state.coachRuntime}
        />
        <BroadcastTicker messages={state.broadcastHistory} />

        <main className="app-main">
          {!settings ? (
            <div className="main-view loading-view">
              {state.loadError ? (
                <>
                  <p>{state.loadError}</p>
                  <button type="button" className="btn primary" onClick={() => void refreshMeta()}>
                    重试
                  </button>
                </>
              ) : (
                "加载中…"
              )}
            </div>
          ) : (
            <>
              {state.detailGoalId &&
                (state.view === "home" ||
                  state.view === "running" ||
                  state.view === "review") && (
                  <GoalDetailPage
                    goal={detailGoal}
                    logs={state.logs}
                    onBack={closeGoalDetail}
                    {...goalActions}
                  />
                )}

              {!state.detailGoalId &&
                (state.view === "home" ||
                  state.view === "running" ||
                  state.view === "review") && (
                  <SplitWorkspace
                    className="main-view home-view"
                    left={
                      <div
                        className={`home-view-tasks hyper-window-slot${state.selectedId ? " focus-tasks" : ""}`}
                      >
                        <TasksPanel
                          goals={filteredGoals}
                          allGoals={state.goals}
                          filter={state.statusFilter}
                          onFilterChange={(filter) =>
                            dispatch({ type: "set_status_filter", filter })
                          }
                          selectedId={state.selectedId}
                          onSelect={(id) => dispatch({ type: "set_selected", id })}
                          onOpenDetail={openGoalDetail}
                          onNewGoal={() =>
                            dispatch({ type: "set_show_new_goal", show: true })
                          }
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
                          {...goalActions}
                        />
                      </div>
                    }
                    right={
                      <div
                        className={`home-view-side hyper-window-slot${state.view === "home" ? " focus-assistant" : ""}`}
                      >
                        {state.view === "home" ? (
                          <ChatPanel
                            goals={state.goals}
                            selectedGoal={selected}
                            autoExecute={settings.autoExecute}
                            executors={state.executors}
                            defaultExecutorId={settings.defaultExecutorId}
                            onRefreshed={refreshGoals}
                            coachReplyEvent={state.coachReplyEvent}
                          />
                        ) : (
                          <TaskDetailPanel
                            goal={selected}
                            editMode={state.tasksEditMode}
                            selectedGoals={tasksSelectedGoals}
                            logs={state.logs}
                            onOpenDetail={openGoalDetail}
                            {...goalActions}
                          />
                        )}
                      </div>
                    }
                  />
                )}

              {state.view === "assistant" && (
                <div className="main-view single-view">
                  <ChatPanel
                    goals={state.goals}
                    selectedGoal={selected}
                    autoExecute={settings.autoExecute}
                    executors={state.executors}
                    defaultExecutorId={settings.defaultExecutorId}
                    onRefreshed={refreshGoals}
                    coachReplyEvent={state.coachReplyEvent}
                  />
                </div>
              )}

              {state.view === "settings" && (
                <div className="main-view single-view settings-page">
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
                      settings={settings}
                      workspaceResolved={settings.workspaceResolved}
                      executors={state.executors}
                      onRefreshExecutors={refreshExecutors}
                      onWorkspaceSave={saveWorkspace}
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
                        await refreshExecutors();
                        const status = await api.getModelStatus().catch(() => null);
                        dispatch({
                          type: "set_coach_runtime",
                          runtime: status?.coach ?? null,
                        });
                      }}
                    />
                  ) : (
                    <ToolsPanel
                      settings={settings}
                      executors={state.executors}
                      onChange={(s) => dispatch({ type: "set_settings", settings: s })}
                      onRefreshExecutors={refreshExecutors}
                      onIntegrationGoalCreated={(goal) => {
                        dispatch({ type: "set_selected", id: goal.id });
                        dispatch({ type: "set_view", view: "running" });
                        void refreshGoals();
                        dispatch({
                          type: "push_broadcast",
                          message: `已创建 CLI 接入任务：${goal.title}`,
                        });
                      }}
                      onSave={async (s) => {
                        const saved = await api.putSettings(s);
                        dispatch({ type: "set_settings", settings: saved });
                        await refreshExecutors();
                      }}
                    />
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

      {state.showNewGoal && settings && (
        <NewGoalModal
          autoExecute={settings.autoExecute}
          executors={state.executors}
          defaultExecutorId={settings.defaultExecutorId}
          onClose={() => dispatch({ type: "set_show_new_goal", show: false })}
          onCreated={(g) => {
            dispatch({ type: "set_selected", id: g.id });
            dispatch({ type: "set_show_new_goal", show: false });
            dispatch({ type: "set_view", view: "running" });
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
