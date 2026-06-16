import { Hono } from "hono";
import {
  refineGoal,
  coachChatReply,
  coachContinueAfterClarifyTool,
  coachContinueAfterWorkOrderTool,
  coachOperatorChatReply,
  getCoachRuntime,
  testCoachConnection,
} from "@openx/coach";
import {
  RefineInputSchema,
  CoachChatInputSchema,
  CoachClarifyRespondSchema,
  RefinedWorkOrderRespondSchema,
  CLARIFY_TOOL_NAME,
  WORK_ORDER_TOOL_NAME,
  type ClarifyToolResult,
  validateClarifyRespondInput,
  type WorkOrderToolResult,
  isWorkOrderDismissMessage,
  listLlmProviderTemplates,
  shouldTryLlmClarify,
  shouldUseCoachStreaming,
  classifyCoachIntent,
  DEFAULT_EXECUTION_AGENT_ID,
} from "@openx/shared";
import {
  saveCoachMessage,
  saveCoachClarifyMessage,
  saveCoachRefinedMessage,
  saveCoachToolResultMessage,
  updateCoachClarifyStatus,
  linkCoachClarifyToRefined,
  listCoachMessages,
  getCoachMessageById,
  hasWorkOrderToolResult,
  hasClarifyToolResult,
  getConversationById,
  updateConversation,
} from "../db.js";
import { loadSettings } from "../settings-store.js";
import { broadcast } from "../sse.js";
import { buildCoachChatContext } from "../coach-context.js";
import { attachBrowserDesktopContext } from "../coach-browser-context.js";
import { listSkillCatalog, loadSkillManifest } from "../skills-service.js";
import { backfillRefinedGoal } from "../refined-backfill.js";
import { createCoachStreamBroadcaster } from "../coach-stream.js";
import {
  createCoachOperatorGateway,
  shouldUseOperatorTools,
} from "../coach-operator-bridge.js";
import { saveCoachOperatorActionMessage } from "../coach-operator-messages.js";
import { prepareCoachThreadForPrompt } from "../coach-thread-service.js";

