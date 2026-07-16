import {
  canMutateGoal,
  goalMutationDeniedMessage,
  isPausedGoal,
  isPrivilegedTaskSource,
  type Goal,
  type TaskCommand,
} from "@openx/shared";
import {
  appendLog,
  areDependenciesMet,
  getGoalById,
  updateGoal,
  updateGoalCrewBinding,
  GoalRevisionConflictError,
} from "./db.js";
import { approveGoal, reworkGoal } from "./goal-actions.js";
import {
  cancelGoalStatus,
  claimGoalForDispatch,
  parkGoalAsPaused,
  type LifecycleResult,
} from "./goal-lifecycle.js";
import {
  cancelRunning,
  dispatchGoal,
  resumeCrewAfterUserDecision,
} from "./orchestrator.js";
import { narrateGoalChange } from "./narration.js";
import { broadcast } from "./sse.js";

export type TaskCommandResult =
  | {
      ok: true;
      goal: Goal;
      mode?: "steer" | "restart";
      idempotentReplay?: boolean;
    }
  | {
      ok: false;
      status: 400 | 403 | 404 | 409;
      error: string;
      gateReasons?: import("@openx/shared").GoalGateReason[];
      currentRevision?: number;
    };

type CachedCommandResult = TaskCommandResult & { cachedAt: number };

const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
const idempotencyCache = new Map<string, CachedCommandResult>();

function cacheKey(cmd: TaskCommand): string | null {
  if (!cmd.idempotencyKey?.trim()) return null;
  return `${cmd.goalId}:${cmd.type}:${cmd.idempotencyKey.trim()}`;
}

function pruneIdempotencyCache(now = Date.now()): void {
  for (const [key, value] of idempotencyCache) {
    if (now - value.cachedAt > IDEMPOTENCY_TTL_MS) {
      idempotencyCache.delete(key);
    }
  }
}

function rememberResult(cmd: TaskCommand, result: TaskCommandResult): TaskCommandResult {
  const key = cacheKey(cmd);
  if (!key || !result.ok) return result;
  pruneIdempotencyCache();
  idempotencyCache.set(key, { ...result, cachedAt: Date.now() });
  return result;
}

function fromLifecycle(result: LifecycleResult): TaskCommandResult {
  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      error: result.error,
      currentRevision: result.currentRevision,
    };
  }
  return { ok: true, goal: result.goal };
}

function assertActor(cmd: TaskCommand, goal: Goal): TaskCommandResult | null {
  if (isPrivilegedTaskSource(cmd.source)) return null;
  if (canMutateGoal(cmd.actor, goal)) return null;
  return { ok: false, status: 403, error: goalMutationDeniedMessage() };
}

async function runPublish(_cmd: TaskCommand, goal: Goal): Promise<TaskCommandResult> {
  if (goal.status === "running") {
    return { ok: true, goal };
  }
  if (!areDependenciesMet(goal)) {
    return {
      ok: false,
      status: 409,
      error: "Dependencies not completed",
    };
  }
  const fromStatuses =
    goal.status === "failed" ? (["failed"] as const) : (["draft", "failed"] as const);
  const claimed = claimGoalForDispatch(goal.id, [...fromStatuses]);
  if (!claimed) {
    return { ok: false, status: 400, error: `Cannot start from ${goal.status}` };
  }
  if (goal.status === "failed") {
    try {
      const cleared = {
        ...claimed,
        effectStatus: undefined,
        reworkReason: undefined,
        updatedAt: new Date().toISOString(),
      };
      const saved = updateGoal(cleared);
      broadcast({ type: "goal.updated", goal: saved });
      narrateGoalChange(saved, "start");
      appendLog(saved.id, "info", `失败任务重试，执行器：${saved.executorId}`);
      void dispatchGoal(saved.id);
      return { ok: true, goal: saved };
    } catch (err) {
      if (err instanceof GoalRevisionConflictError) {
        return {
          ok: false,
          status: 409,
          error: "Goal revision conflict",
          currentRevision: err.currentRevision,
        };
      }
      throw err;
    }
  }
  broadcast({ type: "goal.updated", goal: claimed });
  narrateGoalChange(claimed, "start");
  appendLog(claimed.id, "info", `任务启动，执行器：${claimed.executorId}`);
  void dispatchGoal(claimed.id);
  return { ok: true, goal: claimed };
}

