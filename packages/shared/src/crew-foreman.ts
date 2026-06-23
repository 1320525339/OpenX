import type {
  CrewDirective,
  CrewEscalation,
  CrewForemanOutcome,
  CrewQuestion,
  ForemanTurnDecision,
  ForemanTurnReviewInput,
} from "./crew.js";
import type { Goal } from "./goal.js";
import { parseCrewMessageFromText } from "./crew.js";

export type ForemanTurnReviewLoopInput = {
  goal: Pick<
    Goal,
    | "id"
    | "title"
    | "conversationId"
    | "foremanThreadId"
    | "acceptance"
    | "executionPrompt"
    | "constraints"
  >;
  turn: ForemanTurnReviewInput;
};

/** 工头 LLM 轮次审阅结构化输出 */
export type ForemanTurnLlmDecision = {
  action: "continue" | "ask_user" | "submit_for_review" | "fail";
  message: string;
  reason?: string;
};

export function mapForemanTurnLlmDecision(
  decision: ForemanTurnLlmDecision,
): ForemanTurnDecision {
  return {
    action: decision.action,
    message: decision.message.trim(),
    reason: decision.reason?.trim(),
    source: "foreman_llm",
  };
}

/** 工头不可用时的轮次审阅兜底 */
export function resolveForemanTurnDecisionAuto(
  input: ForemanTurnReviewLoopInput,
): ForemanTurnDecision {
  const { goal, turn } = input;
  const text = turn.assistantText.trim();
  const implicit = parseCrewMessageFromText(text);

  if (implicit?.escalate || /停服|删库|DELETE|清空.*表|不可恢复/.test(text)) {
    return {
      action: "ask_user",
      message: "施工队提出需开发商确认的操作，请暂停并等待决策。",
      reason: implicit?.prompt ?? "高风险或需确认的操作",
      source: "foreman_rule",
    };
  }

  const hasDeliverables = (turn.deliverables?.length ?? 0) > 0;
  const looksComplete =
    /已完成|已达标|任务完成|交付完成|实现完毕|全部完成/.test(text) ||
    /已完成|已达标/.test(turn.summary);

  if (hasDeliverables && looksComplete) {
    return {
      action: "submit_for_review",
      message: `施工队已产出可验收结果，进入交差验收。`,
      source: "foreman_rule",
    };
  }

  if (/失败|无法继续|不可达|阻塞/.test(text) && !/未失败/.test(text)) {
    return {
      action: "fail",
      message: text.slice(0, 500) || "施工队报告无法继续推进",
      source: "foreman_rule",
    };
  }

  const acceptanceHint = goal.acceptance?.trim()
    ? `对照验收标准「${goal.acceptance.slice(0, 120)}」`
    : "对照任务验收标准";

  return {
    action: "continue",
    message: `继续推进。${acceptanceHint}，产出可验证结果后再交差；有阻塞请【请示工头】。`,
    source: "foreman_rule",
  };
}

export type ForemanLoopInput = {
  goal: Pick<
    Goal,
    | "id"
    | "title"
    | "conversationId"
    | "foremanThreadId"
    | "acceptance"
    | "executionPrompt"
    | "constraints"
  >;
  question: CrewQuestion;
};

/** LLM 工头结构化输出（与 @openx/coach foreman-crew 对齐） */
export type ForemanLlmDecision = {
  action: "directive" | "escalate";
  message: string;
  selectedOptionId?: string;
  reason?: string;
};

/** 将工头自然语言回复映射为 crew 协议 */
export function mapForemanTextReply(
  question: CrewQuestion,
  text: string,
): CrewForemanOutcome {
  const trimmed = text.trim();
  if (/^\[上报开发商\]/.test(trimmed)) {
    return {
      kind: "escalation",
      prompt: question.prompt,
      options: question.options,
      reason: trimmed.replace(/^\[上报开发商\]\s*/, "").trim() || "工头提请开发商决策",
    };
  }
  return {
    kind: "directive",
    message: trimmed,
    source: "foreman_llm",
  };
}

/** 将 LLM 结构化决策映射为 crew 协议（兼容旧路径） */
export function mapForemanLlmDecision(
  question: CrewQuestion,
  decision: ForemanLlmDecision,
): CrewForemanOutcome {
  if (decision.action === "escalate") {
    return {
      kind: "escalation",
      prompt: question.prompt,
      options: question.options,
      reason: decision.reason?.trim() || decision.message.trim() || "工头提请开发商决策",
    };
  }

  const options = question.options ?? [];
  let selectedId = decision.selectedOptionId?.trim();
  if (selectedId && options.length > 0) {
    const valid = options.some((o) => o.id === selectedId);
    if (!valid) selectedId = undefined;
  }

  const directive: CrewDirective = {
    kind: "directive",
    message: decision.message.trim(),
    selectedOptionId: selectedId,
    source: "foreman_llm",
  };
  return directive;
}
/** 工头不可用时的兜底答复（非规则引擎，仅传递上下文） */
export function resolveForemanDirectiveAuto(
  input: ForemanLoopInput,
): CrewForemanOutcome {
  const { question } = input;

  if (question.escalate) {
    return {
      kind: "escalation",
      prompt: question.prompt,
      options: question.options,
      reason: "施工队请求开发商决策",
    };
  }

  return {
    kind: "directive",
    message: `收到。关于「${question.prompt}」，请结合验收标准做出合理判断并继续施工；仍有疑问可再次向工头请示。`,
    source: "foreman_rule",
  };
}

export function isCrewEscalation(
  outcome: CrewForemanOutcome,
): outcome is CrewEscalation {
  return outcome.kind === "escalation";
}

export function isCrewDirective(
  outcome: CrewForemanOutcome,
): outcome is CrewDirective {
  return outcome.kind === "directive";
}
