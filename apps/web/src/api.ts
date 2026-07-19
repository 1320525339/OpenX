import type {
  CliProfile,
  ConnectBootstrapStatus,
  Conversation,
  CreateGoalInput,
  CreateKnowledgeSourceBody,
  CreateProjectInput,
  Goal,
  GoalRunState,
  KnowledgeContextSelection,
  KnowledgeEntry,
  KnowledgeSourceRef,
  Project,
  ProviderConfig,
  RefinedGoal,
  Settings,
  SseEvent,
  LlmProviderId,
} from "@openx/shared";

export type BootstrapConnectResult = {
  command: string;
  pid?: number;
  status: ConnectBootstrapStatus;
  online?: boolean;
  error?: string;
};
import { mergeSettingsForSave, SSE_EVENT_TYPES } from "@openx/shared";
import { getApiBase } from "./lib/api-base";
import { goalAccessHeaders } from "./lib/goal-access-context";
import { readClientTimeContext } from "./lib/client-time-context";

export type SettingsResponse = Settings & {
  workspaceResolved?: string;
  systemWorkspaceResolved?: string;
};

export type CoachAgentInfo = {
  id: string;
  name: string;
  desc: string;
  agentMdPath?: string;
  builtin?: boolean;
};

export type MilocoStatusResponse = {
  dashboardUrl: string;
  skillsInstalled: string[];
  skillsBoundToPi: string[];
  syncSkillsInstalled?: string[];
  batch2SkillsInstalled?: string[];
  batch2SkillsBoundToPi?: string[];
  batch3SkillsInstalled?: string[];
  batch3SkillsBoundToPi?: string[];
  webhook: {
    url: string;
    tokenConfigured: boolean;
  };
  presenceWatch?: { enabled: boolean; intervalMs: number };
  homeCronWatch?: { enabled: boolean };
};

export type MilocoEventItem = {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  lane?: string;
  goalId?: string;
};

export type IntegrationDirectoryEntry = {
  id: string;
  version: string;
  displayName: string;
  icon: string;
  capabilities: string[];
  permissions: string[];
  installed: boolean;
  enabled: boolean;
  health: string;
  healthDetail?: string;
  envLocked?: boolean;
  envLockReason?: string;
  migrationCompleted?: boolean;
  toolsTab?: { id: string; label: string; componentKey: string };
  oxspTemplates?: Array<{ id: string; label: string }>;
};

export type MilocoHomeCronStatus = {
  enabled: boolean;
  tickMs: number;
  memoryDir: string;
  conversationId: string;
  tasks: Array<{
    name: string;
    description: string;
    cronExpr: string;
    nextHint: string;
  }>;
  recentRuns: Array<{ taskName: string; goalId: string; triggeredAt: string }>;
};

export type MilocoLayerBCheck = {
  id: string;
  ok: boolean;
  detail: string;
};

export type MilocoScopeCamera = {
  did: string;
  name?: string;
  room?: string;
  in_use: boolean;
  is_online: boolean;
  connected: boolean;
};

export type MilocoLayerBStatus = {
  checkedAt: string;
  ready: boolean;
  checks: MilocoLayerBCheck[];
  cameras: MilocoScopeCamera[];
  enabledCameraCount: number;
  maxEnabledCameras: number;
  perceptionDeviceCount: number;
  omniApiKeyConfigured: boolean;
  wslWebhookReachable: boolean;
  wslWebhookUrl?: string;
  dashboardUrl: string;
  eventsConversationId: string;
  recentEventGoalCount: number;
  latestEventGoal?: { id: string; title: string; status: string; updatedAt: string };
  refreshing?: boolean;
  stale?: boolean;
  error?: string;
};

export type BootstrapResponse = {
  settings: SettingsResponse;
  projects: Project[];
  conversations: Conversation[];
  system: { project: Project; conversation: Conversation };
  coachAgents: CoachAgentInfo[];
  coach: {
    ready: boolean;
    slug?: string;
    model?: string;
    baseUrl?: string;
    error?: string;
  };
};

const BASE = getApiBase();

