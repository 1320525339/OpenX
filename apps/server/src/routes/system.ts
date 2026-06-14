import { Hono } from "hono";
import { DynamicIslandPayloadSchema } from "@openx/shared";
import { listGoals } from "../db.js";
import { pushIsland } from "../island-push.js";
import { listConnections } from "../connect-store.js";
import {
  ensureSystemMainConversation,
  SYSTEM_MAIN_CONVERSATION_ID,
} from "../system-workspace.js";
import { loadSettings } from "../settings-store.js";
import { resolveSystemWorkspaceRoot } from "../system-workspace-path.js";

export const systemRoutes = new Hono();

/** 内外部统一协议：推送灵动岛卡片 */
systemRoutes.post("/island/push", async (c) => {
  const body = await c.req.json();
  const payload = DynamicIslandPayloadSchema.parse(body);
  pushIsland(payload);
  return c.json({ ok: true, id: payload.id });
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
