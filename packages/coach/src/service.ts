import {
  getModelRuntimeStatus,
  upgradeToModelConfig,
  type AgentChatResponse,
  type CoachChatContext,
  type CoachChatTurn,
  type ModelSettingsSlice,
  type RefineInput,
  type RefinedGoal,
} from "@openx/shared";
import {
  buildWorkspaceInspectRefined,
  isWorkspaceInspectIntent,
} from "./prompts.js";
import { refineGoalRules, coachChatReplyRules } from "./rules.js";
import {
  coachAgentReplyLlm,
  refineGoalLlm,
  resolveLlmCredentials,
  testLlmConnection,
  type LlmEnv,
  type LlmRole,
} from "./llm.js";
import { formatCoachLlmError, isCoachParseError, isCoachQuotaError } from "./llm-errors.js";

export type CoachRuntime = {
  ref?: string;
  model?: string;
  ready: boolean;
  slug?: string;
  baseUrl?: string;
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
  if (resolveLlmCredentials(upgraded, "coach", env)) {
    try {
      const refined = await refineGoalLlm(input, upgraded, defaultConstraints, env);
      return { refined };
    } catch (err) {
      const hint = formatCoachLlmError(err);
      if (hint && isCoachQuotaError(err)) {
        console.warn("[coach] LLM refine quota:", hint);
        return {
          refined: refineGoalRules(input, defaultConstraints),
          llmError: hint,
          quotaExceeded: true,
        };
      }
      console.warn("[coach] LLM refine failed:", err);
      const parseFailed = isCoachParseError(err);
      return {
        refined: refineGoalRules(input, defaultConstraints),
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
    refined: refineGoalRules(input, defaultConstraints),
    llmError: "模型未配置：请在设置中添加渠道并选择模型，已使用规则模板",
  };
}

function ensureWorkspaceInspectRefined(
  userMessage: string,
  context: CoachChatContext,
  reply: { message: string; refined?: RefinedGoal },
): { message: string; refined?: RefinedGoal } {
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
  return { message, refined };
}

export async function coachChatReply(
  message: string,
  context: CoachChatContext,
  settings: ModelSettingsSlice,
  defaultConstraints: string[] = [],
  env?: LlmEnv,
  chatHistory: CoachChatTurn[] = [],
): Promise<{
  message: string;
  refined?: RefinedGoal;
  llmError?: string;
  quotaExceeded?: boolean;
}> {
  const upgraded = upgradeToModelConfig(settings);
  if (resolveLlmCredentials(upgraded, "coach", env)) {
    try {
      const reply = await coachAgentReplyLlm(
        message,
        { ...context, defaultConstraints },
        upgraded,
        env,
        chatHistory,
      );
      const merged = ensureWorkspaceInspectRefined(message, context, reply);
      return {
        message: merged.message,
        refined: merged.refined,
      };
    } catch (err) {
      const hint = formatCoachLlmError(err);
      if (hint && isCoachQuotaError(err)) {
        return { message: hint, llmError: hint, quotaExceeded: true };
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

  return {
    message: coachChatReplyRules(message, context),
    llmError: "模型未配置：请在设置中添加渠道并选择模型",
  };
}

export type { AgentChatResponse, LlmRole };
