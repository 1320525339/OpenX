/**
 * Coach 父目标智能汇总：将多个子任务结果整合为连贯的验收摘要。
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";
import {
  appendReviewPlaybookToSystem,
  buildRoleSystemPrompt,
  upgradeToModelConfig,
  type LlmContextSettings,
  type ModelSettingsSlice,
} from "@openx/shared";
import { resolveLlmCredentials, type LlmEnv } from "./llm.js";
import { formatCoachLlmError } from "./llm-errors.js";

export type ParentRollupChild = {
  title: string;
  resultSummary: string;
};

export type ParentRollupInput = {
  parentTitle: string;
  parentAcceptance?: string;
  children: ParentRollupChild[];
};

function buildRollupPrompt(input: ParentRollupInput): string {
  const parts = [`## 父目标\n${input.parentTitle}`];
  if (input.parentAcceptance?.trim()) {
    parts.push(`## 父目标验收标准\n${input.parentAcceptance.trim()}`);
  }
  parts.push("## 子任务结果");
  for (const [index, child] of input.children.entries()) {
    const summary = child.resultSummary?.trim() || "（执行器未提供结果摘要）";
    parts.push(`### ${index + 1}. ${child.title}\n${summary}`);
  }
  parts.push("请整合为一份父目标验收摘要。");
  return parts.join("\n\n");
}

/**
 * LLM 汇总。模型未配置或调用失败时返回 null（调用方应 fallback 到确定性拼接）。
 */
export async function synthesizeParentRollupSummary(
  input: ParentRollupInput,
  settings: ModelSettingsSlice,
  env?: LlmEnv,
  llmContextSettings?: Partial<LlmContextSettings>,
): Promise<{ summary: string | null; llmError?: string }> {
  const upgraded = upgradeToModelConfig(settings);
  const creds = resolveLlmCredentials(upgraded, "coach", env);
  if (!creds) {
    return { summary: null, llmError: "模型未配置，无法智能汇总" };
  }

  const provider = createOpenAICompatible({
    name: "openx-coach",
    baseURL: creds.baseUrl,
    apiKey: creds.apiKey,
  });

  try {
    const { text } = await generateText({
      model: provider(creds.model),
      system: appendReviewPlaybookToSystem(
        buildRoleSystemPrompt("rollup", llmContextSettings),
        "rollup",
      ),
      prompt: buildRollupPrompt(input),
      maxOutputTokens: 1200,
      temperature: 0.2,
    });
    const summary = text?.trim();
    if (!summary) {
      return { summary: null, llmError: "模型返回空摘要" };
    }
    return { summary };
  } catch (err) {
    return {
      summary: null,
      llmError: formatCoachLlmError(err) ?? "LLM 调用失败",
    };
  }
}
