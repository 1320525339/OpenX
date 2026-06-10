import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import type {
  BatchGoalsAction,
  Goal,
  GoalRunState,
  RefinedGoal,
  SseEvent,
} from "@openx/shared";
import {
  api,
  connectEvents,
  type ExecutorInfo,
  type ModelRuntime,
  type SettingsResponse,
} from "../api";
import { handleRunEnded, handleRunEvent, handleRunStarted } from "./run-state";
import type { AppView } from "../components/SideNav";
import type { ExecutorScope } from "../components/TopBar";

export type LogEntry = {
  goalId: string;
  level: string;
  message: string;
  timestamp: string;
};

export type SseStatus = "connected" | "reconnecting" | "disconnected";

export type CoachReplyEvent = {
  message: string;
  timestamp: string;
  refined?: RefinedGoal;
  meta?: { llmError?: string; quotaExceeded?: boolean };
};

type AppState = {
  view: AppView;
  goals: Goal[];
  selectedId: string | null;
  settings: SettingsResponse | null;
  executors: ExecutorInfo[];
  coachRuntime: ModelRuntime | null;
  broadcastHistory: string[];
  sseStatus: SseStatus;
  logs: LogEntry[];
  runs: Record<string, GoalRunState>;
  showNewGoal: boolean;
  statusFilter: string;
  executorScope: ExecutorScope;
  tasksEditMode: boolean;
  tasksSelectedIds: Set<string>;
  logStripExpanded: boolean;
  settingsTab: "general" | "tools";
  loadError: string | null;
  coachReplyEvent: CoachReplyEvent | null;
};

type Action =
  | { type: "set_view"; view: AppView }
  | { type: "set_goals"; goals: Goal[] }
  | { type: "patch_goal"; goal: Goal }
  | { type: "remove_goal"; goalId: string }
  | { type: "set_selected"; id: string | null }
  | { type: "set_settings"; settings: SettingsResponse }
  | { type: "set_executors"; executors: ExecutorInfo[] }
  | { type: "set_coach_runtime"; runtime: ModelRuntime | null }
  | { type: "push_broadcast"; message: string }
  | { type: "set_sse_status"; status: SseStatus }
  | { type: "append_log"; log: LogEntry }
  | { type: "set_runs"; updater: (prev: Record<string, GoalRunState>) => Record<string, GoalRunState> }
  | { type: "set_show_new_goal"; show: boolean }
  | { type: "set_status_filter"; filter: string }
  | { type: "set_executor_scope"; scope: ExecutorScope }
  | { type: "set_tasks_edit_mode"; edit: boolean }
  | { type: "toggle_task_select"; id: string }
  | { type: "set_tasks_selected"; ids: Set<string> }
  | { type: "clear_tasks_selection" }
  | { type: "toggle_log_strip" }
  | { type: "set_settings_tab"; tab: "general" | "tools" }
  | { type: "set_load_error"; error: string | null }
  | { type: "coach_reply"; event: CoachReplyEvent };

const INITIAL_BROADCAST = "欢迎使用 OpenX — 说出目标，我会帮你整理、推进和提醒确认。";

const initialState: AppState = {
  view: "home",
  goals: [],
  selectedId: null,
  settings: null,
  executors: [],
  coachRuntime: null,
  broadcastHistory: [INITIAL_BROADCAST],
  sseStatus: "reconnecting",
  logs: [],
  runs: {},
  showNewGoal: false,
  statusFilter: "all",
  executorScope: "all",
  tasksEditMode: false,
  tasksSelectedIds: new Set(),
  logStripExpanded: false,
  settingsTab: "general",
  loadError: null,
  coachReplyEvent: null,
};

