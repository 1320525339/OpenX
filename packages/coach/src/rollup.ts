/**
 * Coach 父目标智能汇总：将多个子任务结果整合为连贯的验收摘要。
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";
import { upgradeToModelConfig, type ModelSettingsSlice } from "@openx/shared";
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

const ROLLUP_SYSTEM = [
  "你是 OpenX 工头层的汇总员。父目标的多个子任务已全部完成，你需要将各子任务结果整合为一份连贯的父目标验收摘要。",
  "要求：",
  "1. 用中文 Markdown，结构清晰（可用小标题或列表）。",
  "2. 保留关键事实：文件路径、API、数据、命令输出等可验证信息，不要臆造。",
  "3. 指出子任务之间的衔接关系与整体完成度。",
  "4. 控制在 800 字以内。",
  "5. 仅输出摘要正文，不要 JSON 或多余解释。",
].join("\n");

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
      system: ROLLUP_SYSTEM,
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
