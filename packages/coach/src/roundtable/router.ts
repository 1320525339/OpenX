import {
  ROUNDTABLE_ALL_PARTICIPANTS_ID,
  ROUNDTABLE_DEFAULT_PARALLEL_REPLIES,
  ROUNDTABLE_FOREMAN_PROFILE_ID,
  ROUNDTABLE_MAX_PARALLEL_REPLIES,
  type ChatRoundMode,
  type ConversationParticipant,
} from "@openx/shared";

export type MentionRouteResult =
  | { ok: true; participantIds: string[]; estimatedCalls: number; synthesize: boolean }
  | { ok: false; error: string };

/**
 * 解析 @mention / 发散参与者。
 * - direct 无 mention → 仅工头
 * - __all__ → 所有 enabled 非工头（受上限裁剪需显式报错）
 * - 多个 id → 并行，硬上限 6
 */
export function resolveRoundParticipants(input: {
  mode: ChatRoundMode;
  mentionParticipantIds: string[];
  participants: ConversationParticipant[];
  synthesize?: boolean;
}): MentionRouteResult {
  const enabled = input.participants.filter((p) => p.enabled);
  const foreman = enabled.find((p) => p.profileId === ROUNDTABLE_FOREMAN_PROFILE_ID);
  const nonForeman = enabled.filter((p) => p.profileId !== ROUNDTABLE_FOREMAN_PROFILE_ID);
  const byId = new Map(enabled.map((p) => [p.id, p]));

  const synthesize =
    input.synthesize ?? (input.mode === "diverge");

  if (input.mode === "direct" && input.mentionParticipantIds.length === 0) {
    if (!foreman) {
      return { ok: false, error: "圆桌缺少工头助手席位" };
    }
    return {
      ok: true,
      participantIds: [foreman.id],
      estimatedCalls: 1,
      synthesize: false,
    };
  }

  let selected: ConversationParticipant[] = [];
  const mentions = input.mentionParticipantIds;

  if (mentions.includes(ROUNDTABLE_ALL_PARTICIPANTS_ID)) {
    selected = [...nonForeman];
  } else {
    for (const id of mentions) {
      const p = byId.get(id);
      if (!p) {
        return { ok: false, error: `未知或已静音的成员：${id}` };
      }
      if (!selected.some((x) => x.id === p.id)) selected.push(p);
    }
  }

  if (input.mode === "diverge" && selected.length === 0) {
    selected = nonForeman.slice(0, ROUNDTABLE_DEFAULT_PARALLEL_REPLIES);
  }

  // direct 多 @ 时排除仅工头重复？允许工头被单独 @
  if (selected.length === 0) {
    return { ok: false, error: "没有可回答的成员" };
  }

  if (selected.length > ROUNDTABLE_MAX_PARALLEL_REPLIES) {
    return {
      ok: false,
      error: `单轮最多 ${ROUNDTABLE_MAX_PARALLEL_REPLIES} 个 AI 并行回答，请减少 @ 成员`,
    };
  }

  const replyCalls = selected.length;
  const estimatedCalls = replyCalls + (synthesize ? 1 : 0);
  return {
    ok: true,
    participantIds: selected.map((p) => p.id),
    estimatedCalls,
    synthesize,
  };
}

export function lengthInstruction(
  length: "short" | "medium" | "long" | undefined,
): string {
  switch (length) {
    case "short":
      return "请用不超过 5 句话简洁回答。";
    case "long":
      return "可以展开论证，但仍保持结构清晰。";
    case "medium":
    default:
      return "请用中等篇幅回答，突出关键点。";
  }
}

export function outputGoalInstruction(
  goal: "ideas" | "plans" | "risks" | "counterexamples" | "free" | undefined,
): string {
  switch (goal) {
    case "ideas":
      return "输出目标：提出多种想法与切入角度。";
    case "plans":
      return "输出目标：给出可落地的方案步骤。";
    case "risks":
      return "输出目标：列出主要风险与缓解。";
    case "counterexamples":
      return "输出目标：给出反例与挑战假设。";
    case "free":
    default:
      return "输出目标：自由发挥你的专业视角。";
  }
}
