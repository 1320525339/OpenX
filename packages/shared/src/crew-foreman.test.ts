import { describe, expect, it } from "vitest";
import {
  isCrewDirective,
  isCrewEscalation,
  mapForemanLlmDecision,
  mapForemanTextReply,
  mapForemanTurnLlmDecision,
  resolveForemanDirectiveAuto,
  resolveForemanTurnDecisionAuto,
} from "./crew-foreman.js";
const goal = {
  id: "g1",
  title: "登录页",
  conversationId: "conv-1",
  foremanThreadId: "conv-1",
  acceptance: "单元测试通过",
  executionPrompt: "实现登录",
  constraints: [] as string[],
};

describe("resolveForemanDirectiveAuto", () => {
  it("returns soft fallback without auto-picking options", () => {
    const outcome = resolveForemanDirectiveAuto({
      goal,
      question: {
        kind: "question",
        prompt: "请选择实现方案",
        options: [
          { id: "a", label: "方案A" },
          { id: "b", label: "方案B" },
        ],
      },
    });
    expect(isCrewEscalation(outcome)).toBe(false);
    expect(isCrewDirective(outcome)).toBe(true);
    if (outcome.kind === "directive") {
      expect(outcome.selectedOptionId).toBeUndefined();
      expect(outcome.message).toContain("请选择实现方案");
      expect(outcome.source).toBe("foreman_rule");
    }
  });

  it("escalates when crew requests user decision", () => {
    const outcome = resolveForemanDirectiveAuto({
      goal,
      question: {
        kind: "question",
        prompt: "是否允许删除生产数据？",
        escalate: true,
      },
    });
    expect(outcome.kind).toBe("escalation");
    if (outcome.kind === "escalation") {
      expect(outcome.reason).toContain("开发商");
    }
  });
});

describe("resolveForemanTurnDecisionAuto", () => {
  it("asks user for implicit plan confirmation", () => {
    const decision = resolveForemanTurnDecisionAuto({
      goal,
      turn: {
        assistantText: "建议方案 A。确认后我立即执行停服删除。",
        summary: "待确认",
      },
    });
    expect(decision.action).toBe("ask_user");
  });

  it("submits for review when deliverables and completion cues exist", () => {
    const decision = resolveForemanTurnDecisionAuto({
      goal,
      turn: {
        assistantText: "任务已完成，game.html 可运行。",
        summary: "已完成",
        deliverables: [{ kind: "file", path: "game.html" }],
      },
    });
    expect(decision.action).toBe("submit_for_review");
  });

  it("continues conservatively otherwise", () => {
    const decision = resolveForemanTurnDecisionAuto({
      goal,
      turn: {
        assistantText: "搭了骨架，还在继续。",
        summary: "进行中",
      },
    });
    expect(decision.action).toBe("continue");
    expect(decision.message).toContain("继续推进");
  });
});

describe("mapForemanTurnLlmDecision", () => {
  it("preserves foreman_llm source", () => {
    const decision = mapForemanTurnLlmDecision({
      action: "continue",
      message: "补测试",
      reason: "缺单测",
    });
    expect(decision.source).toBe("foreman_llm");
    expect(decision.action).toBe("continue");
  });
});

describe("mapForemanTextReply", () => {
  const question = {
    kind: "question" as const,
    prompt: "选方案",
    options: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ],
  };

  it("maps natural language directive", () => {
    const outcome = mapForemanTextReply(question, "先做打砖块，简单可验证。");
    expect(outcome.kind).toBe("directive");
    if (outcome.kind === "directive") {
      expect(outcome.source).toBe("foreman_llm");
      expect(outcome.message).toContain("打砖块");
    }
  });

  it("maps escalation marker", () => {
    const outcome = mapForemanTextReply(question, "[上报开发商] 涉及生产库变更");
    expect(outcome.kind).toBe("escalation");
    if (outcome.kind === "escalation") {
      expect(outcome.reason).toContain("生产库");
    }
  });
});

describe("mapForemanLlmDecision", () => {
  it("preserves foreman_llm source for structured legacy path", () => {
    const outcome = mapForemanLlmDecision(
      {
        kind: "question",
        prompt: "选库",
        options: [
          { id: "pg", label: "PostgreSQL" },
          { id: "mysql", label: "MySQL" },
        ],
      },
      { action: "directive", message: "用 PostgreSQL", selectedOptionId: "pg" },
    );
    expect(isCrewDirective(outcome)).toBe(true);
    if (outcome.kind === "directive") {
      expect(outcome.source).toBe("foreman_llm");
      expect(outcome.selectedOptionId).toBe("pg");
    }
  });
});
