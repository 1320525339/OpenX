import {
  getExecutor,
  resolveExecutor,
  registerExecutor,
  resetExecutorRegistry,
} from "@openx/executor-core";
import { acpExecutor, detectAcpRuntime } from "@openx/executor-acp";
import { createConnectExecutor } from "@openx/executor-connect";
import { pickExecutorWithPi, piExecutor } from "@openx/executor-pi";
import { mockExecutor } from "@openx/executor-mock";
import {
  ACP_RUNTIMES,
  EXECUTOR_AUTO,
  isConnectExecutorId,
  type AcpRuntimeId,
  type RunDeltaEvent,
} from "@openx/shared";
import { canTransition } from "@openx/shared";
import {
  appendLog,
  areDependenciesMet,
  getGoalById,
  listExecutionSummaries,
  listLogs,
  listRunnableDraftGoals,
  updateGoal,
} from "./db.js";
import {
  getConnectionByExecutorId,
  listConnections,
  markGoalCancelledForConnect,
  clearGoalCancelledForConnect,
} from "./connect-store.js";
import { narrateGoalChange } from "./narration.js";
import { loadSettings } from "./settings-store.js";
import { resolveWorkspaceRoot } from "./workspace-path.js";
import {
  isClearRuleWinner,
  recommendExecutorForGoal,
} from "./executor-recommend-service.js";
import { resolveExecutorSkills } from "./skills-resolve.js";
import {
  emitGoalRunEvent,
  endGoalRun,
  isRunActive,
  startGoalRun,
} from "./run-service.js";
import { broadcast } from "./sse.js";
import {
  markGoalComplete,
  markGoalFailed,
  updateGoalProgress,
} from "./goal-lifecycle.js";

let registered = false;
const dispatchLocks = new Set<string>();

/** 测试用：重置执行器注册，使 OPENX_MOCK_PI 等环境变量生效 */
export function resetOrchestrator(): void {
  registered = false;
  resetExecutorRegistry();
  dispatchLocks.clear();
}

function ensureExecutors() {
  if (!registered) {
    if (process.env.OPENX_MOCK_PI === "1") {
      registerExecutor({ ...mockExecutor, id: "pi", displayName: "Pi（Mock 测试）" });
    } else {
      registerExecutor(piExecutor);
    }
    registerExecutor(acpExecutor);
    registerExecutor(
      createConnectExecutor({
        getConnection: (executorId) => getConnectionByExecutorId(executorId),
        listConnections,
      }),
    );
    registered = true;
  }
}

function buildCallbacks(goalId: string) {
  return {
    onProgress: async (progress: number, message?: string) => {
      const g = getGoalById(goalId);
      if (!g || g.status !== "running") return;
      updateGoalProgress(goalId, progress, message);
    },
    onLog: async (level: "info" | "warn" | "error" | "debug", message: string) => {
      const log = appendLog(goalId, level, message);
      broadcast({ type: "log.append", goalId, ...log });
    },
    onRunEvent: async (event: RunDeltaEvent) => {
      emitGoalRunEvent(goalId, event);
    },
    onComplete: async (resultSummary: string) => {
      const g = getGoalById(goalId);
      if (!g || g.status !== "running") return;
      clearGoalCancelledForConnect(goalId);
      markGoalComplete(goalId, resultSummary);
    },
    onFail: async (errorMessage: string) => {
      const g = getGoalById(goalId);
      if (!g || g.status !== "running") return;
      clearGoalCancelledForConnect(goalId);
      markGoalFailed(goalId, errorMessage);
    },
  };
}

function buildExecutorContext(goalId: string, isRework?: boolean) {
  const goal = getGoalById(goalId);
  if (!goal) throw new Error("Goal not found");
  const settings = loadSettings();
  const priorLogs = listLogs(goalId, 30).map((l) => ({
    level: l.level,
    message: l.message,
  }));
  const priorSummaries = listExecutionSummaries(goalId, 3);
  const workspaceRoot = resolveWorkspaceRoot(settings.workspaceRoot);
  const { hints: enabledSkills } = resolveExecutorSkills(goal.executorId, settings);
  return {
    goal,
    workspaceRoot,
    settings: {
      pi: settings.executors.pi,
      model: settings.model,
      providers: settings.providers,
    },
    priorLogs,
    priorSummaries,
    isRework,
    enabledSkills,
    callbacks: buildCallbacks(goalId),
  };
}

/** 依赖已满足的 draft 子目标按优先级自动启动 */
export function tryDispatchDependents(completedGoalId: string): void {
  const settings = loadSettings();
  if (!settings.autoExecute) return;

  const candidates = listRunnableDraftGoals().filter((g) =>
    g.dependsOn.includes(completedGoalId),
  );

  for (const child of candidates) {
    if (!canTransition(child.status, "running")) continue;
    child.status = "running";
    child.progress = 0;
    child.updatedAt = new Date().toISOString();
    updateGoal(child);
    broadcast({ type: "goal.updated", goal: child });
    narrateGoalChange(child, "start");
    appendLog(child.id, "info", `依赖 ${completedGoalId} 已完成，自动启动`);
    void dispatchGoal(child.id);
  }
}

