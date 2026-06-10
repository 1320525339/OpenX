/**

 * LLM Coach：对齐 OpenCode 技术栈

 * - ai（Vercel AI SDK）

 * - @ai-sdk/openai-compatible（OpenAI 兼容端点：OpenAI / DeepSeek / Ollama / Zen）

 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import { generateObject } from "ai";

import { z } from "zod";

import { EXECUTOR_AUTO, isValidExecutorId } from "@openx/shared";

import {

  RefinedGoalSchema,

  resolveModelCredentials,

  upgradeToModelConfig,

  type AgentChatResponse,

  type CoachChatContext,

  type CoachChatTurn,

  type ModelSettingsSlice,

  type RefineInput,

  type RefinedGoal,

  type RefinedSubGoal,

  type ResolvedModelCredentials,

} from "@openx/shared";

import {

  COACH_REFINE_SYSTEM,

  buildAgentSystemPrompt,
  buildChatUserPrompt,

  buildRefineUserPrompt,

} from "./prompts.js";

import { formatCoachLlmError, isCoachParseError } from "./llm-errors.js";

const JSON_ONLY_SUFFIX =
  "\n\n请以 JSON 对象回复，不要输出 markdown 代码块或推理过程。";

const JSON_RETRY_SUFFIX =
  "\n\n重要：只输出一个合法 JSON 对象，字段必须完整，禁止空回复。";

async function generateCoachObject<T>(options: {
  model: ReturnType<ReturnType<typeof createOpenAICompatible>>;
  schema: z.ZodTypeAny;
  system: string;
  prompt: string;
}): Promise<T> {
  try {
    const { object } = await generateObject({
      model: options.model,
      schema: options.schema,
      system: options.system,
      prompt: `${options.prompt.trim()}${JSON_ONLY_SUFFIX}`,
      temperature: 0,
    });
    return object as T;
  } catch (err) {
    if (!isCoachParseError(err)) throw err;
    const { object } = await generateObject({
      model: options.model,
      schema: options.schema,
      system: `${options.system}\n\n你必须只输出 JSON，content 字段不能为空。`,
      prompt: `${options.prompt.trim()}${JSON_RETRY_SUFFIX}`,
      temperature: 0,
      maxRetries: 0,
    });
    return object as T;
  }
}



export type LlmEnv = {

  apiKey?: string;

  baseUrl?: string;

  model?: string;

};



export type LlmRole = "coach" | "pi";



export function resolveLlmCredentials(

  settings: ModelSettingsSlice,

  role: LlmRole = "coach",

  env: LlmEnv = {},

): ResolvedModelCredentials | null {

  const upgraded = upgradeToModelConfig(settings);

  const ref =

    role === "coach"

      ? upgraded.model?.coach ?? upgraded.model?.default

      : upgraded.model?.pi ?? upgraded.model?.default;

  if (!ref) return null;

  return resolveModelCredentials(upgraded, ref, env);

}



function createModel(creds: { apiKey: string; baseUrl: string; model: string }) {

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

});



/** 兼容模型把 constraints 写成 string 的情况 */

const AgentChatResponseLooseSchema = z.object({

  message: z.string(),

  refined: z

    .object({

      title: z.string(),

      acceptance: z.string(),

      executionPrompt: z.string(),

      constraints: z.union([z.array(z.string()), z.string()]).optional(),

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

  }));

}



function parseAgentReply(raw: z.infer<typeof AgentChatResponseLooseSchema>): AgentChatResponse {

  if (!raw.refined) return { message: raw.message };

  const constraints = normalizeConstraints(raw.refined.constraints);

  const subGoals = parseSubGoals(raw.refined.subGoals);

  return {

    message: raw.message,

    refined: {

      title: raw.refined.title,

      acceptance: raw.refined.acceptance,

      executionPrompt: raw.refined.executionPrompt,

      constraints,

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

): Promise<RefinedGoal> {

  const creds = resolveLlmCredentials(settings, "coach", env);

  if (!creds) {

    throw new Error("LLM 未配置：请在设置中添加渠道并选择模型");

  }



  try {

    return await generateCoachObject<RefinedGoal>({

      model: createModel(creds),

      schema: RefinedGoalSchema,

      system: COACH_REFINE_SYSTEM,

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



export async function coachAgentReplyLlm(

  message: string,

  context: CoachChatContext & { defaultConstraints?: string[] },

  settings: ModelSettingsSlice,

  env?: LlmEnv,

  chatHistory: CoachChatTurn[] = [],

): Promise<AgentChatResponse> {

  const creds = resolveLlmCredentials(settings, "coach", env);

  if (!creds) {

    throw new Error("模型未配置：请在设置中添加渠道并选择模型");

  }



  try {

    const object = await generateCoachObject<z.infer<typeof AgentChatResponseLooseSchema>>({

      model: createModel(creds),

      schema: AgentChatResponseLooseSchema,

      system: buildAgentSystemPrompt(context),

      prompt: buildChatUserPrompt(message, chatHistory),

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