async function runPause(cmd: TaskCommand, goal: Goal): Promise<TaskCommandResult> {
  if (isPausedGoal(goal)) {
    return { ok: true, goal };
  }
  if (goal.status !== "running") {
    return { ok: false, status: 400, error: `无法从 ${goal.status} 暂停` };
  }
  cancelRunning(goal.id);
  return fromLifecycle(parkGoalAsPaused(goal.id, cmd.reason));
}

async function runResume(cmd: TaskCommand, _goal: Goal): Promise<TaskCommandResult> {
  const decision = cmd.userDecision?.trim() ?? cmd.reason?.trim() ?? "";
  if (!decision) {
    return { ok: false, status: 400, error: "回复不能为空" };
  }

  const resumed = await resumeCrewAfterUserDecision(cmd.goalId, decision);
  if (!resumed.ok) {
    return { ok: false, status: 400, error: resumed.error ?? "续跑失败" };
  }
  const updated = getGoalById(cmd.goalId);
  if (!updated) return { ok: false, status: 404, error: "Not found" };
  appendLog(cmd.goalId, "info", `开发商决策已注入并续跑（来源：${cmd.source}）`);
  narrateGoalChange(updated, "resume");
  // 确保 crew 绑定已清 idle（resumeCrewAfterUserDecision 内已处理）
  if (updated.crewStatus === "awaiting_user") {
    updateGoalCrewBinding(cmd.goalId, { crewStatus: "idle" });
  }
  return { ok: true, goal: getGoalById(cmd.goalId) ?? updated };
}

async function runCancel(cmd: TaskCommand, goal: Goal): Promise<TaskCommandResult> {
  cancelRunning(goal.id);
  return fromLifecycle(
    cancelGoalStatus(goal.id, {
      reason: cmd.reason,
      source: cmd.source,
    }),
  );
}

async function runApprove(cmd: TaskCommand, _goal: Goal): Promise<TaskCommandResult> {
  const result = approveGoal(cmd.goalId, {
    source: cmd.source === "auto_policy" ? "auto" : "user",
  });
  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      error: result.error,
      gateReasons: result.gateReasons,
      currentRevision: result.currentRevision,
    };
  }
  return { ok: true, goal: result.goal };
}

async function runRework(cmd: TaskCommand, _goal: Goal): Promise<TaskCommandResult> {
  const result = await reworkGoal(cmd.goalId, cmd.reworkReason ?? cmd.reason, {
    source: cmd.source === "auto_policy" ? "auto" : "user",
  });
  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      error: result.error,
      currentRevision: result.currentRevision,
    };
  }
  return { ok: true, goal: result.goal, mode: result.mode };
}

/**
 * 统一任务命令入口：ACL → 幂等 → 生命周期委托。
 * system / auto_policy 可绕过会话 ACL（服务端内部策略用）。
 */
export async function executeTaskCommand(cmd: TaskCommand): Promise<TaskCommandResult> {
  pruneIdempotencyCache();
  const key = cacheKey(cmd);
  if (key) {
    const cached = idempotencyCache.get(key);
    if (cached && Date.now() - cached.cachedAt <= IDEMPOTENCY_TTL_MS) {
      if (cached.ok === true) {
        const replay: TaskCommandResult = {
          ok: true,
          goal: cached.goal,
          mode: cached.mode,
          idempotentReplay: true,
        };
        return replay;
      }
      const failed: TaskCommandResult = {
        ok: false,
        status: cached.status,
        error: cached.error,
        gateReasons: cached.gateReasons,
        currentRevision: cached.currentRevision,
      };
      return failed;
    }
  }

  const goal = getGoalById(cmd.goalId);
  if (!goal) return { ok: false, status: 404, error: "Not found" };

  const denied = assertActor(cmd, goal);
  if (denied) return denied;

  let result: TaskCommandResult;
  switch (cmd.type) {
    case "publish":
      result = await runPublish(cmd, goal);
      break;
    case "pause":
      result = await runPause(cmd, goal);
      break;
    case "resume":
      result = await runResume(cmd, goal);
      break;
    case "cancel":
      result = await runCancel(cmd, goal);
      break;
    case "approve":
      result = await runApprove(cmd, goal);
      break;
    case "rework":
      result = await runRework(cmd, goal);
      break;
    default: {
      const _exhaustive: never = cmd.type;
      result = { ok: false, status: 400, error: `未知命令：${_exhaustive}` };
    }
  }

  return rememberResult(cmd, result);
}

/** 测试辅助：清空幂等缓存 */
export function clearTaskCommandIdempotencyCache(): void {
  idempotencyCache.clear();
}
