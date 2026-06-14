import { describe, expect, it } from "vitest";
import {
  formatCrewDirectiveForPrompt,
  formatCrewForemanReplyForPrompt,
  formatCrewQuestionBlock,
  parseCrewMessageFromText,
  parseCrewQuestionFromText,
  type CrewQuestion,
} from "./crew.js";

describe("crew protocol", () => {
  const question: CrewQuestion = {
    kind: "question",
    prompt: "请选择实现方案",
    options: [
      { id: "a", label: "方案A" },
      { id: "b", label: "方案B" },
    ],
  };

  it("round-trips crew-question fence", () => {
    const text = `分析完成。\n${formatCrewQuestionBlock(question)}`;
    expect(parseCrewQuestionFromText(text)?.options?.[1]?.id).toBe("b");
    expect(parseCrewMessageFromText(text)?.context).toBe(text);
  });

  it("parses natural language foreman ask", () => {
    const text = "进度更新。\n\n【请示工头】\n贪吃蛇和打砖块你更倾向哪个？";
    const parsed = parseCrewMessageFromText(text);
    expect(parsed?.prompt).toContain("打砖块");
    expect(parsed?.context).toBe(text);
  });

  it("formats foreman reply for steer prompt", () => {
    const block = formatCrewForemanReplyForPrompt({
      kind: "directive",
      message: "先做打砖块，骨架轻量一些。",
      source: "foreman_llm",
    });
    expect(block).toContain("【工头】");
    expect(block).toContain("打砖块");
    expect(formatCrewDirectiveForPrompt({
      kind: "directive",
      message: "test",
      source: "foreman_llm",
    })).toBe(formatCrewForemanReplyForPrompt({
      kind: "directive",
      message: "test",
      source: "foreman_llm",
    }));
  });
});
