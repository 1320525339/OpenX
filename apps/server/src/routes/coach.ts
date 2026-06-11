import { Hono } from "hono";
import {
  refineGoal,
  coachChatReply,
  coachContinueAfterWorkOrderTool,
  getCoachRuntime,
  testCoachConnection,
} from "@openx/coach";
import {
  RefineInputSchema,
  CoachChatInputSchema,
  RefinedWorkOrderRespondSchema,
  WORK_ORDER_TOOL_NAME,
  coachRecordsToChatTurns,
  isAmbiguousTaskMessage,
  isWorkOrderDismissMessage,
  listLlmProviderTemplates,
  shouldUseCoachStreaming,
  classifyCoachIntent,
} from "@openx/shared";
import {
  saveCoachMessage,
  saveCoachRefinedMessage,
  saveCoachToolResultMessage,
  listCoachMessages,
  getCoachMessageById,
  hasWorkOrderToolResult,
  getConversationById,
  updateConversation,
} from "../db.js";
import { loadSettings } from "../settings-store.js";
import { broadcast } from "../sse.js";
import { buildCoachChatContext } from "../coach-context.js";
import { listSkillCatalog, loadSkillManifest } from "../skills-service.js";
import { backfillRefinedGoal } from "../refined-backfill.js";
import { createCoachStreamBroadcaster } from "../coach-stream.js";

export const coachRoutes = new Hono();

coachRoutes.get("/providers", (c) => {
  return c.json({ providers: listLlmProviderTemplates() });
});

coachRoutes.get("/status", (c) => {
  const settings = loadSettings();
  const runtime = getCoachRuntime(settings);
  return c.json({
    ...runtime,
    providerId: runtime.slug,
    baseUrl: runtime.baseUrl,
  });
});

coachRoutes.post("/test", async (c) => {
  const settings = loadSettings();
  const runtime = getCoachRuntime(settings);
  if (!runtime.ready) {
    return c.json({
      ok: false,
      error: "渠道未就绪：请配置 API Key 或选择 OpenCode Zen",
      providerId: runtime.slug,
    });
  }
  const result = await testCoachConnection(settings);
  return c.json({
    ...result,
    providerId: runtime.slug,
    model: runtime.model,
    baseUrl: runtime.baseUrl,
  });
});

coachRoutes.post("/refine", async (c) => {
  const input = RefineInputSchema.parse(await c.req.json());
  const settings = loadSettings();
  const { refined, llmError, quotaExceeded } = await refineGoal(
    input,
    settings,
    settings.defaultConstraints,
  );
  return c.json({
    ...refined,
    meta: { llmError, quotaExceeded },
  });
});

coachRoutes.get("/messages", (c) => {
  const conversationId = c.req.query("conversationId");
  if (!conversationId) {
    return c.json({ error: "conversationId 必填" }, 400);
  }
  if (!getConversationById(conversationId)) {
    return c.json({ error: "Conversation not found" }, 404);
  }
  const messages = listCoachMessages(conversationId);
  return c.json({ messages });
});

function maybeAutoTitleConversation(
  conversationId: string,
  userMessage: string,
): void {
  const conv = getConversationById(conversationId);
  if (!conv || conv.title !== "新对话") return;
  const trimmed = userMessage.trim().replace(/\s+/g, " ");
  if (!trimmed) return;
  const title = trimmed.length > 28 ? `${trimmed.slice(0, 28)}…` : trimmed;
  updateConversation({
    ...conv,
    title,
    updatedAt: new Date().toISOString(),
  });
}

