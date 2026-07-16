import { Hono } from "hono";
import {
  IslandPushBroadcastRequestSchema,
  IslandPushGoalRequestSchema,
  islandForAwaitingReview,
  islandForFailed,
  islandForGateBlocked,
  islandForReviewBlocked,
  islandForReviewLimit,
  islandForReviewUnavailable,
  islandFromSimpleBroadcast,
} from "@openx/shared";
import { getGoalById, listGoals, listTokenUsageByGoal, sumTokenUsageByGoal } from "../db.js";
import { pushIsland } from "../island-push.js";
import { listConnections } from "../connect-store.js";
import {
  ensureSystemMainConversation,
  SYSTEM_MAIN_CONVERSATION_ID,
} from "../system-workspace.js";
import { loadSettings } from "../settings-store.js";
import { resolveSystemWorkspaceRoot } from "../system-workspace-path.js";
import { internalOnly } from "../internal-auth.js";
import {
  createOpenxBackup,
  exportOpenxData,
  factoryResetOpenx,
  getPersistenceHealth,
  importOpenxData,
  listOpenxBackups,
  runDbVacuum,
} from "../openx-backup.js";
import { pruneRetentionTables } from "../db/retention.js";

export const systemRoutes = new Hono();

/**
 * 推送灵动岛：internal scoped。
 * - 目标类：{ goalId, eventType, reason?, iteration? }
 * - broadcast：受限字段，无 approve/rework
 */
systemRoutes.post("/island/push", internalOnly, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const goalReq = IslandPushGoalRequestSchema.safeParse(body);
  if (goalReq.success) {
    const goal = getGoalById(goalReq.data.goalId);
    if (!goal) return c.json({ error: "Goal not found" }, 404);
    const { eventType, reason, iteration } = goalReq.data;
    let payload;
    switch (eventType) {
      case "awaiting_review":
        payload = islandForAwaitingReview(goal);
        break;
      case "review_limit":
        payload = islandForReviewLimit(
          goal,
          reason ?? "仍需修改",
          iteration ?? goal.iterationCount ?? 0,
        );
        break;
      case "review_blocked":
        payload = islandForReviewBlocked(goal, reason ?? "审查阻塞");
        break;
      case "review_unavailable":
        payload = islandForReviewUnavailable(goal, reason);
        break;
      case "failed":
        payload = islandForFailed(goal, reason);
        break;
      case "gate_blocked":
        payload = islandForGateBlocked(goal, reason ?? "门禁阻塞");
        break;
      default:
        return c.json({ error: "未知 eventType" }, 400);
    }
    pushIsland(payload);
    return c.json({ ok: true, id: payload.id });
  }

  const broadcastReq = IslandPushBroadcastRequestSchema.safeParse(body);
  if (broadcastReq.success) {
    const payload = islandFromSimpleBroadcast(
      broadcastReq.data.id,
      broadcastReq.data.message,
      {
        title: broadcastReq.data.title,
        goalId: broadcastReq.data.goalId,
        severity: broadcastReq.data.severity,
        autoDismissMs: broadcastReq.data.autoDismissMs,
      },
    );
    pushIsland(payload);
    return c.json({ ok: true, id: payload.id });
  }

  return c.json(
    {
      error:
        "无效请求：目标类需 { goalId, eventType }；广播需 { kind:'broadcast', id, title, message }",
    },
    400,
  );
});

/** 调度台快照：同步 DB + Connect 内存表，不触发 detectExecutors（执行器列表由 /api/executors 提供） */
systemRoutes.get("/console", (c) => {
  const settings = loadSettings();
  const systemWorkspace = resolveSystemWorkspaceRoot(settings);
  const { project, conversation } = ensureSystemMainConversation();
  const connections = listConnections();

  const systemGoals = listGoals({ conversationId: SYSTEM_MAIN_CONVERSATION_ID });
  const systemRunning = systemGoals.filter((g) => g.status === "running").length;
  const systemAwaitingReview = systemGoals.filter(
    (g) => g.status === "awaiting_review",
  ).length;

  const allAwaitingReview = listGoals("awaiting_review");
  const crossProjectAwaitingReview = allAwaitingReview.filter(
    (g) => g.conversationId !== SYSTEM_MAIN_CONVERSATION_ID,
  );
  const allRunning = listGoals("running");
  const crossProjectRunning = allRunning.filter(
    (g) => g.conversationId !== SYSTEM_MAIN_CONVERSATION_ID,
  );

  return c.json({
    project,
    conversation,
    connections,
    systemWorkspace,
    stats: {
      systemRunning,
      systemAwaitingReview,
      crossProjectAwaitingReview: crossProjectAwaitingReview.length,
      crossProjectRunning: crossProjectRunning.length,
    },
    crossProjectReviewGoals: crossProjectAwaitingReview.slice(0, 20),
    systemGoals,
    allGoals: listGoals(),
  });
});

systemRoutes.get("/stats/tokens", (c) => {
  const goalId = c.req.query("goalId");
  if (!goalId?.trim()) {
    return c.json({ error: "goalId required" }, 400);
  }
  if (!getGoalById(goalId)) return c.json({ error: "Not found" }, 404);
  const summary = sumTokenUsageByGoal(goalId);
  const events = listTokenUsageByGoal(goalId, 50);
  return c.json({ goalId, summary, events });
});

/** 本地持久化健康状态（含 DB integrity） */
systemRoutes.get("/persistence/health", (c) => {
  return c.json(getPersistenceHealth());
});

systemRoutes.get("/persistence/backups", (c) => {
  return c.json({ backups: listOpenxBackups() });
});

systemRoutes.post("/persistence/backup", (c) => {
  const label =
    typeof c.req.query("label") === "string" ? c.req.query("label")!.trim() : undefined;
  const manifest = createOpenxBackup({ label: label || undefined });
  return c.json({ ok: true, backup: manifest });
});

systemRoutes.post("/persistence/export", (c) => {
  const result = exportOpenxData({ label: "export" });
  return c.json({ ok: true, ...result });
});

systemRoutes.post("/persistence/import", async (c) => {
  let body: { backupId?: string } = {};
  try {
    body = (await c.req.json()) as { backupId?: string };
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const backupId = body.backupId?.trim();
  if (!backupId) return c.json({ error: "backupId required" }, 400);
  try {
    const manifest = importOpenxData(backupId);
    return c.json({
      ok: true,
      backup: manifest,
      restartRequired: true,
      message: "导入完成，请重启 OpenX 服务以加载恢复后的数据",
    });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      404,
    );
  }
});

systemRoutes.post("/persistence/factory-reset", async (c) => {
  let body: { confirm?: string; keepBackups?: boolean } = {};
  try {
    body = (await c.req.json()) as { confirm?: string; keepBackups?: boolean };
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  if (body.confirm !== "RESET") {
    return c.json({ error: "请传 confirm: \"RESET\" 以确认工厂重置" }, 400);
  }
  const result = factoryResetOpenx({ keepBackups: body.keepBackups !== false });
  return c.json({
    ok: true,
    ...result,
    restartRequired: true,
    message: "已清空本地数据，请重启 OpenX 服务",
  });
});

systemRoutes.post("/persistence/prune", (c) => {
  const result = pruneRetentionTables();
  return c.json({ ok: true, pruned: result });
});

systemRoutes.post("/persistence/vacuum", (c) => {
  runDbVacuum();
  return c.json({ ok: true });
});
