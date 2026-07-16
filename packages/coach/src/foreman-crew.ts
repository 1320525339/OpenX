/**
 * 工头 LLM：与施工队自然语言对话
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  buildRoleSystemPrompt,
  mapForemanTextReply,
  upgradeToModelConfig,
  type CrewForemanOutcome,
  type CrewQuestion,
  type LlmContextSettings,
  type ModelSettingsSlice,
} from "@openx/shared";
import { generateCoachText, resolveLlmCredentials, type LlmEnv } from "./llm.js";
import { formatCoachLlmError } from "./llm-errors.js";

export type ForemanCrewGoalContext = {
  id: string;
  title: string;
  acceptance?: string;
  executionPrompt?: string;
  constraints?: string[];
  executorId?: string;
};

export type ForemanCrewInput = {
  goal: ForemanCrewGoalContext;
  question: CrewQuestion;
};

export type ForemanCrewOptions = {
  coachThreadPrefix?: string;
  llmContextSettings?: Partial<LlmContextSettings>;
  browserDesktopContext?: string;
};

const FOREMAN_CREW_PLAYBOOK = [
  "你是 OpenX 工头，正在与外部施工队（Pi / Claude / Codex 等 CLI Agent）直接对话。",
  "施工队会向你请示方案、反馈进展或追问细节；你用自然语言直接回复，像同事间沟通。",
  "",
  "原则：",
  "1. 给出明确、可执行的下一步指引，避免空泛套话。",
  "2. 允许多轮来回；不必一次性说完所有细节。",
  "3. 结合目标验收标准与派单说明做判断，但回复保持简洁。",
  "4. 仅在必须由用户（开发商）决策时，回复**开头**写 [上报开发商] 并说明原因（删库/生产/费用/权限等）。",
  "5. 不要输出 JSON、markdown 代码块或 crew-question 块。",
  "6. 若施工队列出了可选方案（含选项 id），回复**第一行**必须写：选项ID: <id>（从列表中原样抄写），第二行起再写自然语言说明。权限类请求未明确批准时选拒绝类选项。",
].join("\n");

export function buildForemanCrewUserPrompt(
  input: ForemanCrewInput,
  options?: ForemanCrewOptions,
): string {
  const { goal, question } = input;
  const parts = [
    `## 当前目标`,
    `- id: ${goal.id}`,
    `- 标题: ${goal.title}`,
    goal.executorId ? `- 施工队: ${goal.executorId}` : "",
    goal.acceptance ? `- 验收标准:\n${goal.acceptance}` : "",
    goal.executionPrompt ? `- 派单说明:\n${goal.executionPrompt}` : "",
    goal.constraints?.length
      ? `- 约束:\n${goal.constraints.map((c) => `  · ${c}`).join("\n")}`
      : "",
    "",
    "## 施工队消息",
    question.context?.trim() || question.prompt,
  ];
  if (question.requestId) {
    parts.push("", `- requestId: ${question.requestId}`);
  }
  if (question.permissionKind) {
    parts.push(`- permissionKind: ${question.permissionKind}`);
  }
  if (question.options?.length) {
    parts.push(
      "",
      "### 施工队列出的可选方案（必须用选项ID 行选定其一）",
      ...question.options.map((o) => `- ${o.label}${o.id ? ` (${o.id})` : ""}`),
      "",
      "回复格式示例：",
      "选项ID: <上列 id>",
      "……自然语言说明……",
    );
  }
  if (question.escalate) {
    parts.push("", "（施工队已请求上报开发商；若你判断仍需用户决策，请以 [上报开发商] 开头回复）");
  }
  if (options?.browserDesktopContext?.trim()) {
    parts.push("", "## 工头可见浏览器（桌面 Pin）", options.browserDesktopContext.trim());
  }
  parts.push(
    "",
    question.options?.length
      ? "请按格式回复（有选项时第一行必须是 选项ID: …）。"
      : "请直接用自然语言回复施工队。",
  );
  return parts.filter((line) => line !== "").join("\n");
}

function composeForemanCrewSystem(
  baseSystem: string,
  options?: ForemanCrewOptions,
): string {
  const chunks = [FOREMAN_CREW_PLAYBOOK, baseSystem];
  const thread = options?.coachThreadPrefix?.trim();
  if (thread) chunks.push(thread);
  return chunks.join("\n\n");
}

export async function resolveForemanDirectiveViaCoach(
  input: ForemanCrewInput,
  settings: ModelSettingsSlice,
  env?: LlmEnv,
  options?: ForemanCrewOptions,
): Promise<{ outcome: CrewForemanOutcome | null; llmError?: string }> {
  const upgraded = upgradeToModelConfig(settings);
  const creds = resolveLlmCredentials(upgraded, "coach", env);
  if (!creds) {
    return { outcome: null, llmError: "工头 Coach 模型未配置" };
  }

  const baseSystem = buildRoleSystemPrompt("coach", options?.llmContextSettings);
  const system = composeForemanCrewSystem(baseSystem, options);
  const prompt = buildForemanCrewUserPrompt(input, options);

  const provider = createOpenAICompatible({
    name: "openx-foreman-crew",
    baseURL: creds.baseUrl.replace(/\/$/, ""),
    apiKey: creds.apiKey,
    headers: { "User-Agent": "openx-foreman-crew/0.1" },
  });

  try {
    const text = await generateCoachText({
      model: provider(creds.model),
      system,
      prompt,
    });
    if (!text) {
      return { outcome: null, llmError: "工头回复为空" };
    }
    const outcome = mapForemanTextReply(input.question, text);
    return { outcome };
  } catch (err) {
    return {
      outcome: null,
      llmError: formatCoachLlmError(err) ?? (err instanceof Error ? err.message : String(err)),
    };
  }
}
