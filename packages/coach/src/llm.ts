/**

 * LLM Coach：对齐 OpenCode 技术栈

 * - ai（Vercel AI SDK）

 * - @ai-sdk/openai-compatible（OpenAI 兼容端点：OpenAI / DeepSeek / Ollama / Zen）

 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import { generateObject, generateText, streamText } from "ai";

import { z } from "zod";

import { EXECUTOR_AUTO, isValidExecutorId } from "@openx/shared";

import {

  RefinedGoalSchema,

  resolveModelCredentials,

  upgradeToModelConfig,

  resolveReviewerModelRef,

  type AgentChatResponse,

  type CoachChatContext,

  type CoachChatTurn,

  type ModelSettingsSlice,

  type RefineInput,

  type RefinedGoal,

  type RefinedSubGoal,

  type ResolvedModelCredentials,

  CoachClarifyPayloadSchema,

  type CoachClarifyPayload,

} from "@openx/shared";

import {
  buildAgentSystemPrompt,
  buildChatStreamSystemPrompt,
  buildChatUserPrompt,
  buildRefineUserPrompt,
} from "./prompts.js";
import { buildRefineSystemPrompt } from "./render-llm-prompt.js";
import type { LlmContextSettings } from "@openx/shared";
import { isDiscourseTopicMessage } from "@openx/shared";

import { formatCoachLlmError, isCoachParseError, isCoachTimeoutError } from "./llm-errors.js";

const JSON_ONLY_SUFFIX =
  "\n\n请以 JSON 对象回复，不要输出 markdown 代码块或推理过程。";

const JSON_RETRY_SUFFIX =
  "\n\n重要：只输出一个合法 JSON 对象，字段必须完整，禁止空回复。";

const COACH_LLM_TIMEOUT_MS = Number.parseInt(
  process.env.OPENX_COACH_LLM_TIMEOUT_MS ?? "45000",
  10,
);

function coachLlmAbortSignal(): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COACH_LLM_TIMEOUT_MS);
  if (typeof timer === "object" && "unref" in timer) {
    timer.unref();
  }
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer),
  };
}

/** 工头/审查员共用的结构化 JSON 调用（含解析失败重试） */
export async function generateStructuredObject<T>(options: {
  model: ReturnType<ReturnType<typeof createOpenAICompatible>>;
  schema: z.ZodTypeAny;
  system: string;
  prompt: string;
}): Promise<T> {
  const { signal, cancel } = coachLlmAbortSignal();
  try {
    const { object } = await generateObject({
      model: options.model,
      schema: options.schema,
      system: options.system,
      prompt: `${options.prompt.trim()}${JSON_ONLY_SUFFIX}`,
      temperature: 0,
      abortSignal: signal,
    });
    return object as T;
  } catch (err) {
    if (isCoachTimeoutError(err)) throw err;
    if (!isCoachParseError(err)) throw err;
    const retry = coachLlmAbortSignal();
    try {
      const { object } = await generateObject({
        model: options.model,
        schema: options.schema,
        system: `${options.system}\n\n你必须只输出 JSON，content 字段不能为空。`,
        prompt: `${options.prompt.trim()}${JSON_RETRY_SUFFIX}`,
        temperature: 0,
        maxRetries: 0,
        abortSignal: retry.signal,
      });
      return object as T;
    } finally {
      retry.cancel();
    }
  } finally {
    cancel();
  }
}

/** 工头↔施工队自然语言对话（纯文本，无 JSON schema） */
export async function generateCoachText(options: {
  model: ReturnType<ReturnType<typeof createOpenAICompatible>>;
  system: string;
  prompt: string;
  temperature?: number;
}): Promise<string> {
  const { signal, cancel } = coachLlmAbortSignal();
  try {
    const { text } = await generateText({
      model: options.model,
      system: options.system,
      prompt: options.prompt.trim(),
      temperature: options.temperature ?? 0.4,
      abortSignal: signal,
    });
    return text.trim();
  } finally {
    cancel();
  }
}



export type LlmEnv = {

  apiKey?: string;

  baseUrl?: string;

  model?: string;

};



export type LlmRole = "coach" | "pi" | "reviewer";



export function resolveLlmCredentials(

  settings: ModelSettingsSlice,

  role: LlmRole = "coach",

  env: LlmEnv = {},

): ResolvedModelCredentials | null {

  const upgraded = upgradeToModelConfig(settings);

  const ref =

    role === "coach"

      ? upgraded.model?.coach ?? upgraded.model?.default

      : role === "reviewer"

        ? resolveReviewerModelRef(upgraded.model)

      : upgraded.model?.pi ?? upgraded.model?.default;

  if (!ref) return null;

  return resolveModelCredentials(upgraded, ref, env);

}



export function createModel(creds: { apiKey: string; baseUrl: string; model: string }): ReturnType<
  ReturnType<typeof createOpenAICompatible>
