import { formatFeedbackNotes } from "@openx/coach";
import {
  ACP_RUNTIMES,
  GOAL_STATUS_LABELS,
  SYSTEM_MAIN_CONVERSATION_ID,
  type CoachChatContext,
  type CoachGoalBrief,
  type Goal,
} from "@openx/shared";
import {
  buildGoalFeedback,
  getGoalById,
  getWorkspaceDirForConversation,
  listChildGoals,
  listGoals,
} from "./db.js";
import { loadSettings } from "./settings-store.js";
import { listConnections } from "./connect-store.js";
import { resolveWorkspaceRoot } from "./workspace-path.js";
import { buildExecutorSkillsMap } from "./executor-recommend-service.js";
import { gatherContextPack, shouldGatherProjectContext } from "./context-pack.js";
import { COACH_MCP_CATALOG } from "@openx/shared";
import { resolveSystemWorkspaceRoot } from "./system-workspace-path.js";
import { resolveCoachAgent } from "./agents-service.js";

function buildExecutorsList(): string[] {
  const executors = new Set<string>(["pi"]);
  for (const id of Object.keys(ACP_RUNTIMES)) {
    executors.add(id);
  }
  for (const conn of listConnections()) {
    executors.add(`connect:${conn.agentName} (${conn.executorId})`);
  }
  return [...executors];
}

function toBrief(goal: Goal): CoachGoalBrief {
  return {
    id: goal.id,
    title: goal.title,
    status: GOAL_STATUS_LABELS[goal.status],
    progress: goal.progress,
    executorId: goal.executorId,
    acceptance: goal.acceptance,
    resultSummary: goal.resultSummary,
  };
}

/** 从选中 Goal 向上找到核心目标（根 Goal），限定在同一对话内 */
export function resolveNorthStarGoal(goalId?: string): Goal | undefined {
  if (goalId) {
    let current = getGoalById(goalId);
    if (!current) return undefined;
    const conversationId = current.conversationId;
    while (current.parentGoalId) {
      const parent = getGoalById(current.parentGoalId);
      if (!parent || parent.conversationId !== conversationId) break;
      current = parent;
    }
    return current;
  }

  return undefined;
}

function buildSystemGoalsSummary(): string {
  const all = listGoals();
  const byStatus = new Map<string, number>();
  for (const g of all) {
    byStatus.set(g.status, (byStatus.get(g.status) ?? 0) + 1);
  }
  const statusLine = [...byStatus.entries()]
    .map(([s, n]) => `${GOAL_STATUS_LABELS[s as Goal["status"]] ?? s}: ${n}`)
    .join(" · ");
  const recent = all.slice(0, 8);
  const recentLines = recent
    .map((g) => `· ${g.title} [${GOAL_STATUS_LABELS[g.status]}] (${g.executorId})`)
    .join("\n");
  return [statusLine || "暂无任务", recentLines].filter(Boolean).join("\n\n");
}

function buildSystemContextPack(settings: ReturnType<typeof loadSettings>): CoachChatContext["contextPack"] {
  const systemDir = resolveSystemWorkspaceRoot(settings);
  const connections = listConnections();
  const connLines =
    connections.length === 0
      ? "当前无 Connect 心跳连接（任务池 connect:any 需 Connect 客户端）"
      : connections
          .map(
            (c) =>
              `· ${c.agentName} (${c.executorId}) · 最近心跳 ${c.lastHeartbeatAt}`,
          )
          .join("\n");
  const agentLines = buildExecutorsList()
    .map((id) => `· ${id}`)
    .join("\n");
  const profiles = (settings.cliProfiles ?? [])
    .filter((p) => p.kind === "connect")
    .map((p) => `· ${p.displayName} (${p.executorId})`)
    .join("\n");
  return {
    root: "OpenX 系统调度台",
    fileTree: [
      "【系统工程工作目录】",
      systemDir,
      "Skills：.openx/skills · Agents：.openx/agents · MCP：.mcp.json",
      "",
      "【Connect 心跳连接】",
      connLines,
      "",
      "【可用执行器（含 ACP 本机就绪 / Pi 内嵌）】",
      agentLines || "无",
      "",
      "【已配置 Connect Profile】",
      profiles || "无",
    ].join("\n"),
    keyFiles: [],
    generatedAt: new Date().toISOString(),
  };
}

export function buildCoachChatContext(
  conversationId: string,
  goalId?: string,
  opts?: {
    message?: string;
    mcpIds?: string[];
    agentId?: string;
  },
): CoachChatContext {
  const settings = loadSettings();
  const isSystemMain = conversationId === SYSTEM_MAIN_CONVERSATION_ID;

  const goals = listGoals({ conversationId });
  const summary = isSystemMain
    ? buildSystemGoalsSummary()
    : goals
        .slice(0, 12)
        .map((g) => {
          const indent = g.parentGoalId ? "  ↳ " : "· ";
          return `${indent}${g.title} [${GOAL_STATUS_LABELS[g.status]}] ${g.progress}% (${g.executorId})`;
        })
        .join("\n");

  const selected = goalId ? getGoalById(goalId) : undefined;
  const northStarGoal = resolveNorthStarGoal(goalId);
  const subGoals = northStarGoal
    ? listChildGoals(northStarGoal.id).map(toBrief)
    : [];
  const feedback = goalId ? buildGoalFeedback(goalId) : undefined;

  const projectDir = getWorkspaceDirForConversation(conversationId);
  const workspaceRoot = isSystemMain
    ? resolveSystemWorkspaceRoot(settings)
    : projectDir
      ? resolveWorkspaceRoot(projectDir)
      : resolveSystemWorkspaceRoot(settings);

  let contextPack: CoachChatContext["contextPack"];
  if (isSystemMain) {
    contextPack = buildSystemContextPack(settings);
  } else if (opts?.message && shouldGatherProjectContext(opts.message)) {
    contextPack = gatherContextPack(workspaceRoot) ?? undefined;
  }

  const enabledMcps = opts?.mcpIds?.length
    ? COACH_MCP_CATALOG.filter((m) => opts.mcpIds!.includes(m.id)).map((m) => ({
        id: m.id,
        name: m.name,
      }))
    : undefined;

  const coachAgent = resolveCoachAgent(opts?.agentId);

  return {
    goalsSummary: summary || undefined,
    northStar: northStarGoal ? toBrief(northStarGoal) : undefined,
    subGoals: subGoals.length > 0 ? subGoals : undefined,
    selectedGoal: selected ? toBrief(selected) : undefined,
    feedbackNotes: formatFeedbackNotes(feedback),
    workspaceRoot,
    executors: buildExecutorsList(),
    executorSkills: buildExecutorSkillsMap(settings),
    defaultConstraints:
      settings.defaultConstraints.length > 0
        ? settings.defaultConstraints
        : undefined,
    contextPack,
    enabledMcps,
    agentId: coachAgent.id,
    agentName: coachAgent.name,
    agentRolePrompt: coachAgent.rolePrompt,
  };
}