function viewDefaultFilter(view: AppView): string {
  if (view === "running") return "running";
  if (view === "review") return "awaiting_review";
  return "all";
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "set_view":
      return {
        ...state,
        view: action.view,
        statusFilter: viewDefaultFilter(action.view),
        tasksEditMode: false,
        tasksSelectedIds: new Set(),
      };
    case "set_goals":
      return { ...state, goals: action.goals, loadError: null };
    case "patch_goal": {
      const idx = state.goals.findIndex((g) => g.id === action.goal.id);
      const goals =
        idx >= 0
          ? state.goals.map((g, i) => (i === idx ? action.goal : g))
          : [action.goal, ...state.goals];
      return { ...state, goals };
    }
    case "remove_goal": {
      const tasksSelectedIds = new Set(state.tasksSelectedIds);
      tasksSelectedIds.delete(action.goalId);
      return {
        ...state,
        goals: state.goals.filter((g) => g.id !== action.goalId),
        selectedId: state.selectedId === action.goalId ? null : state.selectedId,
        tasksSelectedIds,
      };
    }
    case "set_selected":
      return { ...state, selectedId: action.id };
    case "set_settings":
      return { ...state, settings: action.settings };
    case "set_executors":
      return { ...state, executors: action.executors };
    case "set_coach_runtime":
      return { ...state, coachRuntime: action.runtime };
    case "push_broadcast":
      return {
        ...state,
        broadcastHistory: [...state.broadcastHistory.slice(-4), action.message],
      };
    case "set_sse_status":
      return { ...state, sseStatus: action.status };
    case "append_log":
      return { ...state, logs: [...state.logs.slice(-499), action.log] };
    case "set_runs":
      return { ...state, runs: action.updater(state.runs) };
    case "set_show_new_goal":
      return { ...state, showNewGoal: action.show };
    case "set_status_filter":
      return { ...state, statusFilter: action.filter };
    case "set_executor_scope":
      return { ...state, executorScope: action.scope };
    case "set_tasks_edit_mode":
      return {
        ...state,
        tasksEditMode: action.edit,
        tasksSelectedIds: action.edit ? state.tasksSelectedIds : new Set(),
      };
    case "toggle_task_select": {
      const next = new Set(state.tasksSelectedIds);
      if (next.has(action.id)) next.delete(action.id);
      else next.add(action.id);
      return { ...state, tasksSelectedIds: next };
    }
    case "set_tasks_selected":
      return { ...state, tasksSelectedIds: action.ids };
    case "clear_tasks_selection":
      return { ...state, tasksSelectedIds: new Set() };
    case "toggle_log_strip":
      return { ...state, logStripExpanded: !state.logStripExpanded };
    case "set_settings_tab":
      return { ...state, settingsTab: action.tab };
    case "set_load_error":
      return { ...state, loadError: action.error };
    case "coach_reply":
      return { ...state, coachReplyEvent: action.event };
    default:
      return state;
  }
}