export async function steerReworkGoal(goalId: string): Promise<boolean> {
  ensureExecutors();
  const goal = getGoalById(goalId);
  if (!goal) return false;
  if (goal.executorId === EXECUTOR_AUTO) return false;

  const adapter = resolveExecutor(goal.executorId);
  if (!adapter?.steerRework) return false;

  try {
    if (isRunActive(goalId)) {
      appendLog(goalId, "warn", "返工 steer 跳过：已有活跃 run");
      return false;
    }
    startGoalRun(goalId, goal.executorId);
    const ctx = buildExecutorContext(goalId, true);
    return await adapter.steerRework(ctx);
  } catch (err) {
    endGoalRun(goalId, "failed", err instanceof Error ? err.message : String(err));
    appendLog(
      goalId,
      "error",
      `返工 steer 失败：${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

async function materializeAutoExecutor(goalId: string): Promise<void> {
  const goal = getGoalById(goalId);
  if (!goal || goal.executorId !== EXECUTOR_AUTO) return;

  const settings = loadSettings();
  const detected = await detectExecutors();

  const recommendation = await recommendExecutorForGoal(
    {
      title: goal.title,
      acceptance: goal.acceptance,
      executionPrompt: goal.executionPrompt,
    },
    detected,
  );

  let chosen: string;
  if (recommendation && isClearRuleWinner(recommendation)) {
    chosen = recommendation.executorId;
    appendLog(goalId, "info", `规则推荐执行器：${chosen}（${recommendation.reason}）`);
  } else {
    chosen = await pickExecutorWithPi({
      title: goal.title,
      acceptance: goal.acceptance,
      executionPrompt: goal.executionPrompt,
      workspaceRoot: resolveWorkspaceRoot(settings.workspaceRoot),
      candidates: detected
        .filter((e) => e.id !== EXECUTOR_AUTO)
        .map((e) => ({
          id: e.id,
          label: e.displayName,
          hint: e.hint,
          available: e.available,
        })),
      settings: {
        pi: settings.executors.pi,
        model: settings.model,
        providers: settings.providers,
      },
    });
    appendLog(goalId, "info", `Pi 自动选择执行器：${chosen}`);
  }

  goal.executorId = chosen;
  goal.updatedAt = new Date().toISOString();
  updateGoal(goal);
  broadcast({ type: "goal.updated", goal });
}

export async function dispatchGoal(goalId: string): Promise<void> {
  if (dispatchLocks.has(goalId) || isRunActive(goalId)) {
    appendLog(goalId, "warn", "派发跳过：该目标已有活跃执行");
    return;
  }

  dispatchLocks.add(goalId);
  try {
    ensureExecutors();
    const goal = getGoalById(goalId);
    if (!goal) throw new Error("Goal not found");

    if (!areDependenciesMet(goal)) {
      appendLog(
        goalId,
        "info",
        `等待依赖完成：${goal.dependsOn.join(", ")}`,
      );
      return;
    }

    if (goal.executorId === EXECUTOR_AUTO) {
      await materializeAutoExecutor(goalId);
    }

    const resolved = getGoalById(goalId);
    if (!resolved) throw new Error("Goal not found");

    if (resolved.status !== "running") {
      appendLog(goalId, "warn", `派发跳过：目标状态为 ${resolved.status}`);
      return;
    }

    const adapter = resolveExecutor(resolved.executorId);
    if (!adapter) {
      throw new Error(`Unknown executor: ${resolved.executorId}`);
    }

    clearGoalCancelledForConnect(goalId);
    const ctx = buildExecutorContext(goalId, resolved.effectStatus === "rework");
    startGoalRun(goalId, resolved.executorId);

    void adapter
      .run(ctx)
      .catch(async (err: Error) => {
        endGoalRun(goalId, "failed", err.message);
        const g = getGoalById(goalId);
        if (!g || g.status !== "running") return;
        markGoalFailed(goalId, err.message);
      });
  } finally {
    dispatchLocks.delete(goalId);
  }
}

export function cancelRunning(goalId: string): void {
  ensureExecutors();
  const goal = getGoalById(goalId);
  if (!goal) return;
  endGoalRun(goalId, "cancelled");
  if (isConnectExecutorId(goal.executorId)) {
    markGoalCancelledForConnect(goalId);
  }
  const adapter = resolveExecutor(goal.executorId);
  adapter?.cancel?.(goalId);
}

export async function detectExecutors() {
  ensureExecutors();
  const settings = loadSettings();
  const results: Array<{
    id: string;
    displayName: string;
    available: boolean;
    hint?: string;
  }> = [
    {
      id: EXECUTOR_AUTO,
      displayName: "自动（Pi 选择）",
      available: true,
      hint: "启动时由 Pi 根据任务与在线执行器自动派单",
    },
  ];

  const pi = getExecutor("pi");
  if (pi) {
    const det = await pi.detect({
      pi: settings.executors.pi,
      model: settings.model,
      providers: settings.providers,
    });
    results.push({ id: "pi", displayName: pi.displayName, ...det });
  }

  for (const runtimeId of Object.keys(ACP_RUNTIMES) as AcpRuntimeId[]) {
    const cfg = ACP_RUNTIMES[runtimeId];
    const det = await detectAcpRuntime(runtimeId);
    results.push({
      id: runtimeId,
      displayName: cfg.label,
      ...det,
    });
  }

  for (const conn of listConnections()) {
    results.push({
      id: conn.executorId,
      displayName: `Connect: ${conn.agentName}`,
      available: true,
      hint: `${conn.toolName} · 在线`,
    });
  }

  const onlineIds = new Set(listConnections().map((c) => c.executorId));
  const builtinIds = new Set(["pi", EXECUTOR_AUTO, ...Object.keys(ACP_RUNTIMES)]);
  for (const profile of settings.cliProfiles ?? []) {
    if (onlineIds.has(profile.executorId) || builtinIds.has(profile.executorId)) continue;
    results.push({
      id: profile.executorId,
      displayName: profile.displayName,
      available: false,
      hint: "已配置 · 未在线（可一键自举）",
    });
  }

  return results;
}