> {

  const provider = createOpenAICompatible({

    name: "openx-coach",

    baseURL: creds.baseUrl.replace(/\/$/, ""),

    apiKey: creds.apiKey,

    headers: {

      "User-Agent": "openx-coach/0.1",

    },

  });

  return provider(creds.model);

}



const RefinedSubGoalLooseSchema = z.object({

  title: z.string(),

  acceptance: z.string(),

  executionPrompt: z.string(),

  constraints: z.union([z.array(z.string()), z.string()]).optional(),

  executorId: z.string().optional(),

  priority: z.enum(["low", "medium", "high", "critical"]).optional(),

  dependsOnIndex: z.array(z.number().int().min(0)).optional(),

});



/** 兼容模型把 constraints 写成 string 的情况 */

const CoachClarifyLooseSchema = z.object({
  title: z.string().optional(),
  introHtml: z.string().optional(),
  questions: z
    .array(
      z.object({
        id: z.string(),
        prompt: z.string(),
        multiSelect: z.boolean().optional(),
        allowFreeform: z.boolean().optional(),
        dependsOnIndex: z.number().int().min(0).optional(),
        dependsOnOptionIds: z.array(z.string()).optional(),
        options: z
          .array(
            z.object({
              id: z.string(),
              label: z.string(),
              description: z.string().optional(),
              recommended: z.boolean().optional(),
              preview: z
                .object({
                  format: z.enum(["html", "markdown", "mermaid", "text"]),
                  content: z.string(),
                })
                .optional(),
            }),
          )
          .optional(),
      }),
    )
    .min(1)
    .max(4),
});

const AgentChatResponseLooseSchema = z.object({
  message: z.string(),
  intent: z.enum(["task", "progress", "consult", "chitchat", "rework"]).optional(),
  clarify: CoachClarifyLooseSchema.optional(),
  refined: z

    .object({

      title: z.string(),

      acceptance: z.string(),

      executionPrompt: z.string(),

      constraints: z.union([z.array(z.string()), z.string()]).optional(),

      executorId: z.string().optional(),

      priority: z.enum(["low", "medium", "high", "critical"]).optional(),

      subGoals: z.array(RefinedSubGoalLooseSchema).optional(),

    })

    .optional(),

});



function normalizeConstraints(c: string[] | string | undefined): string[] {

  return Array.isArray(c)

    ? c.map(String)

    : typeof c === "string" && c.trim()

      ? [c.trim()]

      : [];

}



function parseSubGoals(raw?: z.infer<typeof RefinedSubGoalLooseSchema>[]): RefinedSubGoal[] | undefined {

  if (!raw?.length) return undefined;

  return raw.map((sg) => ({

    title: sg.title,

    acceptance: sg.acceptance,

    executionPrompt: sg.executionPrompt,

    constraints: normalizeConstraints(sg.constraints),

    executorId:
      sg.executorId && sg.executorId !== EXECUTOR_AUTO && isValidExecutorId(sg.executorId)
        ? sg.executorId
        : undefined,

    priority: sg.priority,

    dependsOnIndex: sg.dependsOnIndex,

  }));

}



function parseClarify(raw?: z.infer<typeof CoachClarifyLooseSchema>): CoachClarifyPayload | undefined {
  if (!raw?.questions?.length) return undefined;
  return CoachClarifyPayloadSchema.parse({
    ...raw,
    status: "pending",
  });
}

function parseAgentReply(raw: z.infer<typeof AgentChatResponseLooseSchema>): AgentChatResponse {
  const clarify = parseClarify(raw.clarify);
  if (clarify) {
    return { message: raw.message, intent: raw.intent ?? "consult", clarify };
  }
  if (!raw.refined) return { message: raw.message, intent: raw.intent, clarify };

  const constraints = normalizeConstraints(raw.refined.constraints);
  const subGoals = parseSubGoals(raw.refined.subGoals);

  return {
    message: raw.message,
    intent: raw.intent,
    refined: {
      title: raw.refined.title,
      acceptance: raw.refined.acceptance,
      executionPrompt: raw.refined.executionPrompt,
      constraints,
      executorId:
        raw.refined.executorId &&
        raw.refined.executorId !== EXECUTOR_AUTO &&
        isValidExecutorId(raw.refined.executorId)
          ? raw.refined.executorId
          : undefined,
      priority: raw.refined.priority,
      subGoals,
    },
  };
}



function wrapLlmError(err: unknown): never {

  const formatted = formatCoachLlmError(err);

  if (formatted) throw new Error(formatted);

  throw err instanceof Error ? err : new Error(String(err));

}



