import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import {
  classifyCoachIntent,
  type CoachChatContext,
  type CoachChatTurn,
  type CoachIntent,
  type ModelSettingsSlice,
  upgradeToModelConfig,
} from "@openx/shared";
import { createModel, resolveLlmCredentials, type LlmEnv } from "./llm.js";
import { buildConfiguredSystemPrompt } from "./render-llm-prompt.js";
import type {
  OperatorActionProposal,
  OperatorToolCallResult,
  OperatorToolGateway,
} from "./operator-tools.js";
import type { CoachDispatchPermissionPayload } from "@openx/shared";
import { KNOWLEDGE_SAVE_TOOL_DESCRIPTION, KNOWLEDGE_SAVE_TOOL_NAME, KnowledgeSaveToolInputSchema } from "./knowledge-tools.js";
import { buildChatUserPrompt } from "./prompts.js";

const MAX_OPERATOR_STEPS = 8;

function extractOperatorAction(results: OperatorToolCallResult[]): OperatorActionProposal | undefined {
  for (const tr of results) {
    if (tr.name !== "openx_call_api" && tr.name !== "request_admin_access") continue;
    const r = tr.result as { kind?: string; pendingActionId?: string; action?: OperatorActionProposal };
    if (r?.kind === "pending" && r.pendingActionId) {
      const a = r.action;
      return {
        pendingActionId: r.pendingActionId,
        method: a?.method ?? "?",
        path: a?.path ?? "?",
        summary: a?.summary ?? "待确认操作",
        reason: a?.reason,
      };
    }
  }
  return undefined;
}

export function extractDispatchPermissionProposal(
  results: OperatorToolCallResult[],
): CoachDispatchPermissionPayload | undefined {
  for (const tr of results) {
    if (tr.name !== "propose_dispatch_permission") continue;
    const r = tr.result as {
      kind?: string;
      requestedMode?: "read_only" | "ask_write" | "full";
      reason?: string;
    };
    if (!r?.requestedMode) continue;
    return {
      requestedMode: r.requestedMode,
      reason: r.reason,
      status: "pending",
    };
  }
  return undefined;
}

export async function coachOperatorChatReply(
  message: string,
  context: CoachChatContext,
  settings: ModelSettingsSlice,
  gateway: OperatorToolGateway,
  env?: LlmEnv,
  chatHistory: CoachChatTurn[] = [],
): Promise<{
  message: string;
  intent?: CoachIntent;
  toolCalls: OperatorToolCallResult[];
  operatorAction?: OperatorActionProposal;
}> {
  const upgraded = upgradeToModelConfig(settings);
  const creds = resolveLlmCredentials(upgraded, "coach", env);
  if (!creds) {
    throw new Error("模型未配置：请在设置中添加渠道并选择模型");
  }

  const toolResults: OperatorToolCallResult[] = [];

  const tools = {
    openx_list_apis: tool({
      description: "列出 OpenX REST API 端点，可按 category 过滤",
      inputSchema: z.object({
        category: z.string().optional().describe("如 goals、coach、cli、operator"),
      }),
      execute: async ({ category }: { category?: string }) => {
        const result = await gateway.listApis(category);
        toolResults.push({ name: "openx_list_apis", args: { category }, result });
        return result;
      },
    }),
    openx_get_catalog: tool({
      description: "获取完整 API 目录与 meta（版本、鉴权说明）",
      inputSchema: z.object({}),
      execute: async () => {
        const result = await gateway.getCatalog();
        toolResults.push({ name: "openx_get_catalog", args: {}, result });
        return result;
      },
    }),
    openx_call_api: tool({
      description: "调用 OpenX REST API；path 支持 :id 占位符",
      inputSchema: z.object({
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
        path: z.string(),
        pathParams: z.record(z.string()).optional(),
        query: z.record(z.string()).optional(),
        body: z.unknown().optional(),
        summary: z.string().optional().describe("admin 写操作的人类可读摘要"),
        reason: z.string().optional(),
      }),
      execute: async (args: {
        method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
        path: string;
        pathParams?: Record<string, string>;
        query?: Record<string, string>;
        body?: unknown;
        summary?: string;
        reason?: string;
      }) => {
        const result = await gateway.callApi(args);
        toolResults.push({ name: "openx_call_api", args, result });
        return result;
      },
    }),
    propose_dispatch_permission: tool({
      description:
        "向用户申请变更对话派单权限（施工队只读侦察 / 写前确认 / 完全授权）",
      inputSchema: z.object({
        requestedMode: z.enum(["read_only", "ask_write", "full"]),
        reason: z.string().optional(),
      }),
      execute: async ({
        requestedMode,
        reason,
      }: {
        requestedMode: "read_only" | "ask_write" | "full";
        reason?: string;
      }) => {
        const result = { kind: "proposal", requestedMode, reason };
        toolResults.push({
          name: "propose_dispatch_permission",
          args: { requestedMode, reason },
          result,
        });
        return result;
      },
    }),
    ...(gateway.tier !== "admin" && gateway.requestAdminAccess
      ? {
          request_admin_access: tool({
            description:
              "向用户申请将工头自控权限（operatorTier）升级为 admin，以便执行修改设置等敏感操作",
            inputSchema: z.object({
              reason: z.string().describe("为何需要 admin 权限"),
              summary: z.string().optional().describe("卡片上展示的简短说明"),
            }),
            execute: async ({
              reason,
              summary,
            }: {
              reason: string;
              summary?: string;
            }) => {
              const result = await gateway.requestAdminAccess!({ reason, summary });
              toolResults.push({
                name: "request_admin_access",
                args: { reason, summary },
                result,
              });
              return result;
            },
          }),
        }
      : {}),
    ...(gateway.saveKnowledge && gateway.knowledgeProjectId
      ? {
          [KNOWLEDGE_SAVE_TOOL_NAME]: tool({
            description: KNOWLEDGE_SAVE_TOOL_DESCRIPTION,
            inputSchema: KnowledgeSaveToolInputSchema,
            execute: async (args: z.infer<typeof KnowledgeSaveToolInputSchema>) => {
              const result = await gateway.saveKnowledge!(args);
              toolResults.push({ name: KNOWLEDGE_SAVE_TOOL_NAME, args, result });
              return result;
            },
          }),
        }
      : {}),
  };

  const historyPrompt = buildChatUserPrompt(message, chatHistory);
  const { text } = await generateText({
    model: createModel(creds),
    system: buildConfiguredSystemPrompt("operator", context),
    prompt: historyPrompt,
    tools,
    stopWhen: stepCountIs(MAX_OPERATOR_STEPS),
    temperature: 0.2,
  });

  const operatorAction = extractOperatorAction(toolResults);
  return {
    message: text.trim() || "已完成 API 调用，请查看上方工具结果。",
    intent: classifyCoachIntent(message),
    toolCalls: toolResults,
    operatorAction,
  };
}
