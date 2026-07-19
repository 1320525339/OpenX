import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import type {
  BatchGoalsAction,
  CoachIntent,
  CoachMessageRecord,
  Conversation,
  DynamicIslandPayload,
  Goal,
  GoalRunState,
  Project,
  RefinedGoal,
  SseEvent,
} from "@openx/shared";
import {
  goalMatchesDisplayFilter,
  SYSTEM_MAIN_CONVERSATION_ID,
  SYSTEM_PROJECT_ID,
  projectGoalVaultConversationId,
} from "@openx/shared";
import type { RoundReplyStreamState } from "./round-streams";
import {
  applyChatReplyCompleted,
  applyChatReplyDelta,
  applyChatReplyFailed,
  applyChatReplyStarted,
  clearRoundStreamsForConversation,
} from "./round-streams";
import {
  api,
  connectEvents,
  type ExecutorInfo,
  type ModelRuntime,
  type SettingsResponse,
} from "../api";
import {
  handleRunEnded,
  handleRunEvent,
  handleRunStarted,
  hydrateRunState,
  reconcileRunState,
} from "./run-state";
import { islandFromBroadcast, islandFromGoalChange } from "./island-payload";
import {
  bindIslandQueueHandlers,
  clearIslandSeenDedupe,
  hydrateIslandSeenFromServer,
  isIslandCatchupMode,
  requestIsland,
  setIslandCatchupMode,
  syncAttentionsFromServer,
} from "./island-queue";
import { goalNeedsUserAttention } from "./goal-attention";
import { runTaskAction } from "./task-action";
import type { AppView } from "../components/SideNav";

export type ExecutorScope = "all" | string;

export type LogEntry = {
  goalId: string;
  level: string;
  message: string;
  timestamp: string;
};

export type SseStatus = "connected" | "reconnecting" | "disconnected";

export type CoachReplyEvent = {
  conversationId: string;
  message: string;
  timestamp: string;
  intent?: CoachIntent;
  refined?: RefinedGoal;
  clarify?: import("@openx/shared").CoachClarifyPayload;
  suggestRefine?: boolean;
  meta?: { llmError?: string; quotaExceeded?: boolean };
};

export type CoachStreamState = {
  conversationId: string;
  streamId: string;
  text: string;
};

export type { RoundReplyStreamState };

type AppState = {
  view: AppView;
  projects: Project[];
  conversations: Conversation[];
  selectedProjectId: string | null;
  selectedConversationId: string | null;
  expandedProjectIds: Set<string>;
  goals: Goal[];
  selectedId: string | null;
  settings: SettingsResponse | null;
  executors: ExecutorInfo[];
  coachRuntime: ModelRuntime | null;
  islandPayload: DynamicIslandPayload | null;
  /** 当前灵动岛展示令牌，与 island-queue displayToken 对齐 */
  islandDisplayToken: number | null;
  /** 服务端 open attention 数量（徽章） */
  openAttentionCount: number;
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
  coachStream: CoachStreamState | null;
  coachMessageEvent: CoachMessageRecord | null;
  /** 圆桌多路流：key = messageId */
  roundStreams: Record<number, RoundReplyStreamState>;
  detailGoalId: string | null;
};

type Action =
  | { type: "set_view"; view: AppView; statusFilter?: string }
  | { type: "set_workspace_tree"; projects: Project[]; conversations: Conversation[] }
  | { type: "open_console"; projectId: string; conversationId: string }
  | { type: "open_project"; projectId: string }
  | { type: "open_conversation"; projectId: string; conversationId: string; goalId?: string }
  | { type: "toggle_project_expanded"; projectId: string }
  | { type: "upsert_project"; project: Project }
  | { type: "upsert_conversation"; conversation: Conversation }
  | { type: "remove_project"; projectId: string }
  | { type: "remove_conversation"; conversationId: string }
  | { type: "clear_conversation_thread"; conversationId: string }
  | { type: "set_goals"; goals: Goal[] }
  | { type: "patch_goal"; goal: Goal }
  | { type: "remove_goal"; goalId: string }
  | { type: "set_selected"; id: string | null }
  | { type: "set_settings"; settings: SettingsResponse }
  | { type: "set_executors"; executors: ExecutorInfo[] }
  | { type: "set_coach_runtime"; runtime: ModelRuntime | null }
  | { type: "show_island"; payload: DynamicIslandPayload; token: number }
  | { type: "dismiss_island" }
  | { type: "set_open_attention_count"; count: number }
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
  | { type: "coach_reply"; event: CoachReplyEvent }
  | {
      type: "coach_delta";
      event: {
        conversationId: string;
        streamId: string;
        delta: string;
        timestamp: string;
      };
    }
  | {
      type: "coach_stream_end";
      conversationId: string;
      streamId: string;
    }
  | { type: "coach_message"; message: CoachMessageRecord }
  | {
      type: "chat_reply_started";
      event: {
        conversationId: string;
        roundId: string;
        messageId: number;
        speakerId: string;
        streamId: string;
      };
    }
  | {
      type: "chat_reply_delta";
      event: {
        conversationId: string;
        roundId: string;
        messageId: number;
        speakerId: string;
        streamId: string;
        delta: string;
      };
    }
  | {
      type: "chat_reply_completed";
      event: {
        conversationId: string;
        messageId: number;
        streamId: string;
        text: string;
      };
    }
  | {
      type: "chat_reply_failed";
      event: {
        conversationId: string;
        messageId: number;
        streamId: string;
        error: string;
      };
    }
  | { type: "clear_round_streams"; conversationId?: string }
  | { type: "open_goal_detail"; id: string }
  | { type: "close_goal_detail" }
  | { type: "trim_runtime_cache" };

