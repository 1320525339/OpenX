/**
 * 工头主动编排：每轮施工反馈后的控制决策（非总结给用户）
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  buildRoleSystemPrompt,
  mapForemanTurnLlmDecision,
  upgradeToModelConfig,
  type ForemanTurnDecision,
  type ForemanTurnLlmDecision,
  type ForemanTurnReviewInput,
  type ModelSettingsSlice,
} from "@openx/shared";
import { z } from "zod";
import { generateCoachText, generateStructuredObject, resolveLlmCredentials, type LlmEnv } from "./llm.js";
import { formatCoachLlmError } from "./llm-errors.js";
import type { ForemanCrewGoalContext, ForemanCrewOptions } from "./foreman-crew.js";

export type ForemanTurnReviewInputBundle = {
  goal: ForemanCrewGoalContext;
  turn: ForemanTurnReviewInput;
};

const ForemanTurnLlmDecisionSchema = z.object({
  action: z.enum(["continue", "ask_user", "submit_for_review", "fail"]),
  message: z.string().min(1),
  reason: z.string().optional(),
});

const FOREMAN_TURN_REVIEW_PLAYBOOK = [
  "你是 OpenX 工头（执行阶段 loop controller），负责阅读施工队一轮执行反馈并决定下一步。",
  "你不是在总结给用户，而是在控制施工循环。",
  "",
  "可选 action：",
  "- continue：尚未达标，给出明确下一步施工指令",
  "- ask_user：必须由开发商决策（删库/停服/费用/权限/不可逆操作等）",
  "- submit_for_review：已满足验收标准且有可验证产出，允许交差进入验收",
  "- fail：目标不可达或施工队明确无法继续",
  "",
  "原则：",
  "1. 对照验收标准与派单说明，宁可 continue 也不要过早 submit_for_review",
  "2. 施工队仅提出方案未执行、或等待确认时，用 ask_user",
  "3. message 写给施工队，简洁可执行",
  "4. 只输出 JSON，不要 markdown 代码块",
].join("\n");

export function buildForemanTurnReviewUserPrompt(
  input: ForemanTurnReviewInputBundle,
  options?: ForemanCrewOptions,
): string {
  const { goal, turn } = input;
  const parts = [
    "## 当前目标",
    `- id: ${goal.id}`,
    `- 标题: ${goal.title}`,
    goal.executorId ? `- 施工队: ${goal.executorId}` : "",
    goal.acceptance ? `- 验收标准:\n${goal.acceptance}` : "",
    goal.executionPrompt ? `- 派单说明:\n${goal.executionPrompt}` : "",
    goal.constraints?.length
      ? `- 约束:\n${goal.constraints.map((c) => `  · ${c}`).join("\n")}`
      : "",
    "",
    "## 施工队本轮输出",
    turn.assistantText.trim() || "（无正文）",
    "",
    "## 执行摘要",
    turn.summary.trim() || "（无摘要）",
  ];
  if (turn.deliverables?.length) {
    parts.push(
      "",
      "## 本轮产出",
      ...turn.deliverables.map((d) => {
        if (d.kind === "file") return `- 文件: ${d.path}`;
        if (d.kind === "link") return `- 链接: ${d.url}`;
        return `- 片段: ${d.label ?? "snippet"}`;
      }),
    );
  }
  if (typeof turn.round === "number") {
    parts.push("", `## 循环轮次: ${turn.round + 1}`);
  }
  if (options?.browserDesktopContext?.trim()) {
    parts.push("", "## 工头可见浏览器（桌面 Pin）", options.browserDesktopContext.trim());
  }
  parts.push("", "请输出 JSON：{ action, message, reason? }");
  return parts.filter((line) => line !== "").join("\n");
}

function composeForemanTurnReviewSystem(
  baseSystem: string,
  options?: ForemanCrewOptions,
): string {
  const chunks = [FOREMAN_TURN_REVIEW_PLAYBOOK, baseSystem];
  const thread = options?.coachThreadPrefix?.trim();
  if (thread) chunks.push(thread);
  return chunks.join("\n\n");
}

/** 从自然语言 fallback（LLM 未返回 JSON 时） */
function mapForemanTurnTextReply(text: string): ForemanTurnDecision | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (/^\[上报开发商\]/.test(trimmed)) {
    return {
      action: "ask_user",
      message: "请暂停施工，等待开发商决策。",
      reason: trimmed.replace(/^\[上报开发商\]\s*/, "").trim() || "工头提请开发商决策",
      source: "foreman_llm",
    };
  }
  if (/交差|可验收|submit_for_review/i.test(trimmed)) {
    return {
      action: "submit_for_review",
      message: trimmed,
      source: "foreman_llm",
    };
  }
  return {
    action: "continue",
    message: trimmed,
    source: "foreman_llm",
  };
}

export async function resolveForemanTurnReviewViaCoach(
  input: ForemanTurnReviewInputBundle,
  settings: ModelSettingsSlice,
  env?: LlmEnv,
  options?: ForemanCrewOptions,
): Promise<{ decision: ForemanTurnDecision | null; llmError?: string }> {
  const upgraded = upgradeToModelConfig(settings);
  const creds = resolveLlmCredentials(upgraded, "coach", env);
  if (!creds) {
    return { decision: null, llmError: "工头 Coach 模型未配置" };
  }

  const baseSystem = buildRoleSystemPrompt("coach", options?.llmContextSettings);
  const system = composeForemanTurnReviewSystem(baseSystem, options);
  const prompt = buildForemanTurnReviewUserPrompt(input, options);

  const provider = createOpenAICompatible({
    name: "openx-foreman-turn",
    baseURL: creds.baseUrl.replace(/\/$/, ""),
    apiKey: creds.apiKey,
    headers: { "User-Agent": "openx-foreman-turn/0.1" },
  });

  try {
    const structured = await generateStructuredObject<ForemanTurnLlmDecision>({
      model: provider(creds.model),
      schema: ForemanTurnLlmDecisionSchema,
      system,
      prompt,
    });
    if (structured) {
      return { decision: mapForemanTurnLlmDecision(structured) };
    }

    const text = await generateCoachText({
      model: provider(creds.model),
      system,
      prompt,
    });
    if (!text) {
      return { decision: null, llmError: "工头轮次审阅回复为空" };
    }
    const parsed = mapForemanTurnTextReply(text);
    return parsed ? { decision: parsed } : { decision: null, llmError: "无法解析工头轮次决策" };
  } catch (err) {
    return {
      decision: null,
      llmError: formatCoachLlmError(err) ?? (err instanceof Error ? err.message : String(err)),
    };
  }
}