type AppContextValue = {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  refreshGoals: () => Promise<void>;
  refreshMeta: () => Promise<void>;
  refreshExecutors: () => Promise<void>;
  saveWorkspace: (path: string) => Promise<void>;
  goalActions: {
    onApprove: (id: string) => Promise<void>;
    onRework: (id: string, reason?: string) => Promise<void>;
    onStart: (id: string) => Promise<void>;
    onCancel: (id: string) => Promise<void>;
  };
  handleTasksBatchAction: (action: BatchGoalsAction, ids: string[]) => Promise<void>;
  filteredGoals: Goal[];
  selected: Goal | undefined;
  runningCount: number;
  reviewCount: number;
  tasksSelectedGoals: Goal[];
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const refreshGoals = useCallback(async () => {
    try {
      const { goals } = await api.getGoals();
      dispatch({ type: "set_goals", goals });
    } catch (err) {
      dispatch({
        type: "set_load_error",
        error: err instanceof Error ? err.message : "加载目标失败",
      });
    }
  }, []);

  const refreshExecutors = useCallback(async () => {
    const { executors } = await api.getExecutors();
    dispatch({ type: "set_executors", executors });
  }, []);

  const refreshMeta = useCallback(async () => {
    try {
      const [settings, executorsRes, modelStatus] = await Promise.all([
        api.getSettings(),
        api.getExecutors(),
        api.getModelStatus().catch(() => null),
      ]);
      dispatch({ type: "set_settings", settings });
      dispatch({ type: "set_executors", executors: executorsRes.executors });
      dispatch({ type: "set_coach_runtime", runtime: modelStatus?.coach ?? null });
      dispatch({ type: "set_load_error", error: null });
    } catch (err) {
      dispatch({
        type: "set_load_error",
        error: err instanceof Error ? err.message : "加载配置失败",
      });
    }
  }, []);

  useEffect(() => {
    void refreshGoals();
    void refreshMeta();
  }, [refreshGoals, refreshMeta]);

  useEffect(() => {
    return connectEvents({
      onEvent: (event: SseEvent) => {
        if (event.type === "goal.deleted") {
          dispatch({ type: "remove_goal", goalId: event.goalId });
        }
        if (event.type === "goal.updated") {
          dispatch({ type: "patch_goal", goal: event.goal });
          if (event.goal.status !== "running") {
            dispatch({
              type: "set_runs",
              updater: (prev) => {
                const current = prev[event.goal.id];
                if (!current?.active) return prev;
                return handleRunEnded(prev, {
                  goalId: event.goal.id,
                  status:
                    event.goal.status === "failed"
                      ? "failed"
                      : event.goal.status === "cancelled"
                        ? "cancelled"
                        : "completed",
                  timestamp: new Date().toISOString(),
                });
              },
            });
          }
        }
        if (event.type === "run.started") {
          dispatch({ type: "set_runs", updater: (prev) => handleRunStarted(prev, event) });
        }
        if (event.type === "run.event") {
          dispatch({ type: "set_runs", updater: (prev) => handleRunEvent(prev, event) });
        }
        if (event.type === "run.ended") {
          dispatch({ type: "set_runs", updater: (prev) => handleRunEnded(prev, event) });
        }
        if (event.type === "log.append") {
          dispatch({ type: "append_log", log: event });
        }
        if (event.type === "narration.append") {
          dispatch({ type: "push_broadcast", message: event.message });
        }
        if (event.type === "coach.reply") {
          dispatch({
            type: "coach_reply",
            event: {
              message: event.message,
              timestamp: event.timestamp,
              refined: event.refined,
              meta: event.meta,
            },
          });
        }
      },
      onGap: () => {
        void refreshGoals();
      },
      onOpen: () => dispatch({ type: "set_sse_status", status: "connected" }),
      onError: () => dispatch({ type: "set_sse_status", status: "reconnecting" }),
    });
  }, [refreshGoals]);

  const saveWorkspace = useCallback(
    async (path: string) => {
      if (!state.settings) return;
      const saved = await api.putSettings({ ...state.settings, workspaceRoot: path });
      dispatch({ type: "set_settings", settings: saved });
    },
    [state.settings],
  );

  const goalActions = useMemo(
    () => ({
      onApprove: async (id: string) => {
        try {
          await api.approveGoal(id);
        } catch (err) {
          dispatch({
            type: "push_broadcast",
            message: `确认失败：${err instanceof Error ? err.message : String(err)}`,
          });
        }
      },
      onRework: async (id: string, reason?: string) => {
        try {
          await api.reworkGoal(id, reason);
        } catch (err) {
          dispatch({
            type: "push_broadcast",
            message: `返工失败：${err instanceof Error ? err.message : String(err)}`,
          });
        }
      },
      onStart: async (id: string) => {
        try {
          await api.startGoal(id);
        } catch (err) {
          dispatch({
            type: "push_broadcast",
            message: `启动失败：${err instanceof Error ? err.message : String(err)}`,
          });
        }
      },
      onCancel: async (id: string) => {
        try {
          await api.cancelGoal(id);
        } catch (err) {
          dispatch({
            type: "push_broadcast",
            message: `取消失败：${err instanceof Error ? err.message : String(err)}`,
          });
        }
      },
    }),
    [],
  );

  const handleTasksBatchAction = useCallback(
    async (action: BatchGoalsAction, ids: string[]) => {
      try {
        const { ok, failed } = await api.batchGoals(action, ids);
        if (action === "delete") {
          for (const id of ok) dispatch({ type: "remove_goal", goalId: id });
          dispatch({ type: "clear_tasks_selection" });
        }
        if (failed.length > 0) {
          const sample = failed
            .slice(0, 3)
            .map((f) => f.error)
            .join("；");
          dispatch({
            type: "push_broadcast",
            message: `批量操作：成功 ${ok.length}，失败 ${failed.length}${sample ? `（${sample}）` : ""}`,
          });
        } else if (ok.length > 0) {
          const labels: Record<BatchGoalsAction, string> = {
            start: "已开始推进",
            cancel: "已取消",
            approve: "已确认完成",
            delete: "已删除",
          };
          dispatch({ type: "push_broadcast", message: `${labels[action]} ${ok.length} 个目标` });
        }
      } catch (err) {
        dispatch({
          type: "push_broadcast",
          message: `批量操作失败：${err instanceof Error ? err.message : String(err)}`,
        });
      }
    },
    [],
  );

  const scopedGoals = useMemo(() => {
    if (state.executorScope === "all") return state.goals;
    return state.goals.filter((g) => g.executorId === state.executorScope);
  }, [state.goals, state.executorScope]);

  const filteredGoals = useMemo(() => {
    const { statusFilter } = state;
    if (statusFilter === "all") return scopedGoals;
    if (statusFilter === "rework") {
      return scopedGoals.filter((g) => g.effectStatus === "rework");
    }
    return scopedGoals.filter((g) => g.status === statusFilter);
  }, [scopedGoals, state.statusFilter]);

  const selected = state.goals.find((g) => g.id === state.selectedId);
  const runningCount = state.goals.filter((g) => g.status === "running").length;
  const reviewCount = state.goals.filter((g) => g.status === "awaiting_review").length;
  const tasksSelectedGoals = useMemo(
    () => state.goals.filter((g) => state.tasksSelectedIds.has(g.id)),
    [state.goals, state.tasksSelectedIds],
  );

  const value: AppContextValue = {
    state,
    dispatch,
    refreshGoals,
    refreshMeta,
    refreshExecutors,
    saveWorkspace,
    goalActions,
    handleTasksBatchAction,
    filteredGoals,
    selected,
    runningCount,
    reviewCount,
    tasksSelectedGoals,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppState() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppState must be used within AppProvider");
  return ctx;
}