const MAX_HYDRATED_RUN_IDS = 120;
const MAX_RETAINED_RUNS = 48;

function trimHydratedRunIds(set: Set<string>) {
  while (set.size > MAX_HYDRATED_RUN_IDS) {
    const first = set.values().next().value;
    if (!first) break;
    set.delete(first);
  }
}

const LAST_CONV_KEY = "openx.lastConversationId";

function notifyIsland(
  message: string,
  opts?: { goalId?: string; severity?: DynamicIslandPayload["severity"] },
) {
  requestIsland(islandFromBroadcast(message, opts));
}

const initialState: AppState = {
  view: "console",
  projects: [],
  conversations: [],
  selectedProjectId: SYSTEM_PROJECT_ID,
  selectedConversationId: SYSTEM_MAIN_CONVERSATION_ID,
  expandedProjectIds: new Set(),
  goals: [],
  selectedId: null,
  settings: null,
  executors: [],
  coachRuntime: null,
  islandPayload: null,
  islandDisplayToken: null,
  openAttentionCount: 0,
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
  coachStream: null,
  coachMessageEvent: null,
  roundStreams: {},
  detailGoalId: null,
};

function viewDefaultFilter(_view: AppView): string {
  return "all";
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "set_view":
      return {
        ...state,
        view: action.view,
        statusFilter: action.statusFilter ?? viewDefaultFilter(action.view),
        tasksEditMode: false,
        tasksSelectedIds: new Set(),
        detailGoalId: null,
        ...(action.view === "home"
          ? { selectedProjectId: null, selectedConversationId: null }
          : {}),
      };
    case "set_workspace_tree":
      return {
        ...state,
        projects: action.projects,
        conversations: action.conversations,
      };
    case "open_console": {
      try {
        localStorage.setItem(LAST_CONV_KEY, action.conversationId);
      } catch {
        /* ignore */
      }
      return {
        ...state,
        view: "console",
        selectedProjectId: action.projectId,
        selectedConversationId: action.conversationId,
        statusFilter: "running",
        detailGoalId: null,
        tasksEditMode: false,
        tasksSelectedIds: new Set(),
      };
    }
    case "open_project": {
      const expanded = new Set(state.expandedProjectIds);
      expanded.add(action.projectId);
      return {
        ...state,
        view: "project",
        selectedProjectId: action.projectId,
        selectedConversationId: null,
        detailGoalId: null,
        expandedProjectIds: expanded,
      };
    }
    case "open_conversation": {
      const expanded = new Set(state.expandedProjectIds);
      expanded.add(action.projectId);
      try {
        localStorage.setItem(LAST_CONV_KEY, action.conversationId);
      } catch {
        /* ignore */
      }
      return {
        ...state,
        view: "conversation",
        selectedProjectId: action.projectId,
        selectedConversationId: action.conversationId,
        selectedId: action.goalId ?? state.selectedId,
        detailGoalId: null,
        expandedProjectIds: expanded,
      };
    }
    case "toggle_project_expanded": {
      const next = new Set(state.expandedProjectIds);
      if (next.has(action.projectId)) next.delete(action.projectId);
      else next.add(action.projectId);
      return { ...state, expandedProjectIds: next };
    }
    case "upsert_project": {
      const idx = state.projects.findIndex((p) => p.id === action.project.id);
      const projects =
        idx >= 0
          ? state.projects.map((p, i) => (i === idx ? action.project : p))
          : [...state.projects, action.project];
      const expanded = new Set(state.expandedProjectIds);
      expanded.add(action.project.id);
      return { ...state, projects, expandedProjectIds: expanded };
    }
    case "upsert_conversation": {
      const idx = state.conversations.findIndex((c) => c.id === action.conversation.id);
      const conversations =
        idx >= 0
          ? state.conversations.map((c, i) => (i === idx ? action.conversation : c))
          : [action.conversation, ...state.conversations];
      return { ...state, conversations };
    }
    case "remove_project": {
      const convIds = new Set(
        state.conversations.filter((c) => c.projectId === action.projectId).map((c) => c.id),
      );
      const removedGoalIds = new Set(
        state.goals.filter((g) => convIds.has(g.conversationId)).map((g) => g.id),
      );
      const expanded = new Set(state.expandedProjectIds);
      expanded.delete(action.projectId);
      const tasksSelectedIds = new Set(
        [...state.tasksSelectedIds].filter((id) => !removedGoalIds.has(id)),
      );
      return {
        ...state,
        projects: state.projects.filter((p) => p.id !== action.projectId),
        conversations: state.conversations.filter((c) => c.projectId !== action.projectId),
        goals: state.goals.filter((g) => !convIds.has(g.conversationId)),
        expandedProjectIds: expanded,
        tasksSelectedIds,
        selectedId: removedGoalIds.has(state.selectedId ?? "") ? null : state.selectedId,
        detailGoalId: removedGoalIds.has(state.detailGoalId ?? "")
          ? null
          : state.detailGoalId,
        selectedProjectId:
          state.selectedProjectId === action.projectId ? null : state.selectedProjectId,
        selectedConversationId: convIds.has(state.selectedConversationId ?? "")
          ? null
          : state.selectedConversationId,
        view:
          state.selectedProjectId === action.projectId ||
          convIds.has(state.selectedConversationId ?? "")
            ? "home"
            : state.view,
      };
    }
    case "remove_conversation": {
      return {
        ...state,
        conversations: state.conversations.filter((c) => c.id !== action.conversationId),
        // goals 保留：服务端已迁入任务保管箱，随后 refreshGoals 会更新 conversationId
        roundStreams: clearRoundStreamsForConversation(
          state.roundStreams,
          action.conversationId,
        ),
        selectedConversationId:
          state.selectedConversationId === action.conversationId
            ? null
            : state.selectedConversationId,
        view:
          state.selectedConversationId === action.conversationId ? "home" : state.view,
      };
    }
    case "clear_conversation_thread": {
      const clearedAt = new Date().toISOString();
      return {
        ...state,
        roundStreams: clearRoundStreamsForConversation(
          state.roundStreams,
          action.conversationId,
        ),
        coachStream:
          state.coachStream?.conversationId === action.conversationId
            ? null
            : state.coachStream,
        coachMessageEvent: {
          id: -Math.floor(Date.now() % 1_000_000_000),
          conversationId: action.conversationId,
          role: "coach",
          text: "",
          kind: "text",
          timestamp: clearedAt,
          speakerType: "foreman",
          speakerId: "system",
          generationStatus: "completed",
        },
      };
    }
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
        detailGoalId: state.detailGoalId === action.goalId ? null : state.detailGoalId,
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
    case "show_island":
      return {
        ...state,
        islandPayload: action.payload,
        islandDisplayToken: action.token,
      };
    case "dismiss_island":
      return { ...state, islandPayload: null, islandDisplayToken: null };
    case "set_open_attention_count":
      return { ...state, openAttentionCount: action.count };
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
    case "coach_delta": {
      const { conversationId, streamId, delta } = action.event;
      const prev = state.coachStream;
      if (
        prev &&
        prev.conversationId === conversationId &&
        prev.streamId === streamId
      ) {
        return {
          ...state,
          coachStream: { ...prev, text: prev.text + delta },
        };
      }
      return {
        ...state,
        coachStream: { conversationId, streamId, text: delta },
      };
    }
    case "coach_stream_end": {
      const stream = state.coachStream;
      if (
        stream &&
        stream.conversationId === action.conversationId &&
        stream.streamId === action.streamId
      ) {
        return { ...state, coachStream: null };
      }
      return state;
    }
    case "coach_message":
      return { ...state, coachMessageEvent: action.message };
    case "chat_reply_started":
      return {
        ...state,
        roundStreams: applyChatReplyStarted(state.roundStreams, action.event),
      };
    case "chat_reply_delta":
      return {
        ...state,
        roundStreams: applyChatReplyDelta(state.roundStreams, action.event),
      };
    case "chat_reply_completed":
      return {
        ...state,
        roundStreams: applyChatReplyCompleted(state.roundStreams, action.event),
      };
    case "chat_reply_failed":
      return {
        ...state,
        roundStreams: applyChatReplyFailed(state.roundStreams, action.event),
      };
    case "clear_round_streams":
      return {
        ...state,
        roundStreams: clearRoundStreamsForConversation(
          state.roundStreams,
          action.conversationId,
        ),
      };
    case "coach_reply":
      return {
        ...state,
        coachReplyEvent: action.event,
      };
    case "open_goal_detail":
      return { ...state, detailGoalId: action.id, selectedId: action.id };
    case "close_goal_detail":
      return { ...state, detailGoalId: null };
    case "trim_runtime_cache": {
      const keepRunIds = new Set<string>();
      if (state.selectedId) keepRunIds.add(state.selectedId);
      if (state.detailGoalId) keepRunIds.add(state.detailGoalId);
      for (const goal of state.goals) {
        if (goal.status === "running") keepRunIds.add(goal.id);
        if (keepRunIds.size >= MAX_RETAINED_RUNS) break;
      }
      const runs: Record<string, GoalRunState> = {};
      for (const id of keepRunIds) {
        const run = state.runs[id];
        if (run) runs[id] = run;
      }
      return {
        ...state,
        runs,
        logs: state.logs.slice(-300),
        coachStream: state.view === "conversation" ? state.coachStream : null,
        coachReplyEvent: state.view === "conversation" ? state.coachReplyEvent : null,
      };
    }
    default:
      return state;
  }
}

