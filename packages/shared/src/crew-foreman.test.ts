import { describe, expect, it } from "vitest";
import {
  isCrewDirective,
  isCrewEscalation,
  mapForemanLlmDecision,
  mapForemanTextReply,
  resolveForemanDirectiveAuto,
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
