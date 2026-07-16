import type {
  CrewDirective,
  CrewEscalation,
  CrewForemanOutcome,
  CrewQuestion,
  CrewQuestionOption,
  ForemanTurnDecision,
  ForemanTurnReviewInput,
} from "./crew.js";
import type { Goal } from "./goal.js";
import { parseCrewMessageFromText } from "./crew.js";

/** 将回复关联到原请求（replyTo = question.requestId） */
export function withCrewReplyCorrelation(
  question: CrewQuestion,
  outcome: CrewForemanOutcome,
): CrewForemanOutcome {
  const replyTo = question.requestId?.trim();
  if (!replyTo) return outcome;
  if (outcome.kind === "directive") {
    return {
      ...outcome,
      replyTo,
      ...(question.sessionId && !outcome.sessionId
        ? { sessionId: question.sessionId }
        : {}),
      ...(question.permissionKind && !outcome.permissionKind
        ? { permissionKind: question.permissionKind }
        : {}),
      ...(question.turnId != null && outcome.turnId == null
        ? { turnId: question.turnId }
        : {}),
    };
  }
  return {
    ...outcome,
    replyTo,
    ...(question.sessionId && !outcome.sessionId
      ? { sessionId: question.sessionId }
      : {}),
    ...(question.permissionKind && !outcome.permissionKind
      ? { permissionKind: question.permissionKind }
      : {}),
    ...(question.turnId != null && outcome.turnId == null
      ? { turnId: question.turnId }
      : {}),
  };
}

/** 权限类选项中优先选 reject（默认拒绝） */
export function pickDenySafeOptionId(
  question: CrewQuestion,
): string | undefined {
  const options = question.options ?? [];
  if (!options.length) return undefined;

  const looksPermission =
    question.permissionKind === "write" ||
    question.permissionKind === "shell" ||
    options.some(
      (o) =>
        /reject|deny/i.test(o.id) ||
        /拒绝|deny|reject/i.test(o.label),
    );

  if (!looksPermission) return undefined;

  const reject = options.find(
    (o) =>
      /reject/i.test(o.id) ||
      o.id === "deny" ||
      /拒绝|deny|reject/i.test(o.label),
  );
  return reject?.id;
}

function parseSelectedOptionIdFromText(
  text: string,
  options: CrewQuestionOption[],
): { selectedOptionId?: string; message: string } {
  const match = text.match(
    /^(?:选项ID|selectedOptionId)\s*[：:]\s*(\S+)\s*\n?/i,
  );
  if (!match?.[1]) return { message: text };
  const id = match[1].trim();
  const valid = options.some((o) => o.id === id);
  const message = text.slice(match[0].length).trim() || text;
  return { selectedOptionId: valid ? id : undefined, message };
}

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
  const message = decision.message.trim();
  return {
    action: decision.action,
    message:
      message ||
      "继续推进，按验收标准完成可验证产出；有阻塞请【请示工头】。",
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
    return withCrewReplyCorrelation(question, {
      kind: "escalation",
      prompt: question.prompt,
      options: question.options,
      reason: trimmed.replace(/^\[上报开发商\]\s*/, "").trim() || "工头提请开发商决策",
    });
  }

  const options = question.options ?? [];
  const { selectedOptionId, message } = parseSelectedOptionIdFromText(
    trimmed,
    options,
  );

  return withCrewReplyCorrelation(question, {
    kind: "directive",
    message: message || trimmed,
    selectedOptionId,
    source: "foreman_llm",
  });
}

/** 将 LLM 结构化决策映射为 crew 协议（兼容旧路径） */
export function mapForemanLlmDecision(
  question: CrewQuestion,
  decision: ForemanLlmDecision,
): CrewForemanOutcome {
  if (decision.action === "escalate") {
    return withCrewReplyCorrelation(question, {
      kind: "escalation",
      prompt: question.prompt,
      options: question.options,
      reason: decision.reason?.trim() || decision.message.trim() || "工头提请开发商决策",
    });
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
  return withCrewReplyCorrelation(question, directive);
}
/** 工头不可用时的兜底答复（非规则引擎，仅传递上下文） */
export function resolveForemanDirectiveAuto(
  input: ForemanLoopInput,
): CrewForemanOutcome {
  const { question } = input;

  if (question.escalate) {
    return withCrewReplyCorrelation(question, {
      kind: "escalation",
      prompt: question.prompt,
      options: question.options,
      reason: "施工队请求开发商决策",
    });
  }

  const denyOptionId = pickDenySafeOptionId(question);
  return withCrewReplyCorrelation(question, {
    kind: "directive",
    message: denyOptionId
      ? `权限请求未获明确结构化批准，默认拒绝（选项 ${denyOptionId}）。关于「${question.prompt}」，如需写入请由开发商明确批准后重试。`
      : `收到。关于「${question.prompt}」，请结合验收标准做出合理判断并继续施工；仍有疑问可再次向工头请示。`,
    selectedOptionId: denyOptionId,
    source: "foreman_rule",
  });
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