type AppContextValue = {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  refreshGoals: () => Promise<void>;
  /** 创建/本地补丁后立即写入；并作废飞行中的 refreshGoals */
  upsertGoals: (goals: Goal[]) => void;
  refreshProjects: () => Promise<void>;
  refreshMeta: () => Promise<void>;
  refreshExecutors: () => Promise<void>;
  createProject: (workspaceDir: string) => Promise<Project | null>;
  createConversation: (
    projectId: string,
    opts?: { mode?: "foreman" | "roundtable"; title?: string },
  ) => Promise<Conversation | null>;
  enableRoundtable: (
    conversationId: string,
    body?: {
      participantProfileIds?: string[];
      participantSeats?: import("@openx/shared").RoundtableSeatInput[];
    },
  ) => Promise<{
    conversation: Conversation;
    participants: import("@openx/shared").ConversationParticipant[];
  } | null>;
  deleteProject: (projectId: string) => Promise<boolean>;
  deleteConversation: (conversationId: string) => Promise<boolean>;
  clearConversationThread: (conversationId: string) => Promise<boolean>;
  forgetProjectConversations: (projectId: string) => Promise<boolean>;
  saveWorkspace: (path: string) => Promise<void>;
  saveSystemWorkspace: (path: string) => Promise<void>;
  goalActions: {
    onApprove: (id: string) => Promise<boolean>;
    onRework: (id: string, reason?: string) => Promise<boolean>;
    onStart: (id: string) => Promise<boolean>;
    onCancel: (id: string) => Promise<boolean>;
  };
  handleTasksBatchAction: (action: BatchGoalsAction, ids: string[]) => Promise<void>;
  filteredGoals: Goal[];
  conversationGoals: Goal[];
  projectGoals: Goal[];
  projectFilteredGoals: Goal[];
  selected: Goal | undefined;
  selectedProject: Project | undefined;
  selectedConversation: Conversation | undefined;
  inboxBadgeCount: number;
  consoleBadgeCount: number;
  tasksSelectedGoals: Goal[];
};

