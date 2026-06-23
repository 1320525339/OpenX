import {
  classifyCoachIntent,
  getModelRuntimeStatus,
  isProductMetaRequest,
  isWorkOrderDismissMessage,
  mayNeedGoalRefined,
  upgradeToModelConfig,
  type AgentChatResponse,
  type CoachChatContext,
  type CoachChatTurn,
  type CoachIntent,
  type ModelSettingsSlice,
  type RefineInput,
  type RefinedGoal,
  type WorkOrderToolResult,
  type ClarifyToolResult,
  type OperatorActionToolResult,
  type CoachClarifyPayload,
  type CoachDispatchPermissionPayload,
  type DispatchPermissionToolResult,
  operatorToolsEnabled,
  formatClarifyAnswersForPrompt,
  enforceBugTwoPhaseSubGoals,
  resolveBriefTemplateSections,
} from "@openx/shared";
import {
  buildWorkspaceInspectRefined,
  isWorkspaceInspectIntent,
} from "./prompts.js";
import {
  refineGoalRules,
  coachChatReplyRules,
} from "./rules.js";
import {
  coachAgentReplyLlm,
  coachChatStreamLlm,
  refineGoalLlm,
  resolveLlmCredentials,
  testLlmConnection,
  type LlmEnv,
  type LlmRole,
} from "./llm.js";
import { formatCoachLlmError, isCoachParseError, isCoachQuotaError, isCoachTimeoutError, formatCoachTimeoutError } from "./llm-errors.js";
import { coachOperatorChatReply } from "./operator-chat.js";
import type { OperatorToolGateway } from "./operator-tools.js";

function finalizeRefinedGoal(
  refined: RefinedGoal | undefined,
  sourceText: string,
  context?: CoachChatContext,
): RefinedGoal | undefined {
  if (!refined) return undefined;
  const sections = resolveBriefTemplateSections(context?.llmContextSettings);
  return enforceBugTwoPhaseSubGoals(refined, sourceText, sections);
}

function rulesRefinedFallbackForMessage(
  message: string,
  context: CoachChatContext,
  defaultConstraints: string[],
  force: boolean,
): RefinedGoal | undefined {
  if (isWorkOrderDismissMessage(message)) return undefined;
  if (isProductMetaRequest(message)) return undefined;
  const intentHint = classifyCoachIntent(message);
  const need =
    force ||
    intentHint === "task" ||
    intentHint === "rework" ||
    mayNeedGoalRefined(message);
  if (!need) return undefined;
  return finalizeRefinedGoal(
    refineGoalRules(
      { userDraft: message },
      context.defaultConstraints ?? defaultConstraints,
    ),
    message,
    context,
  );
}

export type CoachRuntime = {
  ref?: string;
  model?: string;
  ready: boolean;
  slug?: string;
  baseUrl?: string;
  error?: string;
};

export function getCoachRuntime(
  settings: ModelSettingsSlice,
  env?: LlmEnv,
): CoachRuntime {
  const upgraded = upgradeToModelConfig(settings);
  const status = getModelRuntimeStatus(upgraded, "coach", env);
  return {
    ref: status.ref,
    model: status.model,
    ready: status.ready,
    slug: status.slug,
    baseUrl: status.baseUrl,
  };
}

export function getPiRuntime(
  settings: ModelSettingsSlice,
  env?: LlmEnv,
): CoachRuntime {
  const upgraded = upgradeToModelConfig(settings);
  const status = getModelRuntimeStatus(upgraded, "pi", env);
  return {
    ref: status.ref,
    model: status.model,
    ready: status.ready,
    slug: status.slug,
    baseUrl: status.baseUrl,
  };
}

export async function testCoachConnection(
  settings: ModelSettingsSlice,
  env?: LlmEnv,
  refOverride?: string,
) {
  return testLlmConnection(settings, "coach", env, refOverride);
}

export async function testPiConnection(
  settings: ModelSettingsSlice,
  env?: LlmEnv,
  refOverride?: string,
) {
  return testLlmConnection(settings, "pi", env, refOverride);
}

