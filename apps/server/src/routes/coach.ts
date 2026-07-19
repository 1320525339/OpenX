import { Hono } from "hono";
import {
  refineGoal,
  coachChatReply,
  coachKnowledgeChatReply,
  coachContinueAfterClarifyTool,
  coachContinueAfterWorkOrderTool,
  coachContinueAfterOperatorTool,
  coachContinueAfterDispatchPermissionTool,
  coachOperatorChatReply,
  extractDispatchPermissionProposal,
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
  OPERATOR_ACTION_TOOL_NAME,
  DISPATCH_PERMISSION_TOOL_NAME,
  OperatorActionRespondSchema,
  DispatchPermissionRespondSchema,
  type ClarifyToolResult,
  type OperatorActionToolResult,
  type DispatchPermissionToolResult,
  validateClarifyRespondInput,
  type WorkOrderToolResult,
  isWorkOrderDismissMessage,
  isProductMetaRequest,
  listLlmProviderTemplates,
  classifyCoachIntent,
  shouldUseCoachStreaming,
  shouldUseKnowledgeSaveTool,
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
  hasOperatorActionToolResult,
  hasDispatchPermissionToolResult,
  saveCoachOperatorToolTrace,
  saveCoachDispatchPermissionMessage,
  updateCoachDispatchPermissionStatus,
  getConversationById,
  updateConversation,
} from "../db.js";
import { loadSettings } from "../settings-store.js";
import { broadcast } from "../sse.js";
import { buildCoachChatContextAsync } from "../coach-context.js";
import { attachBrowserDesktopContext } from "../coach-browser-context.js";
import { listSkillCatalog, loadSkillManifest } from "../skills-service.js";
import { backfillRefinedGoal } from "../refined-backfill.js";
import { createCoachStreamBroadcaster } from "../coach-stream.js";
import {
  createCoachOperatorGateway,
  shouldUseOperatorTools,
} from "../coach-operator-bridge.js";
import { createCoachKnowledgeGateway } from "../coach-knowledge-bridge.js";
import { saveCoachOperatorActionMessage, updateCoachOperatorActionStatus } from "../coach-operator-messages.js";
import {
  confirmOperatorAction,
  dismissOperatorAction,
} from "../operator-gateway.js";
import { prepareCoachThreadForPrompt } from "../coach-thread-service.js";
import { healOrphanStreamingMessages } from "../roundtable-service.js";

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

/** @deprecated 请改用 GET /api/model/templates 或 /api/coach/templates */
coachRoutes.get("/providers", (c) => {
  return c.json({
    providers: listLlmProviderTemplates(),
    templates: listLlmProviderTemplates(),
    deprecated: true,
    message: "请改用 GET /api/coach/templates 或 /api/model/templates",
  });
});

coachRoutes.get("/templates", (c) => {
  return c.json({ templates: listLlmProviderTemplates() });
});