export async function refineGoalLlm(

  input: RefineInput,

  settings: ModelSettingsSlice,

  defaultConstraints: string[] = [],

  env?: LlmEnv,

  llmContextSettings?: Partial<LlmContextSettings> | null,

): Promise<RefinedGoal> {

  const creds = resolveLlmCredentials(settings, "coach", env);

  if (!creds) {

    throw new Error("LLM 未配置：请在设置中添加渠道并选择模型");

  }



  try {

    return await generateStructuredObject<RefinedGoal>({

      model: createModel(creds),

      schema: RefinedGoalSchema,

      system: buildRefineSystemPrompt(llmContextSettings),

      prompt: buildRefineUserPrompt(

        input.userDraft,

        defaultConstraints,

        input.feedback,

      ),

    });

  } catch (err) {

    wrapLlmError(err);

  }

}



export type CoachChatStreamLlmOptions = {
  promptMode?: "tool_continuation";
};

export async function coachChatStreamLlm(
  message: string,
  context: CoachChatContext & { defaultConstraints?: string[] },
  settings: ModelSettingsSlice,
  onDelta: (delta: string) => Promise<void>,
  env?: LlmEnv,
  chatHistory: CoachChatTurn[] = [],
  options?: CoachChatStreamLlmOptions,
): Promise<string> {
  const creds = resolveLlmCredentials(settings, "coach", env);
  if (!creds) {
    throw new Error("模型未配置：请在设置中添加渠道并选择模型");
  }

  const { signal, cancel } = coachLlmAbortSignal();
  try {
    const result = streamText({
      model: createModel(creds),
      system: buildChatStreamSystemPrompt(context, context.llmContextSettings),
      prompt: buildChatUserPrompt(message, chatHistory, undefined, {
        threadBlock: context.coachThreadBlock,
        jsonMode:
          options?.promptMode === "tool_continuation"
            ? "tool_continuation"
            : false,
      }),
      temperature: isDiscourseTopicMessage(message) ? 0.45 : 0.3,
      abortSignal: signal,
    });
    let full = "";
    for await (const delta of result.textStream) {
      full += delta;
      await onDelta(delta);
    }
    return full.trim();
  } catch (err) {
    wrapLlmError(err);
  } finally {
    cancel();
  }
}

export type CoachAgentReplyLlmOptions = {
  promptMode?: "tool_continuation" | "clarify" | "clarify_continuation" | "structured";
};

export async function coachAgentReplyLlm(

  message: string,

  context: CoachChatContext & { defaultConstraints?: string[] },

  settings: ModelSettingsSlice,

  env?: LlmEnv,

  chatHistory: CoachChatTurn[] = [],

  options?: CoachAgentReplyLlmOptions,

): Promise<AgentChatResponse> {

  const creds = resolveLlmCredentials(settings, "coach", env);

  if (!creds) {

    throw new Error("模型未配置：请在设置中添加渠道并选择模型");

  }



  try {

    const object = await generateStructuredObject<z.infer<typeof AgentChatResponseLooseSchema>>({

      model: createModel(creds),

      schema: AgentChatResponseLooseSchema,

      system: buildAgentSystemPrompt(context, context.llmContextSettings),

      prompt: buildChatUserPrompt(message, chatHistory, undefined, {
        threadBlock: context.coachThreadBlock,
        jsonMode:
          options?.promptMode === "tool_continuation"
            ? "tool_continuation"
            : options?.promptMode === "clarify"
              ? "clarify"
              : options?.promptMode === "clarify_continuation"
                ? "clarify_continuation"
                : options?.promptMode === "structured"
                  ? "structured"
                  : undefined,
      }),

    });

    return parseAgentReply(object);

  } catch (err) {

    wrapLlmError(err);

  }

}



export async function testLlmConnection(

  settings: ModelSettingsSlice,

  role: LlmRole = "coach",

  env?: LlmEnv,

  refOverride?: string,

): Promise<{ ok: boolean; message?: string; error?: string }> {

  const upgraded = upgradeToModelConfig(settings);

  const ref =

    refOverride ??

    (role === "coach" ? upgraded.model?.coach : upgraded.model?.pi) ??

    upgraded.model?.default;

  if (!ref) {

    return { ok: false, error: "模型未配置：请选择模型引用" };

  }

  const creds = resolveModelCredentials(upgraded, ref, env);

  if (!creds) {

    return { ok: false, error: "模型未配置：请填写 API Key 或选择 OpenCode Zen" };

  }



  const PingSchema = z.object({ pong: z.string() });



  try {

    const { object } = await generateObject({

      model: createModel(creds),

      schema: PingSchema,

      system: "You reply in JSON only.",

      prompt: 'Reply with JSON: {"pong":"ok"}',

    });

    return { ok: true, message: object.pong };

  } catch (err) {

    const formatted = formatCoachLlmError(err);

    return { ok: false, error: formatted ?? (err instanceof Error ? err.message : String(err)) };

  }

}



/** @deprecated 使用 coachAgentReplyLlm */

export async function coachChatReplyLlm(

  message: string,

  context: CoachChatContext,

  settings: ModelSettingsSlice,

  env?: LlmEnv,

): Promise<string> {

  const result = await coachAgentReplyLlm(message, context, settings, env);

  return result.message;

}


