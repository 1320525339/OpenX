import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";
import { resolveModelCredentials, upgradeToModelConfig, type Settings } from "@openx/shared";

const EXECUTE_SYSTEM = `你是 OpenX Connect Agent，负责执行工头派发的任务。
用简体中文回复，给出可验收的结果摘要：完成了什么、关键输出、若有限制请说明。
不要编造未执行的操作；若任务无法完成，说明原因与建议。`;

export async function executeWithLlm(
  settings: Settings,
  goal: { title: string; acceptance: string; executionPrompt: string },
  onTextDelta?: (delta: string) => Promise<void>,
  skillsSystemAppend?: string,
): Promise<string> {
  const upgraded = upgradeToModelConfig(settings);
  const ref = upgraded.model?.pi ?? upgraded.model?.default ?? "zen/big-pickle";
  const creds = resolveModelCredentials(upgraded, ref, process.env);
  if (!creds) {
    throw new Error("Connect Agent 无法解析 Pi 执行模型，请在 OpenX 设置中配置 providers");
  }

  const provider = createOpenAICompatible({
    name: "openx-connect",
    baseURL: creds.baseUrl,
    apiKey: creds.apiKey,
  });

  const userPrompt = [
    `任务标题：${goal.title}`,
    `验收标准：${goal.acceptance}`,
    "",
    "执行说明：",
    goal.executionPrompt,
  ].join("\n");

  const system = skillsSystemAppend?.trim()
    ? `${EXECUTE_SYSTEM}\n\n${skillsSystemAppend.trim()}`
    : EXECUTE_SYSTEM;

  const result = streamText({
    model: provider(creds.model),
    system,
    prompt: userPrompt,
    temperature: 0.2,
  });

  let summary = "";
  for await (const delta of result.textStream) {
    summary += delta;
    if (onTextDelta) {
      await onTextDelta(delta);
    }
  }

  summary = summary.trim();
  if (!summary) {
    throw new Error("LLM 返回空结果");
  }
  return summary;
}
