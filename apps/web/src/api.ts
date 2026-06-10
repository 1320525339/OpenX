import type {
  CliProfile,
  CreateGoalInput,
  Goal,
  GoalRunState,
  ProviderConfig,
  RefinedGoal,
  Settings,
  SseEvent,
  LlmProviderId,
} from "@openx/shared";
import { SSE_EVENT_TYPES } from "@openx/shared";

export type SettingsResponse = Settings & { workspaceResolved?: string };

const BASE = "";

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
  hint?: string;
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
  getGoals: (status?: string) =>
    request<{ goals: Goal[] }>(
      status ? `/api/goals?status=${status}` : "/api/goals",
    ),

  getExecutors: () => request<{ executors: ExecutorInfo[] }>("/api/executors"),

  getSkills: () =>
    request<{
      skills: SkillInfo[];
      bindings: Record<string, SkillBinding>;
      skillsDir: string;
      workspaceLink: WorkspaceSkillsLink;
      agents: ManagedAgentInfo[];
    }>("/api/skills"),

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
    request<{ profile: CliProfile; settings: Settings }>("/api/cli/profiles", {
      method: "POST",
      body: JSON.stringify(profile),
    }),

  deleteCliProfile: (executorId: string) =>
    request<{ ok: boolean; settings: Settings }>(
      `/api/cli/profiles/${encodeURIComponent(executorId)}`,
      { method: "DELETE" },
    ),

  bootstrapCli: (executorId: string) =>
    request<{ command: string; pid?: number }>(
      `/api/cli/profiles/${encodeURIComponent(executorId)}/bootstrap`,
      { method: "POST" },
    ),

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
    request<{ children: Goal[] }>(`/api/goals/${parentId}/sub-goals`, {
      method: "POST",
      body: JSON.stringify({ subGoals, autoStart }),
    }),

  patchGoal: (id: string, body: Record<string, unknown>) =>
    request<{ goal: Goal }>(`/api/goals/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  refineGoal: (id: string) =>
    request<{ goal: Goal; refined: RefinedGoal }>(`/api/goals/${id}/refine`, {
      method: "POST",
    }),

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

  coachChat: (message: string, goalId?: string, skillIds?: string[]) =>
    request<{ message: string; refined?: RefinedGoal; meta?: CoachMeta }>(
      "/api/coach/chat",
      {
        method: "POST",
        body: JSON.stringify({ message, goalId, skillIds }),
      },
    ),

  getCoachMessages: (goalId?: string) =>
    request<{
      messages: {
        id: number;
        goalId: string | null;
        role: "user" | "coach";
        text: string;
        timestamp: string;
      }[];
    }>(goalId ? `/api/coach/messages?goalId=${goalId}` : "/api/coach/messages"),

  startGoal: (id: string) =>
    request<{ goal: Goal }>(`/api/goals/${id}/start`, { method: "POST" }),

  approveGoal: (id: string) =>
    request<{ goal: Goal }>(`/api/goals/${id}/approve`, { method: "POST" }),

  reworkGoal: (id: string, reason?: string) =>
    request<{ goal: Goal }>(`/api/goals/${id}/rework`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),

  cancelGoal: (id: string) =>
    request<{ goal: Goal }>(`/api/goals/${id}/cancel`, { method: "POST" }),

  deleteGoal: (id: string) =>
    request<{ deleted: string[]; failed: { id: string; error: string }[] }>(
      `/api/goals/${id}`,
      { method: "DELETE" },
    ),

  batchGoals: (action: "start" | "cancel" | "approve" | "delete", ids: string[]) =>
    request<{ ok: string[]; failed: { id: string; error: string }[] }>(
      "/api/goals/batch",
      {
        method: "POST",
        body: JSON.stringify({ action, ids }),
      },
    ),

  getSettings: () => request<SettingsResponse>("/api/settings"),

  putSettings: (settings: Settings) =>
    request<SettingsResponse>("/api/settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),

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
};

export type EventConnectionHandlers = {
  onEvent: (e: SseEvent) => void;
  onOpen?: () => void;
  onError?: () => void;
  onGap?: (reason: string, pending?: number) => void;
};

export function connectEvents(handlers: EventConnectionHandlers | ((e: SseEvent) => void)): () => void {
  const { onEvent, onOpen, onError, onGap } =
    typeof handlers === "function" ? { onEvent: handlers } : handlers;

  const es = new EventSource(`${BASE}/api/events`);

  const handler = (ev: MessageEvent) => {
    try {
      const data = JSON.parse(ev.data as string) as SseEvent | { type: string };
      if (data.type === "connected") {
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
    try {
      const data = JSON.parse(ev.data as string) as { reason?: string; pending?: number };
      onGap?.(data.reason ?? "unknown", data.pending);
    } catch {
      onGap?.("unknown");
    }
  });
  es.onmessage = handler;

  return () => es.close();
}