export async function refineGoal(
  input: RefineInput,
  settings: ModelSettingsSlice,
  defaultConstraints: string[] = [],
  env?: LlmEnv,
): Promise<{
  refined: RefinedGoal;
  llmError?: string;
  quotaExceeded?: boolean;
}> {
  const upgraded = upgradeToModelConfig(settings);
  const llmContext =
    settings && typeof settings === "object" && "llmContext" in settings
      ? (settings as { llmContext?: import("@openx/shared").LlmContextSettings }).llmContext
      : undefined;
  if (resolveLlmCredentials(upgraded, "coach", env)) {
    try {
      const refined = await refineGoalLlm(
        input,
        upgraded,
        defaultConstraints,
        env,
        llmContext,
      );
      return {
        refined:
          finalizeRefinedGoal(refined, input.userDraft, {
            llmContextSettings: llmContext,
          }) ?? refined,
      };
    } catch (err) {
      const hint = formatCoachLlmError(err);
      if (hint && isCoachQuotaError(err)) {
        console.warn("[coach] LLM refine quota:", hint);
        return {
          refined: finalizeRefinedGoal(
            refineGoalRules(input, defaultConstraints),
            input.userDraft,
            { llmContextSettings: llmContext },
          )!,
          llmError: hint,
          quotaExceeded: true,
        };
      }
      console.warn("[coach] LLM refine failed:", err);
      const parseFailed = isCoachParseError(err);
      return {
        refined: finalizeRefinedGoal(
          refineGoalRules(input, defaultConstraints),
          input.userDraft,
          { llmContextSettings: llmContext },
        )!,
        llmError:
          hint ??
          (parseFailed
            ? (formatCoachLlmError(err) ?? undefined)
            : err instanceof Error
              ? err.message
              : String(err)),
      };
    }
  }
  return {
    refined: finalizeRefinedGoal(
      refineGoalRules(input, defaultConstraints),
      input.userDraft,
      { llmContextSettings: llmContext },
    )!,
    llmError: "模型未配置：请在设置中添加渠道并选择模型，已使用规则模板",
  };
}

function ensureWorkspaceInspectRefined(
  userMessage: string,
  context: CoachChatContext,
  reply: AgentChatResponse,
): AgentChatResponse {
  if (reply.refined || !isWorkspaceInspectIntent(userMessage)) {
    return reply;
  }
  const refined = buildWorkspaceInspectRefined(
    userMessage,
    context.workspaceRoot ?? ".",
  );
  const hint = "我已整理成 Pi 执行任务，请点击下方「创建并执行」在工作目录中查看。";
  const message = /创建|执行|Pi|目标整理/.test(reply.message)
    ? reply.message
    : `${reply.message.trim()}\n\n${hint}`;
  return { message, refined, intent: reply.intent ?? "task" };
}

export type CoachChatReplyOptions = {
  onDelta?: (delta: string) => Promise<void>;
  /**
   * 用户已确认「整理成任务单」：必须产出 refined。
   * 与 structured 澄清路径互斥：开启后跳过 tryStructuredLlm，不会出 clarify 卡。
   */
  forceRefine?: boolean;
  /** 用户取消任务单：禁止产出 refined */
  skipRefine?: boolean;
  /** propose_work_order 的 tool_result 已回传，继续工头轮次 */
  toolContinuation?: boolean;
  /** 澄清结果已回传，继续并产出 refined */
  clarifyContinuation?: boolean;
};

