import { describe, expect, it } from "vitest";
import {
  formatCrewDirectiveForPrompt,
  formatCrewForemanReplyForPrompt,
  formatCrewQuestionBlock,
  foremanTurnDecisionToDirective,
  parseCrewMessageFromText,
  parseCrewQuestionFromText,
  parseForemanTurnDecisionFromText,
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

  it("parses implicit plan confirmation as foreman ask", () => {
    const text = [
      "我的建议是 **方案 A**，因为当前唯一的 running goal 就是清理会话自身，停服删除最干净。",
      "确认后我立即执行：停服 -> 备份 -> 清空 -> 重启 -> 验证。",
    ].join("\n");
    const parsed = parseCrewMessageFromText(text);
    expect(parsed?.escalate).toBe(true);
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

  it("round-trips foreman-turn-decision fence", () => {
    const text = [
      "工头判定",
      "```foreman-turn-decision",
      JSON.stringify({
        action: "submit_for_review",
        message: "已满足验收标准",
        source: "foreman_llm",
      }),
      "```",
    ].join("\n");
    const parsed = parseForemanTurnDecisionFromText(text);
    expect(parsed?.action).toBe("submit_for_review");
    const directive = foremanTurnDecisionToDirective(parsed!);
    expect(directive.pauseUntilUser).toBe(false);
  });

  it("maps ask_user decision to pause directive", () => {
    const directive = foremanTurnDecisionToDirective({
      action: "ask_user",
      message: "等待开发商",
      source: "foreman_rule",
    });
    expect(directive.pauseUntilUser).toBe(true);
  });
});