coachRoutes.post("/refined/:messageId/respond", async (c) => {
  try {
    const messageId = Number(c.req.param("messageId"));
    if (!Number.isFinite(messageId)) {
      return c.json({ error: "无效的消息 id" }, 400);
    }
    const input = RefinedWorkOrderRespondSchema.parse(await c.req.json());
    if (!getConversationById(input.conversationId)) {
      return c.json({ error: "Conversation not found" }, 404);
    }
    const refinedRow = getCoachMessageById(messageId);
    if (
      !refinedRow ||
      refinedRow.kind !== "refined" ||
      refinedRow.conversationId !== input.conversationId
    ) {
      return c.json({ error: "任务单不存在" }, 404);
    }
    if (refinedRow.linkedGoalId && input.outcome === "dismissed") {
      return c.json({ error: "任务单已创建，无法取消" }, 409);
    }
    if (hasWorkOrderToolResult(input.conversationId, messageId)) {
      return c.json({ error: "该任务单已处理" }, 409);
    }

    const toolResult = saveCoachToolResultMessage(input.conversationId, {
      toolName: WORK_ORDER_TOOL_NAME,
      refinedMessageId: messageId,
      outcome: input.outcome,
      title: refinedRow.refined.title,
      dismissed: input.outcome === "dismissed",
      goalId: input.goalId,
    });

    const settings = loadSettings();
    const priorMessages = listCoachMessages(input.conversationId, 24).filter(
      (m) => m.id <= toolResult.id,
    );
    const chatHistory = coachRecordsToChatTurns(priorMessages);
    const ctx = buildCoachChatContext(input.conversationId, input.goalId);

    const stream = createCoachStreamBroadcaster(input.conversationId);
    let message: string;
    let llmError: string | undefined;
    let quotaExceeded: boolean | undefined;
    try {
      const reply = await coachContinueAfterWorkOrderTool(
        toolResult.toolResult,
        ctx,
        settings,
        chatHistory,
        undefined,
        { onDelta: stream.onDelta },
      );
      message = reply.message;
      llmError = reply.llmError;
      quotaExceeded = reply.quotaExceeded;
      stream.flushPending();
    } catch (err) {
      stream.abort();
      throw err;
    }

    saveCoachMessage(input.conversationId, "coach", message);
    const payload = {
      type: "coach.reply" as const,
      conversationId: input.conversationId,
      message,
      intent: "consult" as const,
      meta: { llmError, quotaExceeded },
      timestamp: new Date().toISOString(),
    };
    broadcast(payload);
    stream.end();
    broadcast({
      type: "coach.message",
      conversationId: input.conversationId,
      message: toolResult,
    });
    return c.json({ ...payload, toolResult });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[coach] /refined/respond failed:", err);
    return c.json({ error: msg }, 500);
  }
});

coachRoutes.post("/chat", async (c) => {
  try {
    const input = CoachChatInputSchema.parse(await c.req.json());
    if (!getConversationById(input.conversationId)) {
      return c.json({ error: "Conversation not found" }, 404);
    }
    const settings = loadSettings();
    const chatHistory = coachRecordsToChatTurns(
      listCoachMessages(input.conversationId, 24),
    );
    if (!input.forceRefine) {
      saveCoachMessage(input.conversationId, "user", input.message);
      maybeAutoTitleConversation(input.conversationId, input.message);
    }
    const ctx = buildCoachChatContext(input.conversationId, input.goalId, {
      message: input.message,
      mcpIds: input.mcpIds,
      agentId: input.agentId,
    });
    if (input.skillIds?.length) {
      const catalog = listSkillCatalog(loadSkillManifest());
      ctx.enabledSkills = catalog
        .filter((s) => input.skillIds!.includes(s.id))
        .map((s) => ({ id: s.id, name: s.name, desc: s.desc }));
    }
    const intentHint = classifyCoachIntent(input.message);
    const skipRefine =
      input.skipRefine === true || isWorkOrderDismissMessage(input.message);
    const willStream =
      !input.forceRefine &&
      (skipRefine ||
        isAmbiguousTaskMessage(input.message) ||
        shouldUseCoachStreaming(input.message, intentHint));
    const stream = createCoachStreamBroadcaster(input.conversationId);
    const onDelta = willStream ? stream.onDelta : undefined;

    let message: string;
    let rawRefined: Awaited<ReturnType<typeof coachChatReply>>["refined"];
    let intent: Awaited<ReturnType<typeof coachChatReply>>["intent"];
    let suggestRefine: boolean | undefined;
    let llmError: string | undefined;
    let quotaExceeded: boolean | undefined;

    try {
      const reply = await coachChatReply(
        input.message,
        ctx,
        settings,
        settings.defaultConstraints,
        undefined,
        chatHistory,
        { onDelta, forceRefine: input.forceRefine, skipRefine },
      );
      message = reply.message;
      rawRefined = skipRefine ? undefined : reply.refined;
      intent = reply.intent ?? intentHint;
      suggestRefine = reply.suggestRefine;
      llmError = reply.llmError;
      quotaExceeded = reply.quotaExceeded;
      if (willStream) stream.flushPending();
    } catch (err) {
      if (willStream) stream.abort();
      throw err;
    }

    let refined = rawRefined;
    if (refined) {
      refined = await backfillRefinedGoal(refined, {
        settings,
        userDraft: input.message,
        dispatch: {
          agentId: input.agentId,
          mcpIds: input.mcpIds,
          skillIds: input.skillIds,
        },
      });
    }

    saveCoachMessage(input.conversationId, "coach", message);
    if (refined) {
      const refinedMsg = saveCoachRefinedMessage(input.conversationId, refined);
      broadcast({
        type: "coach.message",
        conversationId: input.conversationId,
        message: refinedMsg,
      });
    }
    const payload = {
      type: "coach.reply" as const,
      conversationId: input.conversationId,
      message,
      intent,
      refined,
      suggestRefine,
      meta: { llmError, quotaExceeded },
      timestamp: new Date().toISOString(),
    };
    broadcast(payload);
    if (willStream) stream.end();
    return c.json(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[coach] /chat failed:", err);
    return c.json({ error: msg }, 500);
  }
});
