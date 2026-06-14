import { describe, expect, it } from "vitest";
import { mapForemanTextReply } from "@openx/shared";
import { buildForemanCrewUserPrompt } from "./foreman-crew.js";

describe("buildForemanCrewUserPrompt", () => {
  it("includes goal context and crew message", () => {
    const prompt = buildForemanCrewUserPrompt({
      goal: {
        id: "g1",
        title: "登录页",
        acceptance: "单元测试通过",
        executionPrompt: "实现 OAuth",
      },
      question: {
        kind: "question",
        prompt: "选实现方案",
        context: "【请示工头】\nREST 还是 GraphQL？",
        options: [
          { id: "a", label: "方案A" },
          { id: "b", label: "方案B" },
        ],
      },
    });
    expect(prompt).toContain("登录页");
    expect(prompt).toContain("单元测试通过");
    expect(prompt).toContain("REST 还是 GraphQL");
    expect(prompt).toContain("自然语言");
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
    const outcome = mapForemanTextReply(question, "采用方案A，更简单");
    expect(outcome.kind).toBe("directive");
    if (outcome.kind === "directive") {
      expect(outcome.source).toBe("foreman_llm");
    }
  });

  it("maps escalation marker", () => {
    const outcome = mapForemanTextReply(question, "[上报开发商] 涉及生产库");
    expect(outcome.kind).toBe("escalation");
  });
});