coachRoutes.get("/status", (c) => {
  const settings = loadSettings();
  const runtime = getCoachRuntime(settings);
  return c.json({
    ...runtime,
    slug: runtime.slug,
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
      error: runtime.error ?? "渠道未就绪：请配置 API Key 或选择 OpenCode Zen",
      warning: runtime.warning,
      slug: runtime.slug,
      providerId: runtime.slug,
    });
  }
  const result = await testCoachConnection(settings);
  return c.json({
    ...result,
    slug: runtime.slug,
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
  // 读取前治愈孤儿 streaming，避免刷新后仍显示半截「回复中」压在新对话上方
  healOrphanStreamingMessages(conversationId);
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
    const ctx = await buildCoachChatContextAsync(input.conversationId, input.goalId);
    ctx.coachThreadBlock = prepared.block || undefined;
    await attachBrowserDesktopContext(ctx, input.conversationId);

    const stream = createCoachStreamBroadcaster(input.conversationId);
    let message = "";
    let llmError: string | undefined;
    let quotaExceeded: boolean | undefined;
    try {
      const reply = await coachContinueAfterWorkOrderTool(
        pendingToolResult,
        ctx,
        settings,
        chatHistory,
        undefined,
        { onDelta: stream.onDelta, abortSignal: stream.signal },
      );
      message = reply.message;
      llmError = reply.llmError;
      quotaExceeded = reply.quotaExceeded;
      stream.flushPending();
    } catch (err) {
      stream.abort();
      throw err;
    }

    if (!stream.isLive()) {
      return c.json({ aborted: true, conversationId: input.conversationId });
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
    const ctx = await buildCoachChatContextAsync(input.conversationId);
    ctx.coachThreadBlock = prepared.block || undefined;
    await attachBrowserDesktopContext(ctx, input.conversationId);

    const stream = createCoachStreamBroadcaster(input.conversationId);
    let message = "";
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
        { onDelta: stream.onDelta, abortSignal: stream.signal },
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

    if (!stream.isLive()) {
      return c.json({ aborted: true, conversationId: input.conversationId });
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

coachRoutes.post("/operator-action/:messageId/respond", async (c) => {
  try {
    const messageId = Number(c.req.param("messageId"));
    if (!Number.isFinite(messageId)) {
      return c.json({ error: "无效的消息 id" }, 400);
    }
    const input = OperatorActionRespondSchema.parse(await c.req.json());
    if (!getConversationById(input.conversationId)) {
      return c.json({ error: "Conversation not found" }, 404);
    }
    const actionRow = getCoachMessageById(messageId);
    if (
      !actionRow ||
      actionRow.kind !== "operator_action" ||
      actionRow.conversationId !== input.conversationId
    ) {
      return c.json({ error: "操作确认卡不存在" }, 404);
    }
    if (hasOperatorActionToolResult(input.conversationId, messageId)) {
      return c.json({ error: "该操作已处理" }, 409);
    }

    const pendingId = actionRow.operatorAction.pendingActionId;
    const handled =
      input.outcome === "confirmed"
        ? await confirmOperatorAction(pendingId)
        : dismissOperatorAction(pendingId);
    if (!handled) {
      return c.json({ error: "待确认操作不存在或已过期" }, 404);
    }

    updateCoachOperatorActionStatus(messageId, input.outcome);

    const pendingToolResult: OperatorActionToolResult = {
      toolName: OPERATOR_ACTION_TOOL_NAME,
      operatorMessageId: messageId,
      pendingActionId: pendingId,
      outcome: input.outcome,
      method: actionRow.operatorAction.method,
      path: actionRow.operatorAction.path,
      summary: actionRow.operatorAction.summary,
      apiOk: handled.result?.ok,
      apiStatus: handled.result?.status,
      apiError: handled.result?.error,
    };

    const settings = loadSettings();
    const prepared = loadCoachThreadContext(input.conversationId, {
      beforeMessageId: messageId,
    });
    const chatHistory = prepared.turns;
    const ctx = await buildCoachChatContextAsync(input.conversationId, undefined, {
      message: pendingToolResult.summary,
    });
    ctx.coachThreadBlock = prepared.block || undefined;
    await attachBrowserDesktopContext(ctx, input.conversationId);

    const stream = createCoachStreamBroadcaster(input.conversationId);
    let message = "";
    let llmError: string | undefined;
    let quotaExceeded: boolean | undefined;
    try {
      const gateway = createCoachOperatorGateway(
        settings.operatorTier ?? "off",
        input.conversationId,
      );
      const reply = await coachContinueAfterOperatorTool(
        pendingToolResult,
        ctx,
        settings,
        chatHistory,
        undefined,
        { onDelta: stream.onDelta, abortSignal: stream.signal, operatorGateway: gateway },
      );
      message = reply.message;
      llmError = reply.llmError;
      quotaExceeded = reply.quotaExceeded;
      stream.flushPending();
    } catch (err) {
      stream.abort();
      throw err;
    }

    if (!stream.isLive()) {
      return c.json({ aborted: true, conversationId: input.conversationId });
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
    console.error("[coach] /operator-action/respond failed:", err);
    return c.json({ error: msg }, 500);
  }
});

coachRoutes.post("/dispatch-permission/:messageId/respond", async (c) => {
  try {
    const messageId = Number(c.req.param("messageId"));
    if (!Number.isFinite(messageId)) {
      return c.json({ error: "无效的消息 id" }, 400);
    }
    const input = DispatchPermissionRespondSchema.parse(await c.req.json());
    if (!getConversationById(input.conversationId)) {
      return c.json({ error: "Conversation not found" }, 404);
    }
    const permissionRow = getCoachMessageById(messageId);
    if (
      !permissionRow ||
      permissionRow.kind !== "dispatch_permission" ||
      permissionRow.conversationId !== input.conversationId
    ) {
      return c.json({ error: "派单权限确认卡不存在" }, 404);
    }
    if (hasDispatchPermissionToolResult(input.conversationId, messageId)) {
      return c.json({ error: "该权限申请已处理" }, 409);
    }

    updateCoachDispatchPermissionStatus(messageId, input.outcome);

    const pendingToolResult: DispatchPermissionToolResult = {
      toolName: DISPATCH_PERMISSION_TOOL_NAME,
      dispatchPermissionMessageId: messageId,
      outcome: input.outcome,
      requestedMode: permissionRow.dispatchPermission.requestedMode,
      appliedMode:
        input.outcome === "confirmed"
          ? permissionRow.dispatchPermission.requestedMode
          : undefined,
      reason: permissionRow.dispatchPermission.reason,
    };

    const settings = loadSettings();
    const prepared = loadCoachThreadContext(input.conversationId, {
      beforeMessageId: messageId,
    });
    const chatHistory = prepared.turns;
    const requestedMode = permissionRow.dispatchPermission.requestedMode;
    const coachPermissionMode =
      input.outcome === "confirmed"
        ? requestedMode === "unattended"
          ? "full"
          : requestedMode
        : undefined;
    const ctx = await buildCoachChatContextAsync(input.conversationId, undefined, {
      message: permissionRow.dispatchPermission.requestedMode,
      permissionMode: coachPermissionMode,
    });
    ctx.coachThreadBlock = prepared.block || undefined;
    await attachBrowserDesktopContext(ctx, input.conversationId);

    const stream = createCoachStreamBroadcaster(input.conversationId);
    let message = "";
    let llmError: string | undefined;
    let quotaExceeded: boolean | undefined;
    try {
      const reply = await coachContinueAfterDispatchPermissionTool(
        pendingToolResult,
        ctx,
        settings,
        chatHistory,
        undefined,
        { onDelta: stream.onDelta, abortSignal: stream.signal },
      );
      message = reply.message;
      llmError = reply.llmError;
      quotaExceeded = reply.quotaExceeded;
      stream.flushPending();
    } catch (err) {
      stream.abort();
      throw err;
    }

    if (!stream.isLive()) {
      return c.json({ aborted: true, conversationId: input.conversationId });
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
    return c.json({ ...payload, toolResult, appliedMode: pendingToolResult.appliedMode });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[coach] /dispatch-permission/respond failed:", err);
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

    const ctx = await buildCoachChatContextAsync(input.conversationId, input.goalId, {
      message: input.message,
      mcpIds: input.mcpIds,
      clientTimezone: input.clientTimezone,
      clientLocale: input.clientLocale,
      knowledgeSelection: input.knowledge,
      permissionMode: input.permissionMode,
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
     * 工头 /chat 派单分支（与 coachChatReply / shouldUseCoachStreaming 对齐）：
     * - forceRefine → 跳过流式，走 structured / refined
     * - skipRefine（用户取消工单）→ 流式续聊
     * - shouldUseCoachStreaming（闲聊/咨询/进展/产品元问题）→ 流式
     * - 其余（任务/返工等）→ structured，由 LLM 自主三选一 clarify/refined/message
     */
    const willStream =
      !input.forceRefine &&
      (skipRefine || shouldUseCoachStreaming(input.message));
    const stream = createCoachStreamBroadcaster(input.conversationId);
    const onDelta = willStream ? stream.onDelta : undefined;

    let message = "";
    let rawRefined: Awaited<ReturnType<typeof coachChatReply>>["refined"];
    let rawClarify: Awaited<ReturnType<typeof coachChatReply>>["clarify"];
    let rawDispatchPermission: Awaited<
      ReturnType<typeof coachChatReply>
    >["dispatchPermission"];
    let intent: Awaited<ReturnType<typeof coachChatReply>>["intent"];
    let llmError: string | undefined;
    let quotaExceeded: boolean | undefined;

    try {
      let knowledgeHandled = false;
      if (
        !input.forceRefine &&
        !skipRefine &&
        shouldUseKnowledgeSaveTool(input.message)
      ) {
        const knowledgeGateway = createCoachKnowledgeGateway(input.conversationId);
        if (knowledgeGateway) {
          const knowledgeReply = await coachKnowledgeChatReply(
            input.message,
            ctx,
            settings,
            knowledgeGateway,
            undefined,
            chatHistory,
          );
          message = knowledgeReply.message;
          intent = knowledgeReply.intent ?? intentHint;
          rawRefined = undefined;
          rawClarify = undefined;
          for (const tc of knowledgeReply.toolCalls) {
            broadcast({
              type: "coach.tool_call",
              conversationId: input.conversationId,
              toolName: tc.name,
              args: tc.args as Record<string, unknown>,
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
          knowledgeHandled = true;
        } else {
          message =
            "当前对话无法写入项目知识库。请在具体项目对话中说「请记住」；系统调度台不支持保存项目知识。";
          intent = classifyCoachIntent(input.message) ?? intentHint;
          rawRefined = undefined;
          rawClarify = undefined;
          knowledgeHandled = true;
        }
      }

      if (
        !knowledgeHandled &&
        shouldUseOperatorTools(settings.operatorTier ?? "off", input.message, {
          forceRefine: input.forceRefine,
          skipRefine,
        })
      ) {
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
        rawRefined = undefined;
        rawClarify = undefined;
        if (opReply.operatorAction) {
          saveCoachOperatorActionMessage(
            input.conversationId,
            opReply.operatorAction,
          );
        }
        const dispatchProposal = extractDispatchPermissionProposal(opReply.toolCalls);
        if (dispatchProposal) {
          rawDispatchPermission = dispatchProposal;
        }
        saveCoachOperatorToolTrace(input.conversationId, opReply.toolCalls);
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
      } else if (!knowledgeHandled) {
        const reply = await coachChatReply(
          input.message,
          ctx,
          settings,
          settings.defaultConstraints,
          undefined,
          chatHistory,
          { onDelta, forceRefine: input.forceRefine, skipRefine, abortSignal: stream.signal },
        );
        message = reply.message;
        rawRefined =
          skipRefine ||
          reply.clarify ||
          reply.dispatchPermission ||
          isProductMetaRequest(input.message)
            ? undefined
            : reply.refined;
        rawClarify = reply.clarify;
        rawDispatchPermission = reply.dispatchPermission;
        intent = reply.intent ?? intentHint;
        llmError = reply.llmError;
        quotaExceeded = reply.quotaExceeded;
        if (willStream) stream.flushPending();
      }
    } catch (err) {
      if (willStream) stream.abort();
      throw err;
    }

    if (!stream.isLive()) {
      return c.json({ aborted: true, conversationId: input.conversationId });
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
    if (rawDispatchPermission && !clarify) {
      const permissionMsg = saveCoachDispatchPermissionMessage(
        input.conversationId,
        rawDispatchPermission,
      );
      broadcast({
        type: "coach.message",
        conversationId: input.conversationId,
        message: permissionMsg,
      });
    }
    if (refined && !clarify && !rawDispatchPermission) {
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