function withGoalAccess(init?: RequestInit): RequestInit {
  return {
    ...init,
    headers: {
      ...goalAccessHeaders(),
      ...(init?.headers ?? {}),
    },
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export type ExecutorInfo = {
  id: string;
  displayName: string;
  available: boolean;
  /** 已配置但未在线的 Connect CLI：派单时自动自举 */
  bootstrappable?: boolean;
  hint?: string;
};

export type ReviewVerifySnapshot = {
  command: string;
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  stdout?: string;
  stderr?: string;
};

export type ReviewRoundEntry = {
  round: number;
  roundLabel: string;
  verdict: "pass" | "fail";
  reason: string;
  reworkInstruction?: string;
  reworkTargets?: Array<{ childTitle: string; instruction: string }>;
  verifyResults?: ReviewVerifySnapshot[];
  timestamp: string;
};

export type ModelRuntime = {
  ref?: string;
  ready: boolean;
  model?: string;
  baseUrl?: string;
  slug?: string;
  error?: string;
};

export type LlmTemplateInfo = {
  id: LlmProviderId;
  name: string;
  tagline: string;
  baseUrl: string;
  defaultModel: string;
  models?: readonly string[];
  apiKeyRequired: boolean;
  popular: boolean;
};

export type CoachMeta = {
  llmError?: string;
  quotaExceeded?: boolean;
};

export type SkillInfo = {
  id: string;
  name: string;
  desc: string;
  kind: "core" | "github";
  required: boolean;
  defaultEnabled: boolean;
  installed: boolean;
  repo?: string;
  installError?: string;
  skillMdPath?: string;
};

export type SkillBinding = {
  enabled: boolean;
  cliIds: string[];
};

export type WorkspaceSkillsLink = {
  workspaceRoot: string;
  linkPath: string;
  targetPath: string;
  linked: boolean;
  error?: string;
};

export type WorkspaceAgentsLink = WorkspaceSkillsLink;

export type ManagedAgentInfo = {
  executorId: string;
  label: string;
  kind: "pi" | "acp" | "connect";
  available: boolean;
  hint?: string;
  assignedSkillIds: string[];
};

export type ExecutorRecommendation = {
  executorId: string;
  reason: string;
  intent: string;
  scores: Array<{ executorId: string; score: number; enabledSkillIds: string[] }>;
};

export const api = {
  getProjects: () =>
    request<{ projects: Project[]; conversations: Conversation[] }>(
      "/api/projects",
    ),

  getProjectReadiness: (id: string) =>
    request<{
      readiness: {
        level: string;
        score: number;
        gaps: string[];
        checks: Array<{ id: string; label: string; ok: boolean; detail?: string }>;
      };
      badge: string;
    }>(`/api/projects/${encodeURIComponent(id)}/readiness`),

  createProject: (body: CreateProjectInput) =>
    request<{ project: Project }>("/api/projects", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  deleteProject: (id: string) =>
    request<{ ok: boolean }>(`/api/projects/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),

  patchProject: (
    id: string,
    body: import("@openx/shared").UpdateProjectInput,
  ) =>
    request<{ project: Project }>(`/api/projects/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  createConversation: (
    projectId: string,
    opts?: string | {
      title?: string;
      mode?: "foreman" | "roundtable";
      participantProfileIds?: string[];
    },
  ) => {
    const body =
      typeof opts === "string"
        ? { title: opts }
        : {
            title: opts?.title,
            mode: opts?.mode,
            participantProfileIds: opts?.participantProfileIds,
          };
    return request<{ conversation: Conversation }>(
      `/api/projects/${encodeURIComponent(projectId)}/conversations`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );
  },

  patchConversation: (
    id: string,
    body: { title?: string; mode?: "foreman" | "roundtable" },
  ) =>
    request<{ conversation: Conversation }>(
      `/api/conversations/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ),

  listAiProfiles: () =>
    request<{ profiles: import("@openx/shared").AiProfile[] }>("/api/roundtable/ai-profiles"),

  createAiProfile: (body: import("@openx/shared").CreateAiProfileInput) =>
    request<{ profile: import("@openx/shared").AiProfile }>("/api/roundtable/ai-profiles", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getRoundtableParticipants: (conversationId: string) =>
    request<{ participants: import("@openx/shared").ConversationParticipant[] }>(
      `/api/roundtable/conversations/${encodeURIComponent(conversationId)}/participants`,
    ),

  putRoundtableParticipants: (
    conversationId: string,
    participants: import("@openx/shared").UpsertConversationParticipantsInput["participants"],
  ) =>
    request<{ participants: import("@openx/shared").ConversationParticipant[] }>(
      `/api/roundtable/conversations/${encodeURIComponent(conversationId)}/participants`,
      { method: "PUT", body: JSON.stringify({ participants }) },
    ),

  enableRoundtable: (
    conversationId: string,
    body?: {
      participantProfileIds?: string[];
      participantSeats?: import("@openx/shared").RoundtableSeatInput[];
    },
  ) =>
    request<{
      conversation: Conversation;
      participants: import("@openx/shared").ConversationParticipant[];
    }>(`/api/roundtable/conversations/${encodeURIComponent(conversationId)}/enable`, {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),

  createChatRound: (
    conversationId: string,
    body: import("@openx/shared").CreateChatRoundInput,
  ) =>
    request<{
      round: import("@openx/shared").ChatRound;
      userMessage: import("@openx/shared").CoachMessageRecord;
    }>(`/api/roundtable/conversations/${encodeURIComponent(conversationId)}/chat/rounds`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  synthesizeChatRound: (roundId: string) =>
    request<{ synthesis: import("@openx/shared").RoundSynthesisPayload }>(
      `/api/roundtable/rounds/${encodeURIComponent(roundId)}/synthesize`,
      { method: "POST", body: "{}" },
    ),

  roundToWorkOrder: (roundId: string) =>
    request<{
      message: string;
      refined?: import("@openx/shared").RefinedGoal;
      refinedMessage?: import("@openx/shared").CoachMessageRecord;
    }>(`/api/roundtable/rounds/${encodeURIComponent(roundId)}/to-work-order`, {
      method: "POST",
      body: "{}",
    }),

  retryRoundtableReply: (messageId: number) =>
    request<{ ok: boolean }>(
      `/api/roundtable/replies/${messageId}/retry`,
      { method: "POST", body: "{}" },
    ),

  cancelRoundtableReply: (messageId: number) =>
    request<{ ok: boolean }>(
      `/api/roundtable/replies/${messageId}/cancel`,
      { method: "POST", body: "{}" },
    ),

  cancelActiveRoundtableRounds: (conversationId: string) =>
    request<{ ok: boolean; roundIds: string[]; cancelledMessageIds: number[] }>(
      `/api/roundtable/conversations/${encodeURIComponent(conversationId)}/rounds/cancel-active`,
      { method: "POST", body: "{}" },
    ),

  rejectPeerRequest: (requestId: string) =>
    request<{ request: import("@openx/shared").PeerRequest }>(
      `/api/roundtable/peer-requests/${encodeURIComponent(requestId)}/reject`,
      { method: "POST", body: "{}" },
    ),

  approvePeerRequest: (requestId: string) =>
    request<{ request: import("@openx/shared").PeerRequest }>(
      `/api/roundtable/peer-requests/${encodeURIComponent(requestId)}/approve`,
      { method: "POST", body: "{}" },
    ),

  approveSessionPeerRequest: (requestId: string) =>
    request<{ request: import("@openx/shared").PeerRequest }>(
      `/api/roundtable/peer-requests/${encodeURIComponent(requestId)}/approve-session`,
      { method: "POST", body: "{}" },
    ),

  deleteConversation: (id: string) =>
    request<{ ok: boolean; report?: unknown }>(
      `/api/conversations/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),

  forgetConversation: (
    id: string,
    level: "clear_thread" | "delete_conversation",
  ) =>
    request<{ ok: boolean; report?: unknown }>(
      `/api/conversations/${encodeURIComponent(id)}/forget`,
      {
        method: "POST",
        body: JSON.stringify({ level }),
      },
    ),

  forgetProjectConversations: (projectId: string) =>
    request<{ ok: boolean; report?: unknown }>(
      `/api/projects/${encodeURIComponent(projectId)}/forget-conversations`,
      { method: "POST", body: "{}" },
    ),

  pickWorkspace: () =>
    request<
      | { ok: true; path: string }
      | { ok: false; reason?: string; message?: string }
    >("/api/workspace/pick", { method: "POST" }),

  getGoals: (opts?: { status?: string; conversationId?: string; projectId?: string }) => {
    const params = new URLSearchParams();
    if (opts?.status) params.set("status", opts.status);
    if (opts?.conversationId) params.set("conversationId", opts.conversationId);
    if (opts?.projectId) params.set("projectId", opts.projectId);
    const q = params.toString();
    return request<{ goals: Goal[] }>(q ? `/api/goals?${q}` : "/api/goals");
  },

  getGoalsPage: (opts: {
    conversationId?: string;
    projectId?: string;
    displayFilter?: string;
    limit?: number;
    offset?: number;
  }) => {
    const params = new URLSearchParams();
    if (opts.conversationId) params.set("conversationId", opts.conversationId);
    if (opts.projectId) params.set("projectId", opts.projectId);
    if (opts.displayFilter) params.set("displayFilter", opts.displayFilter);
    params.set("limit", String(opts.limit ?? 80));
    params.set("offset", String(opts.offset ?? 0));
    return request<{
      goals: Goal[];
      total: number;
      limit: number;
      offset: number;
      hasMore: boolean;
    }>(`/api/goals?${params}`);
  },

  getGoalCounts: (opts?: { conversationId?: string; projectId?: string }) => {
    const params = new URLSearchParams();
    if (opts?.conversationId) params.set("conversationId", opts.conversationId);
    if (opts?.projectId) params.set("projectId", opts.projectId);
    const q = params.toString();
    return request<{
      counts: {
        all: number;
        incomplete: number;
        failed: number;
        done: number;
        rework: number;
      };
    }>(q ? `/api/goals/counts?${q}` : "/api/goals/counts");
  },

  getLogsPage: (opts?: { goalId?: string; limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (opts?.goalId) params.set("goalId", opts.goalId);
    params.set("limit", String(opts?.limit ?? 120));
    params.set("offset", String(opts?.offset ?? 0));
    return request<{
      logs: { goalId: string; level: string; message: string; timestamp: string }[];
      total: number;
      limit: number;
      offset: number;
      hasMore: boolean;
    }>(`/api/logs?${params}`);
  },

  getExecutors: () => request<{ executors: ExecutorInfo[] }>("/api/executors"),

  getAgents: () =>
    request<{
      coachAgents: CoachAgentInfo[];
      personas: CoachAgentInfo[];
      agentsDir: string;
      agentsLink: WorkspaceAgentsLink;
    }>("/api/agents"),

  getAgent: (id: string) =>
    request<{ id: string; name: string; desc: string; body: string }>(
      `/api/agents/${encodeURIComponent(id)}`,
    ),

  putAgent: (id: string, content: string) =>
    request<{ ok: boolean; id: string; name: string; desc: string; body: string }>(
      `/api/agents/${encodeURIComponent(id)}`,
      { method: "PUT", body: JSON.stringify({ content }) },
    ),

  getSkills: () =>
    request<{
      skills: SkillInfo[];
      bindings: Record<string, SkillBinding>;
      skillsDir: string;
      workspaceLink: WorkspaceSkillsLink;
      agents: ManagedAgentInfo[];
      coachAgents: CoachAgentInfo[];
      agentsDir: string;
      agentsLink: WorkspaceAgentsLink;
    }>("/api/skills"),

  getManagedAgents: () =>
    request<{ agents: ManagedAgentInfo[] }>("/api/managed-agents"),

  recommendExecutor: (body: {
    title?: string;
    acceptance?: string;
    executionPrompt?: string;
    userDraft?: string;
  }) =>
    request<{ recommendation: ExecutorRecommendation | null }>(
      "/api/goals/recommend-executor",
      { method: "POST", body: JSON.stringify(body) },
    ),

  putSkillBindings: (bindings: Record<string, SkillBinding>) =>
    request<{ ok: boolean; bindings: Record<string, SkillBinding>; settings: Settings }>(
      "/api/skills/bindings",
      { method: "PUT", body: JSON.stringify(bindings) },
    ),

  syncSkills: () =>
    request<{ ok: boolean; skills: SkillInfo[]; skillsDir?: string }>(
      "/api/skills/sync",
      { method: "POST" },
    ),

  addCliProfile: (profile: CliProfile) =>
    request<{
      profile: CliProfile;
      settings: Settings;
      bootstrap?: BootstrapConnectResult;
    }>("/api/cli/profiles", {
      method: "POST",
      body: JSON.stringify(profile),
    }),

  deleteCliProfile: (executorId: string) =>
    request<{ ok: boolean; settings: Settings }>(
      `/api/cli/profiles/${encodeURIComponent(executorId)}`,
      { method: "DELETE" },
    ),

  bootstrapCli: (executorId: string, opts?: { wait?: boolean }) =>
    request<BootstrapConnectResult>(
      `/api/cli/profiles/${encodeURIComponent(executorId)}/bootstrap`,
      {
        method: "POST",
        body: JSON.stringify({ wait: opts?.wait ?? false }),
      },
    ),

  getCliBootstrapStatuses: () =>
    request<{ statuses: ConnectBootstrapStatus[] }>("/api/cli/bootstrap-status"),

  getAcpCliConfig: (executorId: string) =>
    request<{ config: import("@openx/shared").AcpCliConfigSnapshot }>(
      `/api/cli/acp-config/${encodeURIComponent(executorId)}`,
    ),

  updateAcpCliConfig: (
    executorId: string,
    body: import("@openx/shared").UpdateAcpCliConfigInput,
  ) =>
    request<{
      config: import("@openx/shared").AcpCliConfigSnapshot;
      settings: Settings;
    }>(`/api/cli/acp-config/${encodeURIComponent(executorId)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  disconnectCli: (executorId: string) =>
    request<{ ok: boolean }>(
      `/api/connect/by-executor/${encodeURIComponent(executorId)}`,
      { method: "DELETE" },
    ),

  getGoal: (id: string) =>
    request<{
      goal: Goal;
      logs: { level: string; message: string; timestamp: string }[];
      run: GoalRunState;
    }>(`/api/goals/${id}`),

  getGoalRun: (id: string) =>
    request<{ run: GoalRunState }>(`/api/goals/${id}/run`),

  getGoalReviewRounds: (id: string) =>
    request<{ rounds: ReviewRoundEntry[] }>(`/api/goals/${id}/review-rounds`),

  getGoalCrewMessages: (id: string) =>
    request<{ messages: import("@openx/shared").CrewExchangeRecord[] }>(
      `/api/goals/${id}/crew-messages`,
    ),

  triggerGoalReview: (id: string, opts?: { force?: boolean }) =>
    request<{ ok: boolean; goal?: Goal; rounds: ReviewRoundEntry[] }>(
      `/api/goals/${id}/trigger-review`,
      withGoalAccess({
        method: "POST",
        body: JSON.stringify({ force: opts?.force ?? true }),
      }),
    ),

  createGoal: (body: CreateGoalInput & { autoStart?: boolean }) =>
    request<{ goal: Goal; children?: Goal[] }>("/api/goals", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  addSubGoals: (
    parentId: string,
    subGoals: CreateGoalInput["subGoals"],
    autoStart?: boolean,
  ) =>
    request<{ children: Goal[] }>(
      `/api/goals/${parentId}/sub-goals`,
      withGoalAccess({
        method: "POST",
        body: JSON.stringify({ subGoals, autoStart }),
      }),
    ),

  patchGoal: (id: string, body: Record<string, unknown>) =>
    request<{ goal: Goal }>(`/api/goals/${id}`, withGoalAccess({
      method: "PATCH",
      body: JSON.stringify(body),
    })),

  resumeCrewGoal: (id: string, message: string) =>
    request<{ ok: true; goal: Goal }>(`/api/goals/${id}/crew/resume`, withGoalAccess({
      method: "POST",
      body: JSON.stringify({ message }),
    })),

  refineGoal: (id: string) =>
    request<{ goal: Goal; refined: RefinedGoal }>(`/api/goals/${id}/refine`, withGoalAccess({
      method: "POST",
    })),

  getModelStatus: () =>
    request<{ coach: ModelRuntime; pi: ModelRuntime }>("/api/model/status"),

  getModelTemplates: () =>
    request<{ templates: LlmTemplateInfo[] }>("/api/model/templates"),

  getModelProviders: () =>
    request<{ providers: Record<string, ProviderConfig> }>("/api/model/providers"),

  createModelProvider: (slug: string, config: ProviderConfig) =>
    request<{ slug: string; config: ProviderConfig; settings: Settings }>(
      "/api/model/providers",
      { method: "POST", body: JSON.stringify({ slug, config }) },
    ),

  updateModelProvider: (slug: string, config: ProviderConfig) =>
    request<{ slug: string; config: ProviderConfig; settings: Settings }>(
      `/api/model/providers/${encodeURIComponent(slug)}`,
      { method: "PUT", body: JSON.stringify(config) },
    ),

  deleteModelProvider: (slug: string) =>
    request<{ ok: boolean; settings: Settings }>(
      `/api/model/providers/${encodeURIComponent(slug)}`,
      { method: "DELETE" },
    ),

  fetchProviderModels: (body: { slug?: string; config?: ProviderConfig }) =>
    request<{
      ok: boolean;
      models?: { id: string; name?: string }[];
      source?: "remote" | "template";
      warning?: string;
      error?: string;
    }>("/api/model/fetch-models", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  testModelConnection: (body?: {
    ref?: string;
    role?: "coach" | "pi";
    slug?: string;
    config?: ProviderConfig;
  }) =>
    request<{
      ok: boolean;
      message?: string;
      error?: string;
      ref?: string;
      slug?: string;
      model?: string;
      baseUrl?: string;
    }>("/api/model/test", {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),

  coachRefine: (userDraft: string, constraints?: string[]) =>
    request<RefinedGoal & { meta?: CoachMeta }>("/api/coach/refine", {
      method: "POST",
      body: JSON.stringify({ userDraft, constraints }),
    }),

  respondRefinedWorkOrder: (
    refinedMessageId: number,
    opts: {
      conversationId: string;
      outcome: "dismissed" | "confirmed";
      goalId?: string;
    },
  ) =>
    request<{
      message: string;
      conversationId: string;
      toolResult: import("@openx/shared").WorkOrderToolResult;
      meta?: CoachMeta;
    }>(`/api/coach/refined/${refinedMessageId}/respond`, {
      method: "POST",
      body: JSON.stringify({
        conversationId: opts.conversationId,
        outcome: opts.outcome,
        goalId: opts.goalId,
      }),
    }),

  respondClarify: (
    clarifyMessageId: number,
    opts: {
      conversationId: string;
      outcome: "answered" | "dismissed";
      answers?: Record<string, string | string[]>;
      annotations?: Record<string, { notes?: string }>;
    },
  ) =>
    request<{
      message: string;
      conversationId: string;
      refined?: import("@openx/shared").RefinedGoal;
      toolResult: import("@openx/shared").ClarifyToolResult;
      meta?: CoachMeta;
    }>(`/api/coach/clarify/${clarifyMessageId}/respond`, {
      method: "POST",
      body: JSON.stringify({
        conversationId: opts.conversationId,
        outcome: opts.outcome,
        answers: opts.answers,
        annotations: opts.annotations,
      }),
    }),

  coachChat: (
    message: string,
    opts: {
      conversationId: string;
      goalId?: string;
      skillIds?: string[];
      mcpIds?: string[];
      knowledge?: KnowledgeContextSelection;
      agentId?: string;
      forceRefine?: boolean;
      skipRefine?: boolean;
      permissionMode?: import("@openx/shared").DispatchPermissionMode;
    },
  ) =>
    request<{
      message: string;
      conversationId: string;
      refined?: RefinedGoal;
      clarify?: import("@openx/shared").CoachClarifyPayload;
      suggestRefine?: boolean;
      crewResumed?: boolean;
      goalId?: string;
      meta?: CoachMeta;
    }>("/api/coach/chat", {
      method: "POST",
      body: JSON.stringify({
        message,
        conversationId: opts.conversationId,
        goalId: opts.goalId,
        skillIds: opts.skillIds,
        mcpIds: opts.mcpIds,
        knowledge: opts.knowledge,
        agentId: opts.agentId,
        forceRefine: opts.forceRefine,
        skipRefine: opts.skipRefine,
        permissionMode: opts.permissionMode,
        ...readClientTimeContext(),
      }),
    }),

  getCliSystemConversation: () =>
    request<{
      project: import("@openx/shared").Project;
      conversation: import("@openx/shared").Conversation;
    }>("/api/cli/system-conversation"),

  getSystemConsole: () =>
    request<{
      project: Project;
      conversation: Conversation;
      connections: Array<{
        connectionId: string;
        toolName: string;
        agentName: string;
        executorId: string;
        connectedAt: string;
        lastHeartbeatAt: string;
      }>;
      stats: {
        systemRunning: number;
        systemAwaitingReview: number;
        crossProjectAwaitingReview: number;
        crossProjectRunning: number;
      };
      crossProjectReviewGoals: Goal[];
      systemGoals: Goal[];
      allGoals: Goal[];
    }>("/api/system/console"),

  getIslandSeen: (limit = 500, scopeKey?: string) => {
    const scope = scopeKey ? `&scopeKey=${encodeURIComponent(scopeKey)}` : "";
    return request<{ seenIds: string[] }>(`/api/island/seen?limit=${limit}${scope}`);
  },

  markIslandSeen: (ids: string[], scopeKey?: string) =>
    request<{ ok: true; marked: number }>("/api/island/seen", {
      method: "POST",
      body: JSON.stringify({ ids, scopeKey }),
    }),

  listAttentions: (state: "open" = "open", limit = 200) =>
    request<{ attentions: import("@openx/shared").AttentionRecord[] }>(
      `/api/island/attentions?state=${state}&limit=${limit}`,
    ),

  ackAttention: (key: string) =>
    request<{ ok: true; key: string; state: string; revision: number }>(
      `/api/island/attentions/${encodeURIComponent(key)}/ack`,
      { method: "POST" },
    ),

  getMcp: () =>
    request<{
      servers: import("@openx/shared").McpServerConfig[];
      catalog: Array<{
        id: string;
        name: string;
        desc: string;
        configured: boolean;
      }>;
    }>("/api/mcp"),

  getCatalog: () =>
    request<{
      meta: {
        version: string;
        endpointCount: number;
        categories: string[];
        defaultBaseUrl: string;
        mcpServerId: string;
      };
      endpoints: Array<{
        id: string;
        method: string;
        path: string;
        category: string;
        summary: string;
      }>;
    }>("/api/catalog"),

  putMcp: (servers: import("@openx/shared").McpServerConfig[]) =>
    request<{
      ok: boolean;
      servers: import("@openx/shared").McpServerConfig[];
    }>("/api/mcp", {
      method: "PUT",
      body: JSON.stringify({ servers }),
    }),

  getCoachMessages: (conversationId: string) =>
    request<{
      messages: import("@openx/shared").CoachMessageRecord[];
    }>(`/api/coach/messages?conversationId=${encodeURIComponent(conversationId)}`),

  startGoal: (id: string) =>
    request<{ goal: Goal }>(`/api/goals/${id}/start`, withGoalAccess({ method: "POST" })),

  retryGoal: (id: string) =>
    request<{ goal: Goal }>(`/api/goals/${id}/retry`, withGoalAccess({ method: "POST" })),

  approveGoal: (id: string) =>
    request<{ goal: Goal }>(`/api/goals/${id}/approve`, withGoalAccess({ method: "POST" })),

  reworkGoal: (id: string, reason?: string) =>
    request<{ goal: Goal }>(`/api/goals/${id}/rework`, withGoalAccess({
      method: "POST",
      body: JSON.stringify({ reason }),
    })),

  cancelGoal: (id: string) =>
    request<{ goal: Goal }>(`/api/goals/${id}/cancel`, withGoalAccess({ method: "POST" })),

  deleteGoal: (id: string) =>
    request<{ deleted: string[]; failed: { id: string; error: string }[] }>(
      `/api/goals/${id}`,
      withGoalAccess({ method: "DELETE" }),
    ),

  batchGoals: (action: "start" | "cancel" | "approve" | "delete", ids: string[]) =>
    request<{ ok: string[]; failed: { id: string; error: string }[] }>(
      "/api/goals/batch",
      withGoalAccess({
        method: "POST",
        body: JSON.stringify({ action, ids }),
      }),
    ),

  getBootstrap: () => request<BootstrapResponse>("/api/bootstrap"),

  getSettings: () => request<SettingsResponse>("/api/settings"),

  getOperatorPlaybook: () =>
    request<import("@openx/shared").OperatorPlaybook & {
      workflows?: Array<{
        id: string;
        title: string;
        description?: string;
        minTier: string;
        stepCount: number;
      }>;
    }>("/api/operator/playbook"),

  getOperatorWorkflows: () =>
    request<{
      workflows: Array<{
        id: string;
        title: string;
        description?: string;
        minTier: string;
        stepCount: number;
      }>;
    }>("/api/operator/workflows"),

  runOperatorWorkflow: (
    id: string,
    body?: { vars?: Record<string, string>; stopOnError?: boolean },
  ) =>
    request<{
      workflowId: string;
      ok: boolean;
      steps: Array<{ id: string; ok: boolean; detail: string; status?: number }>;
    }>(`/api/operator/workflows/${encodeURIComponent(id)}/run`, {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),

  getProjectMemory: (projectId: string) =>
    request<{ projectId: string; memory: string }>(
      `/api/projects/${encodeURIComponent(projectId)}/memory`,
    ),

  distillProjectMemory: (projectId: string) =>
    request<{
      ok: boolean;
      projectId: string;
      sectionsWritten: number;
      memoryChars: number;
      detail: string;
    }>(`/api/projects/${encodeURIComponent(projectId)}/memory/distill`, {
      method: "POST",
    }),

  getGlobalKnowledge: () =>
    request<{ scope: "global"; entries: KnowledgeEntry[] }>("/api/knowledge/global"),

  getGlobalKnowledgeSources: () =>
    request<{ scope: "global"; sources: KnowledgeSourceRef[] }>("/api/knowledge/sources"),

  createGlobalKnowledgeSource: (body: CreateKnowledgeSourceBody) =>
    request<{ source: KnowledgeSourceRef }>("/api/knowledge/sources", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  reindexGlobalKnowledgeSource: (sourceId: string) =>
    request<{ source: KnowledgeSourceRef }>(
      `/api/knowledge/sources/${encodeURIComponent(sourceId)}/reindex`,
      { method: "POST" },
    ),

  deleteGlobalKnowledgeSource: (sourceId: string) =>
    request<{ ok: boolean }>(`/api/knowledge/sources/${encodeURIComponent(sourceId)}`, {
      method: "DELETE",
    }),

  getProjectKnowledge: (projectId: string) =>
    request<{
      projectId: string;
      entries: KnowledgeEntry[];
      sources: KnowledgeSourceRef[];
      runtime: { memory: string; sections: string[] };
    }>(`/api/projects/${encodeURIComponent(projectId)}/knowledge`),

  createProjectKnowledgeSource: (projectId: string, body: CreateKnowledgeSourceBody) =>
    request<{ source: KnowledgeSourceRef }>(
      `/api/projects/${encodeURIComponent(projectId)}/knowledge/sources`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    ),

  reindexProjectKnowledgeSource: (projectId: string, sourceId: string) =>
    request<{ source: KnowledgeSourceRef }>(
      `/api/projects/${encodeURIComponent(projectId)}/knowledge/sources/${encodeURIComponent(sourceId)}/reindex`,
      { method: "POST" },
    ),

  deleteProjectKnowledgeSource: (projectId: string, sourceId: string) =>
    request<{ ok: boolean }>(
      `/api/projects/${encodeURIComponent(projectId)}/knowledge/sources/${encodeURIComponent(sourceId)}`,
      { method: "DELETE" },
    ),

  confirmOperatorAction: (id: string, messageId?: number) =>
    request<{ ok: boolean; action: unknown }>(`/api/operator/actions/${id}/confirm`, {
      method: "POST",
      body: JSON.stringify(messageId != null ? { messageId } : {}),
    }),

  dismissOperatorAction: (id: string, messageId?: number) =>
    request<{ ok: boolean; action: unknown }>(`/api/operator/actions/${id}/dismiss`, {
      method: "POST",
      body: JSON.stringify(messageId != null ? { messageId } : {}),
    }),

  respondDispatchPermission: (
    messageId: number,
    body: {
      conversationId: string;
      outcome: "confirmed" | "dismissed";
    },
  ) =>
    request<{ ok?: boolean }>(
      `/api/coach/dispatch-permission/${messageId}/respond`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    ),

  runOperatorSelfTest: (opts?: { skipConnect?: boolean }) =>
    request<{ ok: boolean; steps: Array<{ id: string; ok: boolean; detail: string }> }>(
      "/api/operator/self-test",
      {
        method: "POST",
        body: JSON.stringify(opts ?? {}),
      },
    ),

  putSettings: (settings: Settings, opts?: { baseRevision?: number }) =>
    request<SettingsResponse>("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ ...settings, baseRevision: opts?.baseRevision }),
    }),

  patchSettings: (patch: Partial<Settings>, opts?: { baseRevision?: number }) =>
    request<SettingsResponse>("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ ...patch, baseRevision: opts?.baseRevision }),
    }),

  /** 保存前拉取最新配置并 merge，带 revision 乐观锁 */
  saveSettingsFresh: async (local: Settings) => {
    const fresh = await request<SettingsResponse>("/api/settings");
    const merged = mergeSettingsForSave(fresh, local);
    return request<SettingsResponse>("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ ...merged, baseRevision: fresh.revision }),
    });
  },

  openInIde: (path: string) =>
    request<{
      ok: boolean;
      absolutePath: string;
      kind: "file" | "directory";
      ideUrl?: string;
      exists: boolean;
      command?: string;
      method?: "ide" | "default-app" | "file-manager";
    }>("/api/workspace/open-in-ide", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),

  filePreview: (path: string) =>
    request<
      | {
          ok: true;
          path: string;
          absolutePath: string;
          exists: true;
          content: string;
          truncated: boolean;
          language?: string;
          size: number;
        }
      | {
          ok: false;
          path: string;
          absolutePath: string;
          exists: boolean;
          error?: string;
        }
    >(`/api/workspace/file-preview?path=${encodeURIComponent(path)}`),

  getMilocoStatus: () => request<MilocoStatusResponse>("/api/miloco/status"),

  setupMiloco: (opts?: { force?: boolean }) =>
    request<{
      ok: boolean;
      installed: string[];
      error?: string;
      webhookUrl?: string;
      tokenConfigured?: boolean;
    }>("/api/miloco/setup", {
      method: "POST",
      body: JSON.stringify(opts ?? {}),
    }),

  getMilocoLayerB: () => request<MilocoLayerBStatus>("/api/miloco/layer-b"),

  refreshMilocoLayerB: () =>
    request<MilocoLayerBStatus>("/api/miloco/layer-b/refresh", {
      method: "POST",
      body: "{}",
    }),

  getIntegrations: () =>
    request<{ integrations: IntegrationDirectoryEntry[] }>("/api/integrations"),

  getIntegration: (id: string) =>
    request<IntegrationDirectoryEntry & { config?: Record<string, unknown> }>(
      `/api/integrations/${encodeURIComponent(id)}`,
    ),

  patchIntegration: (
    id: string,
    body: { enabled?: boolean; config?: Record<string, unknown> },
  ) =>
    request<{ ok: boolean; integration?: IntegrationDirectoryEntry; error?: string; envLocked?: boolean }>(
      `/api/integrations/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ),

  runIntegrationDiagnostics: (id: string) =>
    request<{
      ok: boolean;
      checkedAt: string;
      summary: string;
      checks?: Array<{ id: string; ok: boolean; detail: string }>;
    }>(`/api/integrations/${encodeURIComponent(id)}/diagnostics`, {
      method: "POST",
      body: "{}",
    }),

  getIntegrationDiagnosticsLatest: (id: string) =>
    request<{
      ok: boolean;
      checkedAt: string;
      summary: string;
      checks?: Array<{ id: string; ok: boolean; detail: string }>;
    }>(`/api/integrations/${encodeURIComponent(id)}/diagnostics/latest`),

  getMilocoConfig: () => request<Record<string, unknown>>("/api/miloco/config"),

  saveMilocoConfig: (body: Record<string, unknown>) =>
    request<Record<string, unknown>>("/api/miloco/config", {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  getMilocoHomes: () =>
    request<{
      ok: boolean;
      devices: Array<{
        did: string;
        name: string;
        room: string;
        category: string;
        online: boolean;
      }>;
      config: Record<string, unknown>;
      error?: string;
    }>("/api/miloco/homes"),

  completeMilocoSetupWizard: (body: Record<string, unknown>) =>
    request<{ ok: boolean; config: Record<string, unknown> }>(
      "/api/miloco/setup-wizard/complete",
      { method: "POST", body: JSON.stringify(body) },
    ),

  getMilocoEvents: (limit = 50, lane?: string) =>
    request<{ conversationId: string; goals: MilocoEventItem[]; runs?: MilocoEventItem[] }>(
      `/api/miloco/events?limit=${limit}${lane ? `&lane=${encodeURIComponent(lane)}` : ""}`,
    ),

  getMilocoHomeCron: () => request<MilocoHomeCronStatus>("/api/miloco/home-cron"),

  triggerMilocoHomeCron: (name: string) =>
    request<{ ok: boolean; goalId?: string; error?: string }>(
      "/api/miloco/home-cron/trigger",
      { method: "POST", body: JSON.stringify({ name }) },
    ),

  habitSuggestAction: (body: Record<string, unknown>) =>
    request<Record<string, unknown>>("/api/miloco/habit-suggest", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  connectMilocoWsl: (webhookHost?: string) =>
    request<{ ok: boolean; webhookUrl: string; error?: string }>("/api/miloco/connect-wsl", {
      method: "POST",
      body: JSON.stringify(webhookHost ? { webhookHost } : {}),
    }),

  addMilocoDashboardCard: () =>
    request<{ ok: boolean; slotId?: string; existing?: boolean; error?: string }>(
      "/api/miloco/add-card",
      { method: "POST", body: "{}" },
    ),

  enableMilocoCameras: (dids: string[]) =>
    request<{ ok: boolean; error?: string; status?: MilocoLayerBStatus }>(
      "/api/miloco/layer-b/cameras/enable",
      { method: "POST", body: JSON.stringify({ dids }) },
    ),

  disableMilocoCameras: (dids: string[]) =>
    request<{ ok: boolean; error?: string; status?: MilocoLayerBStatus }>(
      "/api/miloco/layer-b/cameras/disable",
      { method: "POST", body: JSON.stringify({ dids }) },
    ),
};

export type EventConnectionHandlers = {
  onEvent: (e: SseEvent) => void;
  onOpen?: () => void;
  /** SSE 历史回放结束（收到 connected 事件） */
  onCatchupComplete?: () => void;
  onError?: () => void;
  /** gap 后可做完整状态同步；返回 Promise 时会等其结束后再重建连接 */
  onGap?: (reason: string, pending?: number) => void | Promise<void>;
};

export function connectEvents(handlers: EventConnectionHandlers | ((e: SseEvent) => void)): () => void {
  const { onEvent, onOpen, onCatchupComplete, onError, onGap } =
    typeof handlers === "function" ? { onEvent: handlers } : handlers;

  let closed = false;
  let es: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let gapHandling = false;

  const clearReconnectTimer = () => {
    if (reconnectTimer != null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const attach = () => {
    if (closed) return;
    clearReconnectTimer();
    es?.close();
    es = new EventSource(`${BASE}/api/events`);

    const handler = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data as string) as SseEvent | { type: string };
        if (data.type === "connected") {
          onCatchupComplete?.();
          onOpen?.();
          return;
        }
        onEvent(data as SseEvent);
      } catch {
        /* ignore */
      }
    };

    es.onopen = () => onOpen?.();
    es.onerror = () => onError?.();

    for (const eventType of SSE_EVENT_TYPES) {
      es.addEventListener(eventType, handler);
    }
    es.addEventListener("connected", handler);
    es.addEventListener("gap", (ev: MessageEvent) => {
      if (closed || gapHandling) return;
      gapHandling = true;
      let reason = "unknown";
      let pending: number | undefined;
      try {
        const data = JSON.parse(ev.data as string) as { reason?: string; pending?: number };
        reason = data.reason ?? "unknown";
        pending = data.pending;
      } catch {
        /* ignore */
      }
      es?.close();
      es = null;
      void Promise.resolve(onGap?.(reason, pending))
        .catch(() => {
          /* sync 失败仍重建，避免卡死 */
        })
        .finally(() => {
          gapHandling = false;
          if (closed) return;
          reconnectTimer = setTimeout(() => attach(), 0);
        });
    });
    es.onmessage = handler;
  };

  attach();

  return () => {
    closed = true;
    gapHandling = false;
    clearReconnectTimer();
    es?.close();
    es = null;
  };
}