export async function coachChatReply(
  message: string,
  context: CoachChatContext,
  settings: ModelSettingsSlice,
  defaultConstraints: string[] = [],
  env?: LlmEnv,
  chatHistory: CoachChatTurn[] = [],
  options?: CoachChatReplyOptions,
): Promise<{
  message: string;
  refined?: RefinedGoal;
  clarify?: CoachClarifyPayload;
  dispatchPermission?: CoachDispatchPermissionPayload;
  intent?: CoachIntent;
  llmError?: string;
  quotaExceeded?: boolean;
  streamed?: boolean;
}> {
  const intentHint = classifyCoachIntent(message);
  const force = options?.forceRefine === true;
  const dismiss =
    !force &&
    (options?.skipRefine === true || isWorkOrderDismissMessage(message));
  /** 有 LLM 时统一走 structured，由 LLM 自主三选一 clarify/refined/message */
  const tryStructuredLlm =
    !force &&
    !dismiss &&
    !options?.toolContinuation &&
    !options?.clarifyContinuation &&
    !isWorkspaceInspectIntent(message) &&
    !isProductMetaRequest(message);
  const upgraded = upgradeToModelConfig(settings);
  if (resolveLlmCredentials(upgraded, "coach", env)) {
    try {
      let structuredReply: AgentChatResponse | undefined;
      if (tryStructuredLlm) {
        try {
          structuredReply = await coachAgentReplyLlm(
            message,
            { ...context, defaultConstraints },
            upgraded,
            env,
            chatHistory,
            { promptMode: "structured" },
          );
        } catch (structErr) {
          console.warn("[coach] structured clarify/refine failed:", structErr);
          // 明确任务：跳过 structured，走下方 agent / rules refined 兜底
        }
      }

      if (
        options?.onDelta &&
        !force &&
        (dismiss || isProductMetaRequest(message))
      ) {
        const streamed = await coachChatStreamLlm(
          message,
          { ...context, defaultConstraints },
          upgraded,
          options.onDelta,
          env,
          chatHistory,
        );
        return {
          message:
            streamed ||
            coachChatReplyRules(message, { ...context, defaultConstraints }),
          intent: dismiss ? "consult" : intentHint,
          streamed: true,
        };
      }

      const reply =
        structuredReply ??
        (await coachAgentReplyLlm(
          message,
          { ...context, defaultConstraints },
          upgraded,
          env,
          chatHistory,
          options?.toolContinuation
            ? { promptMode: "tool_continuation" }
            : options?.clarifyContinuation
              ? { promptMode: "clarify_continuation" }
              : undefined,
        ));
      const merged = ensureWorkspaceInspectRefined(message, context, reply);
      const intent = merged.intent ?? intentHint;
      let refined =
        isProductMetaRequest(message) ? undefined : merged.refined;
      const needRefined =
        !dismiss &&
        !merged.clarify &&
        !merged.dispatchPermission &&
        !refined &&
        force &&
        !isProductMetaRequest(message);
      if (!refined && needRefined) {
        refined = refineGoalRules(
          { userDraft: message },
          context.defaultConstraints ?? defaultConstraints,
        );
      }
      refined = finalizeRefinedGoal(refined, message, context);
      let messageOut = merged.message;
      if (
        refined &&
        !merged.clarify &&
        !merged.dispatchPermission &&
        !dismiss &&
        !/创建并执行|创建目标|整理成|工单|任务单/.test(messageOut)
      ) {
        messageOut = `${messageOut.trim()}\n\n我已整理成任务单，请在对话中确认后点击底部「创建」。`;
      }
      return {
        message: messageOut,
        refined: merged.clarify || merged.dispatchPermission ? undefined : refined,
        clarify: merged.clarify,
        dispatchPermission: merged.dispatchPermission,
        intent,
      };
    } catch (err) {
      const hint = formatCoachLlmError(err);
      if (hint && isCoachQuotaError(err)) {
        return { message: hint, llmError: hint, quotaExceeded: true };
      }
      if (isCoachTimeoutError(err)) {
        const timeoutMsg = formatCoachTimeoutError();
        console.warn("[coach] LLM chat timeout:", err);
        const refined = rulesRefinedFallbackForMessage(
          message,
          context,
          defaultConstraints,
          force,
        );
        return {
          message: coachChatReplyRules(message, context),
          refined,
          llmError: timeoutMsg,
        };
      }
      console.warn("[coach] LLM chat failed:", err);

      if (isWorkspaceInspectIntent(message)) {
        return {
          message:
            "LLM 输出异常，已改用规则整理 Pi 侦察任务。请点击下方「创建并执行」。",
          refined: buildWorkspaceInspectRefined(
            message,
            context.workspaceRoot ?? ".",
          ),
          llmError: hint ?? formatCoachLlmError(err) ?? undefined,
        };
      }

      if (isCoachParseError(err)) {
        return {
          message: coachChatReplyRules(message, context),
          refined: rulesRefinedFallbackForMessage(
            message,
            context,
            defaultConstraints,
            force,
          ),
          llmError: hint ?? formatCoachLlmError(err) ?? undefined,
        };
      }

      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  if (isWorkspaceInspectIntent(message)) {
    return {
      message:
        "我无法直接读目录，已整理成 Pi 执行任务。请点击下方「创建并执行」。",
      refined: buildWorkspaceInspectRefined(
        message,
        context.workspaceRoot ?? ".",
      ),
      llmError: "模型未配置：请在设置中添加渠道并选择模型",
    };
  }

  if (force) {
    return {
      message: "已按规则模板整理成任务单，请在预览卡片中确认。",
      refined: finalizeRefinedGoal(
        refineGoalRules(
          { userDraft: message },
          context.defaultConstraints ?? defaultConstraints,
        ),
        message,
        context,
      ),
      llmError: "模型未配置：请在设置中添加渠道并选择模型，已使用规则模板",
    };
  }

  return {
    message: coachChatReplyRules(message, context),
    llmError: "模型未配置：请在设置中添加渠道并选择模型",
  };
}

/** 任务单 UI 操作后，将 tool_result 回传工头继续对话（非用户消息） */
export async function coachContinueAfterClarifyTool(
  toolResult: ClarifyToolResult,
  clarifyPayload: CoachClarifyPayload,
  context: CoachChatContext,
  settings: ModelSettingsSlice,
  chatHistory: CoachChatTurn[] = [],
  env?: LlmEnv,
  options?: Pick<CoachChatReplyOptions, "onDelta">,
): Promise<{
  message: string;
  refined?: RefinedGoal;
  llmError?: string;
  quotaExceeded?: boolean;
  streamed?: boolean;
}> {
  const continuation =
    toolResult.outcome === "dismissed"
      ? "工具 propose_clarification 已返回：用户跳过澄清。"
      : [
          "工具 propose_clarification 已返回：用户已回答澄清问题。",
          formatClarifyAnswersForPrompt(
            clarifyPayload,
            toolResult.answers ?? {},
            toolResult.annotations,
          ),
        ].join("\n");

  const reply = await coachChatReply(
    continuation,
    context,
    settings,
    context.defaultConstraints ?? [],
    env,
    chatHistory,
    {
      onDelta: options?.onDelta,
      skipRefine: toolResult.outcome === "dismissed",
      clarifyContinuation: toolResult.outcome === "answered",
    },
  );
  let message = reply.message;
  if (
    toolResult.outcome === "dismissed" &&
    !/整理成任务单|整理成工单/.test(message)
  ) {
    message = `${message.trim()}\n\n如需我继续整理成任务单，直接说「整理成任务单」即可。`;
  }
  return {
    message,
    refined: reply.refined,
    llmError: reply.llmError,
    quotaExceeded: reply.quotaExceeded,
    streamed: reply.streamed,
  };
}

export async function coachContinueAfterWorkOrderTool(
  toolResult: WorkOrderToolResult,
  context: CoachChatContext,
  settings: ModelSettingsSlice,
  chatHistory: CoachChatTurn[] = [],
  env?: LlmEnv,
  options?: Pick<CoachChatReplyOptions, "onDelta">,
): Promise<{
  message: string;
  llmError?: string;
  quotaExceeded?: boolean;
  streamed?: boolean;
}> {
  const continuation =
    toolResult.outcome === "dismissed"
      ? `工具 propose_work_order 已返回：用户取消任务单「${toolResult.title}」。`
      : `工具 propose_work_order 已返回：用户确认任务单「${toolResult.title}」${toolResult.goalId ? `（goalId: ${toolResult.goalId}）` : ""}。`;

  const upgraded = upgradeToModelConfig(settings);
  if (options?.onDelta && resolveLlmCredentials(upgraded, "coach", env)) {
    try {
      const streamed = await coachChatStreamLlm(
        continuation,
        { ...context, defaultConstraints: context.defaultConstraints ?? [] },
        upgraded,
        options.onDelta,
        env,
        chatHistory,
        { promptMode: "tool_continuation" },
      );
      return {
        message:
          streamed ||
          coachChatReplyRules(continuation, {
            ...context,
            defaultConstraints: context.defaultConstraints ?? [],
          }),
        streamed: true,
      };
    } catch (err) {
      const hint = formatCoachLlmError(err);
      if (hint && isCoachQuotaError(err)) {
        return { message: hint, llmError: hint, quotaExceeded: true };
      }
      console.warn("[coach] work order tool stream failed:", err);
    }
  }

  const reply = await coachChatReply(
    continuation,
    context,
    settings,
    context.defaultConstraints ?? [],
    env,
    chatHistory,
    { skipRefine: true, toolContinuation: true },
  );
  return {
    message: reply.message,
    llmError: reply.llmError,
    quotaExceeded: reply.quotaExceeded,
  };
}

/** Operator 待确认操作 UI 处理后，将 tool_result 回传工头继续对话 */
export async function coachContinueAfterOperatorTool(
  toolResult: OperatorActionToolResult,
  context: CoachChatContext,
  settings: ModelSettingsSlice,
  chatHistory: CoachChatTurn[] = [],
  env?: LlmEnv,
  options?: Pick<CoachChatReplyOptions, "onDelta"> & {
    operatorGateway?: OperatorToolGateway;
  },
): Promise<{
  message: string;
  llmError?: string;
  quotaExceeded?: boolean;
  streamed?: boolean;
}> {
  const continuation =
    toolResult.outcome === "dismissed"
      ? `工具 ${toolResult.toolName} 已返回：用户取消待确认操作「${toolResult.summary}」。`
      : [
          `工具 ${toolResult.toolName} 已返回：用户已确认「${toolResult.summary}」。`,
          toolResult.apiOk === false
            ? `API 执行失败：${toolResult.apiError ?? "未知错误"}`
            : toolResult.apiOk === true
              ? `API 执行成功（HTTP ${toolResult.apiStatus ?? 200}）。`
              : "",
        ]
          .filter(Boolean)
          .join("\n");

  const tier = context.operatorTier ?? "off";
  if (
    options?.operatorGateway &&
    operatorToolsEnabled(tier) &&
    shouldUseOperatorToolsForContinuation(continuation)
  ) {
    try {
      const opReply = await coachOperatorChatReply(
        continuation,
        { ...context, operatorTier: tier },
        settings,
        options.operatorGateway,
        env,
        chatHistory,
      );
      return { message: opReply.message };
    } catch (err) {
      const hint = formatCoachLlmError(err);
      if (hint && isCoachQuotaError(err)) {
        return { message: hint, llmError: hint, quotaExceeded: true };
      }
      console.warn("[coach] operator tool continuation failed:", err);
    }
  }

  const reply = await coachChatReply(
    continuation,
    context,
    settings,
    context.defaultConstraints ?? [],
    env,
    chatHistory,
    {
      onDelta: options?.onDelta,
      skipRefine: true,
      toolContinuation: true,
    },
  );
  return {
    message: reply.message,
    llmError: reply.llmError,
    quotaExceeded: reply.quotaExceeded,
    streamed: reply.streamed,
  };
}

function shouldUseOperatorToolsForContinuation(message: string): boolean {
  return /api|设置|权限|operator|admin|模型|cli|mcp/i.test(message);
}

/** 派单权限 UI 操作后，将 tool_result 回传工头继续对话 */
export async function coachContinueAfterDispatchPermissionTool(
  toolResult: DispatchPermissionToolResult,
  context: CoachChatContext,
  settings: ModelSettingsSlice,
  chatHistory: CoachChatTurn[] = [],
  env?: LlmEnv,
  options?: Pick<CoachChatReplyOptions, "onDelta">,
): Promise<{
  message: string;
  llmError?: string;
  quotaExceeded?: boolean;
  streamed?: boolean;
}> {
  const modeLabel =
    toolResult.appliedMode ?? toolResult.requestedMode;
  const continuation =
    toolResult.outcome === "dismissed"
      ? `工具 propose_dispatch_permission 已返回：用户拒绝将派单权限调整为 ${toolResult.requestedMode}。`
      : `工具 propose_dispatch_permission 已返回：用户已确认，派单权限现为 ${modeLabel}。`;

  const reply = await coachChatReply(
    continuation,
    context,
    settings,
    context.defaultConstraints ?? [],
    env,
    chatHistory,
    {
      onDelta: options?.onDelta,
      skipRefine: true,
      toolContinuation: true,
    },
  );
  return {
    message: reply.message,
    llmError: reply.llmError,
    quotaExceeded: reply.quotaExceeded,
    streamed: reply.streamed,
  };
}

export type { AgentChatResponse, LlmRole };
