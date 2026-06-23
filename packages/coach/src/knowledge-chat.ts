import { generateText, stepCountIs, tool } from "ai";
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
import { buildChatUserPrompt } from "./prompts.js";
import {
  KNOWLEDGE_SAVE_TOOL_DESCRIPTION,
  KNOWLEDGE_SAVE_TOOL_NAME,
  KnowledgeSaveToolInputSchema,
  type KnowledgeToolCallResult,
  type KnowledgeToolGateway,
} from "./knowledge-tools.js";
const MAX_KNOWLEDGE_STEPS = 4;

export async function coachKnowledgeChatReply(
  message: string,
  context: CoachChatContext,
  settings: ModelSettingsSlice,
  gateway: KnowledgeToolGateway,
  env?: LlmEnv,
  chatHistory: CoachChatTurn[] = [],
): Promise<{
  message: string;
  intent?: CoachIntent;
  toolCalls: KnowledgeToolCallResult[];
}> {
  const upgraded = upgradeToModelConfig(settings);
  const creds = resolveLlmCredentials(upgraded, "coach", env);
  if (!creds) {
    throw new Error("模型未配置：请在设置中添加渠道并选择模型");
  }

  const toolCalls: KnowledgeToolCallResult[] = [];

  const tools = {
    [KNOWLEDGE_SAVE_TOOL_NAME]: tool({
      description: KNOWLEDGE_SAVE_TOOL_DESCRIPTION,
      inputSchema: KnowledgeSaveToolInputSchema,
      execute: async (args) => {        const result = await gateway.saveEntry(args);
        toolCalls.push({ name: KNOWLEDGE_SAVE_TOOL_NAME, args, result });
        return result;
      },
    }),
  };

  const historyPrompt = buildChatUserPrompt(message, chatHistory);
  const projectHint = gateway.projectName
    ? `当前项目：${gateway.projectName}（projectId=${gateway.projectId}）`
    : `当前项目 ID：${gateway.projectId}`;

  const { text } = await generateText({
    model: createModel(creds),
    system: [
      buildConfiguredSystemPrompt("coach", context),
      "",
      "## 知识保存",
      projectHint,
      "用户希望把信息写入**项目用户知识库**。请调用 knowledge_save 工具保存；保存后用简短中文确认，不要输出任务单 refined。",
    ].join("\n"),
    prompt: historyPrompt,
    tools,
    stopWhen: stepCountIs(MAX_KNOWLEDGE_STEPS),
    temperature: 0.2,
  });

  return {
    message:
      text.trim() ||
      (toolCalls.some((tc) => tc.result.ok)
        ? "已写入项目知识库。"
        : "未能保存知识，请补充更明确的标题与内容。"),
    intent: classifyCoachIntent(message),
    toolCalls,
  };
}