const AppContext = createContext<AppContextValue | null>(null);

function collectRunReconcileGoalIds(
  runs: Record<string, GoalRunState>,
  goals: Goal[],
  conversationId: string | null,
): string[] {
  const ids = new Set<string>();
  for (const [goalId, run] of Object.entries(runs)) {
    if (run.active) ids.add(goalId);
  }
  for (const goal of goals) {
    if (goal.status !== "running" && goal.status !== "awaiting_review") continue;
    if (conversationId && goal.conversationId !== conversationId) continue;
    ids.add(goal.id);
  }
  return [...ids];
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  /** SSE 处理时同步维护，避免 stateRef 滞后导致重复弹窗 */
  const goalsSnapshotRef = useRef(new Map<string, Goal>());
  const hydratedRunIdsRef = useRef(new Set<string>());
  const restoredConvRef = useRef(false);
  /** 全量 refresh 代次；upsertGoals 时递增以丢弃飞行中的旧列表 */
  const refreshGoalsGenRef = useRef(0);
  /** SSE 持续 reconnecting 超时后升为 disconnected */
  const sseDisconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const SSE_DISCONNECT_AFTER_MS = 20_000;

  const refreshGoals = useCallback(async () => {
    const gen = ++refreshGoalsGenRef.current;
    try {
      const { goals } = await api.getGoals();
      if (gen !== refreshGoalsGenRef.current) return;
      for (const goal of goals) {
        goalsSnapshotRef.current.set(goal.id, goal);
      }
      dispatch({ type: "set_goals", goals });
    } catch (err) {
      if (gen !== refreshGoalsGenRef.current) return;
      dispatch({
        type: "set_load_error",
        error: err instanceof Error ? err.message : "加载目标失败",
      });
    }
  }, []);

  const upsertGoals = useCallback((goals: Goal[]) => {
    if (goals.length === 0) return;
    for (const goal of goals) {
      goalsSnapshotRef.current.set(goal.id, goal);
      dispatch({ type: "patch_goal", goal });
    }
    // 作废在 upsert 之前起飞的全量列表请求，避免覆盖刚写入的任务
    refreshGoalsGenRef.current += 1;
  }, []);

  const refreshExecutors = useCallback(async () => {
    const { executors } = await api.getExecutors();
    dispatch({ type: "set_executors", executors });
  }, []);

  const reconcileActiveRuns = useCallback(async () => {
    const snapshot = stateRef.current;
    const goalIds = collectRunReconcileGoalIds(
      snapshot.runs,
      snapshot.goals,
      snapshot.selectedConversationId,
    );
    if (goalIds.length === 0) return;

    await Promise.all(
      goalIds.map(async (goalId) => {
        try {
          const { run } = await api.getGoalRun(goalId);
          if (!run) return;
          dispatch({
            type: "set_runs",
            updater: (prev) => ({
              ...prev,
              [goalId]: reconcileRunState(prev[goalId], run),
            }),
          });
        } catch {
          /* ignore reconcile errors */
        }
      }),
    );
  }, []);

  const refreshMeta = useCallback(async () => {
    try {
      const settings = await api.getSettings();
      dispatch({ type: "set_settings", settings });
      dispatch({ type: "set_load_error", error: null });

      void api
        .getExecutors()
        .then((executorsRes) => {
          dispatch({ type: "set_executors", executors: executorsRes.executors });
        })
        .catch(() => {
          /* 执行器探测可后台重试 */
        });

      void api
        .getModelStatus()
        .then((modelStatus) => {
          dispatch({ type: "set_coach_runtime", runtime: modelStatus?.coach ?? null });
        })
        .catch(() => {
          /* ignore */
        });
    } catch (err) {
      dispatch({
        type: "set_load_error",
        error: err instanceof Error ? err.message : "加载配置失败",
      });
    }
  }, []);

  const refreshBootstrap = useCallback(async () => {
    try {
      const boot = await api.getBootstrap();
      dispatch({ type: "set_settings", settings: boot.settings });
      dispatch({
        type: "set_workspace_tree",
        projects: boot.projects,
        conversations: boot.conversations,
      });
      dispatch({ type: "upsert_project", project: boot.system.project });
      dispatch({ type: "upsert_conversation", conversation: boot.system.conversation });
      dispatch({
        type: "set_coach_runtime",
        runtime: {
          ready: boot.coach.ready,
          slug: boot.coach.slug,
          model: boot.coach.model,
          baseUrl: boot.coach.baseUrl,
          error: boot.coach.error,
        },
      });
      dispatch({ type: "set_load_error", error: null });

      void api
        .getExecutors()
        .then((executorsRes) => {
          dispatch({ type: "set_executors", executors: executorsRes.executors });
        })
        .catch(() => {
          /* 执行器探测可后台重试 */
        });
    } catch (err) {
      // 旧版 server 或无 /api/bootstrap 时降级为拆分 API，避免整页卡在加载失败
      try {
        const settings = await api.getSettings();
        dispatch({ type: "set_settings", settings });
        const projectsRes = await api.getProjects();
        dispatch({
          type: "set_workspace_tree",
          projects: projectsRes.projects,
          conversations: projectsRes.conversations,
        });
        void api
          .getSystemConsole()
          .then((consoleRes) => {
            dispatch({ type: "upsert_project", project: consoleRes.project });
            dispatch({ type: "upsert_conversation", conversation: consoleRes.conversation });
          })
          .catch(() => {
            /* 调度台元数据可稍后刷新 */
          });
        const modelStatus = await api.getModelStatus().catch(() => null);
        dispatch({
          type: "set_coach_runtime",
          runtime: modelStatus?.coach ?? null,
        });
        dispatch({ type: "set_load_error", error: null });

        void api
          .getExecutors()
          .then((executorsRes) => {
            dispatch({ type: "set_executors", executors: executorsRes.executors });
          })
          .catch(() => {
            /* 执行器探测可后台重试 */
          });
      } catch (fallbackErr) {
        dispatch({
          type: "set_load_error",
          error:
            fallbackErr instanceof Error
              ? fallbackErr.message
              : err instanceof Error
                ? err.message
                : "加载启动数据失败",
        });
      }
    }
  }, []);

  const refreshProjects = useCallback(async () => {
    try {
      const projectsRes = await api.getProjects();
      dispatch({
        type: "set_workspace_tree",
        projects: projectsRes.projects,
        conversations: projectsRes.conversations,
      });
      void api.getSystemConsole().then((consoleRes) => {
        dispatch({ type: "upsert_project", project: consoleRes.project });
        dispatch({ type: "upsert_conversation", conversation: consoleRes.conversation });
      }).catch(() => {
        /* 调度台元数据可稍后由 ConsolePage 刷新 */
      });
    } catch (err) {
      dispatch({
        type: "set_load_error",
        error: err instanceof Error ? err.message : "加载项目失败",
      });
    }
  }, []);

  const createProject = useCallback(
    async (workspaceDir: string) => {
      try {
        const { project } = await api.createProject({ workspaceDir });
        dispatch({ type: "upsert_project", project });
        const { conversation } = await api.createConversation(project.id);
        dispatch({ type: "upsert_conversation", conversation });
        dispatch({
          type: "open_conversation",
          projectId: project.id,
          conversationId: conversation.id,
        });
        return project;
      } catch (err) {
        notifyIsland(
          `添加项目失败：${err instanceof Error ? err.message : String(err)}`,
          { severity: "error" },
        );
        return null;
      }
    },
    [],
  );

  const createConversation = useCallback(async (
    projectId: string,
    opts?: { mode?: "foreman" | "roundtable"; title?: string },
  ) => {
    try {
      const { conversation } = await api.createConversation(projectId, opts);
      dispatch({ type: "upsert_conversation", conversation });
      dispatch({
        type: "open_conversation",
        projectId,
        conversationId: conversation.id,
      });
      return conversation;
    } catch (err) {
      notifyIsland(
        `创建对话失败：${err instanceof Error ? err.message : String(err)}`,
        { severity: "error" },
      );
      return null;
    }
  }, []);

  const enableRoundtable = useCallback(
    async (
      conversationId: string,
      body?: {
        participantProfileIds?: string[];
        participantSeats?: import("@openx/shared").RoundtableSeatInput[];
      },
    ) => {
      try {
        const { conversation, participants } = await api.enableRoundtable(
          conversationId,
          body,
        );
        dispatch({ type: "upsert_conversation", conversation });
        return { conversation, participants };
      } catch (err) {
        notifyIsland(
          `启用圆桌失败：${err instanceof Error ? err.message : String(err)}`,
          { severity: "error" },
        );
        return null;
      }
    },
    [],
  );

  const deleteProject = useCallback(async (projectId: string) => {
    try {
      await api.deleteProject(projectId);
      dispatch({ type: "remove_project", projectId });
      return true;
    } catch (err) {
      notifyIsland(
        `删除项目失败：${err instanceof Error ? err.message : String(err)}`,
        { severity: "error" },
      );
      return false;
    }
  }, []);

  const deleteConversation = useCallback(async (conversationId: string) => {
    try {
      await api.deleteConversation(conversationId);
      dispatch({ type: "remove_conversation", conversationId });
      await refreshGoals();
      await refreshBootstrap();
      return true;
    } catch (err) {
      notifyIsland(
        `删除对话失败：${err instanceof Error ? err.message : String(err)}`,
        { severity: "error" },
      );
      return false;
    }
  }, [refreshGoals, refreshBootstrap]);

  const clearConversationThread = useCallback(async (conversationId: string) => {
    try {
      await api.forgetConversation(conversationId, "clear_thread");
      dispatch({ type: "clear_conversation_thread", conversationId });
      return true;
    } catch (err) {
      notifyIsland(
        `清空对话失败：${err instanceof Error ? err.message : String(err)}`,
        { severity: "error" },
      );
      return false;
    }
  }, []);

  const forgetProjectConversations = useCallback(async (projectId: string) => {
    try {
      await api.forgetProjectConversations(projectId);
      await refreshBootstrap();
      await refreshGoals();
      return true;
    } catch (err) {
      notifyIsland(
        `清空项目对话失败：${err instanceof Error ? err.message : String(err)}`,
        { severity: "error" },
      );
      return false;
    }
  }, [refreshBootstrap, refreshGoals]);

  useEffect(() => {
    void refreshGoals();
    void refreshBootstrap();
  }, [refreshGoals, refreshBootstrap]);

  useEffect(() => {
    if (restoredConvRef.current || state.conversations.length === 0) return;
    restoredConvRef.current = true;

    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST_CONV_KEY);
    } catch {
      /* ignore */
    }

    if (last) {
      const conv = state.conversations.find((c) => c.id === last);
      if (conv) {
        if (conv.id === SYSTEM_MAIN_CONVERSATION_ID) {
          dispatch({
            type: "open_console",
            projectId: SYSTEM_PROJECT_ID,
            conversationId: SYSTEM_MAIN_CONVERSATION_ID,
          });
        } else {
          dispatch({
            type: "open_conversation",
            projectId: conv.projectId,
            conversationId: conv.id,
          });
        }
        return;
      }
    }

    dispatch({
      type: "open_console",
      projectId: SYSTEM_PROJECT_ID,
      conversationId: SYSTEM_MAIN_CONVERSATION_ID,
    });
  }, [state.conversations]);

  useEffect(() => {
    bindIslandQueueHandlers({
      show: (payload, token) => dispatch({ type: "show_island", payload, token }),
      update: (payload, token) => dispatch({ type: "show_island", payload, token }),
      dismiss: () => dispatch({ type: "dismiss_island" }),
    });
    setIslandCatchupMode(true);
    void hydrateIslandSeenFromServer();

    const clearSseDisconnectTimer = () => {
      if (sseDisconnectTimerRef.current) {
        clearTimeout(sseDisconnectTimerRef.current);
        sseDisconnectTimerRef.current = null;
      }
    };

    const unsub = connectEvents({
      onCatchupComplete: () => {
        setIslandCatchupMode(false);
        void syncAttentionsFromServer((count) =>
          dispatch({ type: "set_open_attention_count", count }),
        );
      },
      onEvent: (event: SseEvent) => {
        if (event.type === "goal.deleted") {
          goalsSnapshotRef.current.delete(event.goalId);
          dispatch({ type: "remove_goal", goalId: event.goalId });
        }
        if (event.type === "goal.updated") {
          const prev =
            goalsSnapshotRef.current.get(event.goal.id) ??
            stateRef.current.goals.find((g) => g.id === event.goal.id);
          goalsSnapshotRef.current.set(event.goal.id, event.goal);
          dispatch({ type: "patch_goal", goal: event.goal });
          if (
            prev &&
            prev.status === "awaiting_review" &&
            event.goal.status !== "awaiting_review"
          ) {
            clearIslandSeenDedupe(`goal.awaiting_review:${event.goal.id}`);
          }
          if (!isIslandCatchupMode() && prev) {
            const island = islandFromGoalChange(prev, event.goal);
            if (island) requestIsland(island);
          }
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
        if (event.type === "island.push") {
          requestIsland(event.payload);
        }
        if (event.type === "attention.changed") {
          if (event.state === "open") {
            void syncAttentionsFromServer((count) =>
              dispatch({ type: "set_open_attention_count", count }),
            );
          } else {
            dispatch({
              type: "set_open_attention_count",
              count: Math.max(0, stateRef.current.openAttentionCount - 1),
            });
          }
        }
        if (event.type === "log.append") {
          dispatch({ type: "append_log", log: event });
        }
        if (event.type === "coach.delta") {
          dispatch({
            type: "coach_delta",
            event: {
              conversationId: event.conversationId,
              streamId: event.streamId,
              delta: event.delta,
              timestamp: event.timestamp,
            },
          });
        }
        if (event.type === "coach.stream.end") {
          dispatch({
            type: "coach_stream_end",
            conversationId: event.conversationId,
            streamId: event.streamId,
          });
        }
        if (event.type === "coach.message") {
          dispatch({ type: "coach_message", message: event.message });
        }
        if (event.type === "chat.reply.started") {
          dispatch({
            type: "chat_reply_started",
            event: {
              conversationId: event.conversationId,
              roundId: event.roundId,
              messageId: event.messageId,
              speakerId: event.speakerId,
              streamId: event.streamId,
            },
          });
        }
        if (event.type === "chat.reply.delta") {
          dispatch({
            type: "chat_reply_delta",
            event: {
              conversationId: event.conversationId,
              roundId: event.roundId,
              messageId: event.messageId,
              speakerId: event.speakerId,
              streamId: event.streamId,
              delta: event.delta,
            },
          });
        }
        if (event.type === "chat.reply.completed") {
          dispatch({
            type: "chat_reply_completed",
            event: {
              conversationId: event.conversationId,
              messageId: event.messageId,
              streamId: event.streamId,
              text: event.text,
            },
          });
        }
        if (event.type === "chat.reply.failed") {
          dispatch({
            type: "chat_reply_failed",
            event: {
              conversationId: event.conversationId,
              messageId: event.messageId,
              streamId: event.streamId,
              error: event.error,
            },
          });
        }
        if (
          event.type === "chat.peer_request.created" ||
          event.type === "chat.peer_request.resolved"
        ) {
          if (event.message) {
            dispatch({ type: "coach_message", message: event.message });
          }
        }
        if (event.type === "chat.round.cancelled") {
          dispatch({
            type: "clear_round_streams",
            conversationId: event.conversationId,
          });
        }
        if (event.type === "conversation.cleared") {
          dispatch({
            type: "clear_conversation_thread",
            conversationId: event.conversationId,
          });
        }
        if (event.type === "conversation.deleted") {
          dispatch({
            type: "remove_conversation",
            conversationId: event.conversationId,
          });
          // 同步 vault 会话进树，避免多 Tab 下 projectGoals 丢任务
          void refreshBootstrap();
          void refreshGoals();
        }
        if (event.type === "coach.reply") {
          dispatch({
            type: "coach_reply",
            event: {
              conversationId: event.conversationId,
              message: event.message,
              timestamp: event.timestamp,
              intent: event.intent,
              refined: event.refined,
              clarify: event.clarify,
              meta: event.meta,
            },
          });
        }
        if (event.type === "narration.append") {
          /* 旁白仅用于日志条/调度台，不再重复推灵动岛（与 goal.updated 重复） */
        }
        if (event.type === "desktop.layout_changed") {
          window.dispatchEvent(
            new CustomEvent("openx-desktop-changed", { detail: event }),
          );
        }
      },
      onGap: async () => {
        setIslandCatchupMode(true);
        await Promise.all([refreshGoals(), refreshProjects(), reconcileActiveRuns()]);
        await syncAttentionsFromServer((count) =>
          dispatch({ type: "set_open_attention_count", count }),
        );
      },
      onOpen: () => {
        clearSseDisconnectTimer();
        dispatch({ type: "set_sse_status", status: "connected" });
      },
      onError: () => {
        dispatch({ type: "set_sse_status", status: "reconnecting" });
        if (!sseDisconnectTimerRef.current) {
          sseDisconnectTimerRef.current = setTimeout(() => {
            sseDisconnectTimerRef.current = null;
            dispatch({ type: "set_sse_status", status: "disconnected" });
          }, SSE_DISCONNECT_AFTER_MS);
        }
      },
    });

    return () => {
      clearSseDisconnectTimer();
      unsub();
    };
  }, [refreshGoals, refreshProjects, reconcileActiveRuns, refreshBootstrap]);

  useEffect(() => {
    const goalIds = new Set<string>();
    if (state.selectedId) goalIds.add(state.selectedId);
    if (state.detailGoalId) goalIds.add(state.detailGoalId);

    for (const goalId of goalIds) {
      if (hydratedRunIdsRef.current.has(goalId)) continue;
      hydratedRunIdsRef.current.add(goalId);
      trimHydratedRunIds(hydratedRunIdsRef.current);
      void api.getGoalRun(goalId).then(({ run }) => {
        if (!run || (run.events.length === 0 && !run.liveText)) return;
        dispatch({
          type: "set_runs",
          updater: (prev) => {
            const existing = prev[goalId];
            if (existing?.active) return prev;
            if (
              existing &&
              existing.events.length >= run.events.length &&
              existing.liveText.length >= run.liveText.length
            ) {
              return prev;
            }
            return hydrateRunState(prev, goalId, run);
          },
        });
      }).catch(() => {
        /* ignore hydrate errors */
      });
    }
  }, [state.selectedId, state.detailGoalId]);

  useEffect(() => {
    if (!state.selectedConversationId) return;
    const activeGoals = state.goals.filter(
      (g) =>
        g.conversationId === state.selectedConversationId &&
        (g.status === "running" || g.status === "awaiting_review"),
    );
    for (const goal of activeGoals) {
      if (hydratedRunIdsRef.current.has(goal.id)) continue;
      hydratedRunIdsRef.current.add(goal.id);
      trimHydratedRunIds(hydratedRunIdsRef.current);
      void api.getGoalRun(goal.id).then(({ run }) => {
        if (!run || (run.events.length === 0 && !run.liveText)) return;
        dispatch({
          type: "set_runs",
          updater: (prev) => {
            const existing = prev[goal.id];
            if (existing?.active) return prev;
            if (
              existing &&
              existing.events.length >= run.events.length &&
              existing.liveText.length >= run.liveText.length
            ) {
              return prev;
            }
            return hydrateRunState(prev, goal.id, run);
          },
        });
      }).catch(() => {
        /* ignore hydrate errors */
      });
    }
  }, [state.selectedConversationId, state.goals]);

  const saveWorkspace = useCallback(
    async (path: string) => {
      if (!state.settings) return;
      const saved = await api.saveSettingsFresh({ ...state.settings, workspaceRoot: path });
      dispatch({ type: "set_settings", settings: saved });
    },
    [state.settings],
  );

  const saveSystemWorkspace = useCallback(
    async (path: string) => {
      if (!state.settings) return;
      const saved = await api.saveSettingsFresh({
        ...state.settings,
        systemWorkspaceRoot: path,
      });
      dispatch({ type: "set_settings", settings: saved });
      await refreshProjects();
    },
    [state.settings, refreshProjects],
  );

  const goalActions = useMemo(
    () => ({
      onApprove: async (id: string) => {
        const result = await runTaskAction({ type: "approve", goalId: id });
        if (!result.ok) {
          notifyIsland(`确认失败：${result.error}`, { severity: "error" });
        }
        return result.ok;
      },
      onRework: async (id: string, reason?: string) => {
        const result = await runTaskAction({ type: "rework", goalId: id, reason });
        if (!result.ok) {
          notifyIsland(`返工失败：${result.error}`, { severity: "error" });
        }
        return result.ok;
      },
      onStart: async (id: string) => {
        const goal = state.goals.find((g) => g.id === id);
        const result = await runTaskAction({
          type: "start",
          goalId: id,
          goalStatus: goal?.status,
        });
        if (!result.ok) {
          notifyIsland(`启动失败：${result.error}`, { severity: "error" });
        }
        return result.ok;
      },
      onCancel: async (id: string) => {
        const result = await runTaskAction({ type: "cancel", goalId: id });
        if (!result.ok) {
          notifyIsland(`取消失败：${result.error}`, { severity: "error" });
        }
        return result.ok;
      },
    }),
    [state.goals],
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
          notifyIsland(
            `批量操作：成功 ${ok.length}，失败 ${failed.length}${sample ? `（${sample}）` : ""}`,
            { severity: "warning" },
          );
        } else if (ok.length > 0) {
          const labels: Record<BatchGoalsAction, string> = {
            start: "已开始推进",
            cancel: "已取消",
            approve: "已确认完成",
            delete: "已删除",
          };
          notifyIsland(`${labels[action]} ${ok.length} 个目标`, { severity: "success" });
        }
      } catch (err) {
        notifyIsland(
          `批量操作失败：${err instanceof Error ? err.message : String(err)}`,
          { severity: "error" },
        );
      }
    },
    [],
  );

  const conversationGoals = useMemo(() => {
    if (!state.selectedConversationId) return [];
    let scoped = state.goals.filter(
      (g) => g.conversationId === state.selectedConversationId,
    );
    if (state.executorScope !== "all") {
      scoped = scoped.filter((g) => g.executorId === state.executorScope);
    }
    return scoped;
  }, [state.goals, state.selectedConversationId, state.executorScope]);

  const projectGoals = useMemo(() => {
    if (!state.selectedProjectId) return conversationGoals;
    const projectId = state.selectedProjectId;
    const convIds = new Set(
      state.conversations
        .filter((c) => c.projectId === projectId)
        .map((c) => c.id),
    );
    // 保管箱可能被 UI 隐藏，但仍要显示迁入的任务
    convIds.add(projectGoalVaultConversationId(projectId));
    let scoped = state.goals.filter((g) => convIds.has(g.conversationId));
    if (state.executorScope !== "all") {
      scoped = scoped.filter((g) => g.executorId === state.executorScope);
    }
    return scoped;
  }, [
    state.goals,
    state.selectedProjectId,
    state.conversations,
    state.executorScope,
    conversationGoals,
  ]);

  const filteredGoals = useMemo(() => {
    const { statusFilter } = state;
    return conversationGoals.filter((g) => goalMatchesDisplayFilter(g, statusFilter));
  }, [conversationGoals, state.statusFilter]);

  const projectFilteredGoals = useMemo(() => {
    const { statusFilter } = state;
    return projectGoals.filter((g) => goalMatchesDisplayFilter(g, statusFilter));
  }, [projectGoals, state.statusFilter]);

  const selected = state.goals.find((g) => g.id === state.selectedId);
  const selectedProject = state.projects.find((p) => p.id === state.selectedProjectId);
  const selectedConversation = state.conversations.find(
    (c) => c.id === state.selectedConversationId,
  );
  const inboxBadgeCount = Math.max(
    state.goals.filter(goalNeedsUserAttention).length,
    state.openAttentionCount,
  );
  const consoleBadgeCount = useMemo(() => {
    const systemActive = state.goals.filter(
      (g) =>
        g.conversationId === SYSTEM_MAIN_CONVERSATION_ID &&
        (g.status === "running" || g.status === "awaiting_review"),
    ).length;
    const crossReview = state.goals.filter(
      (g) =>
        g.conversationId !== SYSTEM_MAIN_CONVERSATION_ID &&
        g.status === "awaiting_review",
    ).length;
    return systemActive + crossReview;
  }, [state.goals]);
  const tasksSelectedGoals = useMemo(
    () => state.goals.filter((g) => state.tasksSelectedIds.has(g.id)),
    [state.goals, state.tasksSelectedIds],
  );

  const value: AppContextValue = {
    state,
    dispatch,
    refreshGoals,
    upsertGoals,
    refreshProjects,
    refreshMeta,
    refreshExecutors,
    createProject,
    createConversation,
    enableRoundtable,
    deleteProject,
    deleteConversation,
    clearConversationThread,
    forgetProjectConversations,
    saveWorkspace,
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
    tasksSelectedGoals,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppState() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppState must be used within AppProvider");
  return ctx;
}
