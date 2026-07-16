import { z } from "zod";
import {
  RoundSynthesisPayloadSchema,
  type RoundSynthesisPayload,
  type ModelSettingsSlice,
} from "@openx/shared";
import {
  createModel,
  generateCoachText,
  generateStructuredObject,
  resolveLlmCredentials,
} from "../llm.js";

export async function synthesizeRoundtable(input: {
  settings: ModelSettingsSlice;
  roundId: string;
  userMessage: string;
  replies: Array<{ displayName: string; text: string }>;
}): Promise<RoundSynthesisPayload> {
  const creds = resolveLlmCredentials(input.settings, "coach");
  if (!creds) {
    const joined = input.replies.map((r) => `【${r.displayName}】${r.text}`).join("\n\n");
    return {
      roundId: input.roundId,
      consensus: "（未配置工头模型，以下为原文拼接）",
      disagreements: "",
      recommendation: joined.slice(0, 2000) || "暂无回复可总结",
      nextSteps: "配置工头模型后可重新生成总结，或点击生成任务单。",
    };
  }

  const model = createModel(creds);
  const repliesBlock = input.replies
    .map((r, i) => `### ${i + 1}. ${r.displayName}\n${r.text}`)
    .join("\n\n");

  try {
    return await generateStructuredObject<RoundSynthesisPayload>({
      model,
      schema: RoundSynthesisPayloadSchema.extend({
        roundId: z.literal(input.roundId).or(z.string()),
      }),
      system:
        "你是 OpenX 工头助手，正在主持 AI 圆桌。根据各成员独立回答，整理共识、分歧、推荐方案与下一步。不要编造成员未提及的事实。",
      prompt: `用户问题：\n${input.userMessage}\n\n成员回答：\n${repliesBlock}\n\n请输出 JSON，字段：roundId（必须为 ${input.roundId}）、consensus、disagreements、recommendation、nextSteps。`,
    }).then((obj) => ({
      ...obj,
      roundId: input.roundId,
    }));
  } catch {
    const text = await generateCoachText({
      model,
      system: "你是工头助手，用中文总结圆桌讨论。",
      prompt: `用户问题：${input.userMessage}\n\n${repliesBlock}\n\n请分四段：共识 / 分歧 / 推荐方案 / 下一步`,
    });
    return {
      roundId: input.roundId,
      consensus: text.slice(0, 800),
      disagreements: "",
      recommendation: text.slice(0, 1200),
      nextSteps: "可继续讨论或生成任务单。",
    };
  }
}