function loadCoachThreadContext(
  conversationId: string,
  opts?: { beforeMessageId?: number },
) {
  const prepared = prepareCoachThreadForPrompt(conversationId, {
    beforeMessageId: opts?.beforeMessageId,
  });
  return prepared;
}

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

    const pendingToolResult: WorkOrderToolResult = {
      toolName: WORK_ORDER_TOOL_NAME,
      refinedMessageId: messageId,
      outcome: input.outcome,
      title: refinedRow.refined.title,
      dismissed: input.outcome === "dismissed",
      goalId: input.goalId,
    };

    const settings = loadSettings();
    const prepared = loadCoachThreadContext(input.conversationId, {
      beforeMessageId: messageId,
    });
    const chatHistory = prepared.turns;
    const ctx = buildCoachChatContext(input.conversationId, input.goalId);
    ctx.coachThreadBlock = prepared.block || undefined;
    await attachBrowserDesktopContext(ctx, input.conversationId);

    const stream = createCoachStreamBroadcaster(input.conversationId);
    let message: string;
    let llmError: string | undefined;
    let quotaExceeded: boolean | undefined;
    try {
      const reply = await coachContinueAfterWorkOrderTool(
        pendingToolResult,
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

    const toolResult = saveCoachToolResultMessage(
      input.conversationId,
      pendingToolResult,
    );

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

coachRoutes.post("/clarify/:messageId/respond", async (c) => {
  try {
    const messageId = Number(c.req.param("messageId"));
    if (!Number.isFinite(messageId)) {
      return c.json({ error: "无效的消息 id" }, 400);
    }
    const input = CoachClarifyRespondSchema.parse(await c.req.json());
    if (!getConversationById(input.conversationId)) {
      return c.json({ error: "Conversation not found" }, 404);
    }
    const clarifyRow = getCoachMessageById(messageId);
    if (
      !clarifyRow ||
      clarifyRow.kind !== "clarify" ||
      clarifyRow.conversationId !== input.conversationId
    ) {
      return c.json({ error: "澄清卡不存在" }, 404);
    }
    if (hasClarifyToolResult(input.conversationId, messageId)) {
      return c.json({ error: "该澄清卡已处理" }, 409);
    }

    const validationError = validateClarifyRespondInput(clarifyRow.clarify, input);
    if (validationError) {
      return c.json({ error: validationError }, 400);
    }

    const pendingToolResult: ClarifyToolResult = {
      toolName: CLARIFY_TOOL_NAME,
      clarifyMessageId: messageId,
      outcome: input.outcome,
      answers: input.answers,
      annotations: input.annotations,
    };

    const settings = loadSettings();
    const prepared = loadCoachThreadContext(input.conversationId, {
      beforeMessageId: messageId,
    });
    const chatHistory = prepared.turns;
    const ctx = buildCoachChatContext(input.conversationId);
    ctx.coachThreadBlock = prepared.block || undefined;
    await attachBrowserDesktopContext(ctx, input.conversationId);

    const stream = createCoachStreamBroadcaster(input.conversationId);
    let message: string;
    let refined: Awaited<ReturnType<typeof coachContinueAfterClarifyTool>>["refined"];
    let llmError: string | undefined;
    let quotaExceeded: boolean | undefined;
    try {
      const reply = await coachContinueAfterClarifyTool(
        pendingToolResult,
        clarifyRow.clarify,
        ctx,
        settings,
        chatHistory,
        undefined,
        { onDelta: stream.onDelta },
      );
      message = reply.message;
      refined = reply.refined;
      llmError = reply.llmError;
      quotaExceeded = reply.quotaExceeded;
      stream.flushPending();
    } catch (err) {
      stream.abort();
      throw err;
    }

    const toolResult = saveCoachToolResultMessage(
      input.conversationId,
      pendingToolResult,
    );
    updateCoachClarifyStatus(
      messageId,
      input.outcome === "answered" ? "answered" : "dismissed",
    );

    saveCoachMessage(input.conversationId, "coach", message);
    if (refined) {
      refined = await backfillRefinedGoal(refined, {
        settings,
        userDraft: message,
        dispatch: {
          agentId: refined.agentId ?? DEFAULT_EXECUTION_AGENT_ID,
        },
      });
      const refinedMsg = saveCoachRefinedMessage(input.conversationId, refined, {
        linkedClarifyMessageId: messageId,
      });
      linkCoachClarifyToRefined(messageId, refinedMsg.id);
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
      intent: "consult" as const,
      refined,
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
    console.error("[coach] /clarify/respond failed:", err);
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
    const prepared = loadCoachThreadContext(input.conversationId);
    const chatHistory = prepared.turns;
    if (!input.forceRefine) {
      saveCoachMessage(input.conversationId, "user", input.message);
      maybeAutoTitleConversation(input.conversationId, input.message);
    }
    const ctx = buildCoachChatContext(input.conversationId, input.goalId, {
      message: input.message,
      mcpIds: input.mcpIds,
      clientTimezone: input.clientTimezone,
      clientLocale: input.clientLocale,
    });
    ctx.coachThreadBlock = prepared.block || undefined;
    await attachBrowserDesktopContext(ctx, input.conversationId);
    if (input.skillIds?.length) {
      const catalog = listSkillCatalog(loadSkillManifest());
      ctx.enabledSkills = catalog
        .filter((s) => input.skillIds!.includes(s.id))
        .map((s) => ({ id: s.id, name: s.name, desc: s.desc }));
    }
    const intentHint = classifyCoachIntent(input.message);
    const skipRefine =
      input.skipRefine === true || isWorkOrderDismissMessage(input.message);
    /**
     * 工头 /chat 派单分支（与 coachChatReply 对齐）：
     * - forceRefine → 跳过 structured，直接要求 refined（「整理成任务单」）
     * - preferStructured → shouldTryLlmClarify 时 LLM 三选一 clarify/refined/message
     * - willStream → 非 structured 且非 force 时的流式闲聊
     */
    const preferStructured =
      !input.forceRefine && !skipRefine && shouldTryLlmClarify(input.message, intentHint);
    const willStream =
      !input.forceRefine &&
      !preferStructured &&
      (skipRefine || shouldUseCoachStreaming(input.message, intentHint));
    const stream = createCoachStreamBroadcaster(input.conversationId);
    const onDelta = willStream ? stream.onDelta : undefined;

    let message: string;
    let rawRefined: Awaited<ReturnType<typeof coachChatReply>>["refined"];
    let rawClarify: Awaited<ReturnType<typeof coachChatReply>>["clarify"];
    let intent: Awaited<ReturnType<typeof coachChatReply>>["intent"];
    let suggestRefine: boolean | undefined;
    let llmError: string | undefined;
    let quotaExceeded: boolean | undefined;

    try {
      if (shouldUseOperatorTools(settings.operatorTier ?? "off", input.message, {
        forceRefine: input.forceRefine,
        skipRefine,
      })) {
        const gateway = createCoachOperatorGateway(
          settings.operatorTier ?? "off",
          input.conversationId,
        );
        const opReply = await coachOperatorChatReply(
          input.message,
          ctx,
          settings,
          gateway,
          undefined,
          chatHistory,
        );
        message = opReply.message;
        intent = opReply.intent ?? intentHint;
        if (opReply.operatorAction) {
          saveCoachOperatorActionMessage(
            input.conversationId,
            opReply.operatorAction,
          );
        }
        for (const tc of opReply.toolCalls) {
          broadcast({
            type: "coach.tool_call",
            conversationId: input.conversationId,
            toolName: tc.name,
            args: tc.args as Record<string, unknown> | undefined,
            timestamp: new Date().toISOString(),
          });
          broadcast({
            type: "coach.tool_result",
            conversationId: input.conversationId,
            toolName: tc.name,
            result: tc.result,
            timestamp: new Date().toISOString(),
          });
        }
      } else {
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
        rawRefined = skipRefine || reply.clarify ? undefined : reply.refined;
        rawClarify = reply.clarify;
        intent = reply.intent ?? intentHint;
        suggestRefine = rawClarify ? undefined : reply.suggestRefine;
        llmError = reply.llmError;
        quotaExceeded = reply.quotaExceeded;
        if (willStream) stream.flushPending();
      }
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
          agentId: rawRefined?.agentId ?? DEFAULT_EXECUTION_AGENT_ID,
          mcpIds: input.mcpIds,
          skillIds: input.skillIds,
        },
      });
    }

    saveCoachMessage(input.conversationId, "coach", message);
    let clarify = rawClarify;
    if (clarify) {
      const clarifyMsg = saveCoachClarifyMessage(input.conversationId, clarify);
      clarify = clarifyMsg.clarify;
      broadcast({
        type: "coach.message",
        conversationId: input.conversationId,
        message: clarifyMsg,
      });
    }
    if (refined && !clarify) {
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
      clarify,
      suggestRefine: clarify ? undefined : suggestRefine,
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
