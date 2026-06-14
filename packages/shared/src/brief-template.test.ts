import { describe, expect, it } from "vitest";
import {
  DEFAULT_BRIEF_TEMPLATE_SECTIONS,
  formatBriefTemplateBlock,
  resolveBriefTemplateSections,
  buildBriefExecutionPrompt,
} from "./brief-template.js";

describe("brief-template", () => {
  it("formats enabled sections for prompt injection", () => {
    const block = formatBriefTemplateBlock(DEFAULT_BRIEF_TEMPLATE_SECTIONS);
    expect(block).toContain("【用户期望】");
    expect(block).toContain("bug/异常类必填");
  });

  it("respects custom sections from llmContext", () => {
    const sections = resolveBriefTemplateSections({
      briefTemplate: {
        sections: [
          {
            id: "custom",
            label: "【自定义】",
            hint: "测试",
            enabled: true,
            requiredForBug: false,
          },
        ],
      },
    });
    expect(sections).toHaveLength(1);
    expect(formatBriefTemplateBlock(sections)).toContain("【自定义】");
  });

  it("builds execution prompt from section values", () => {
    const prompt = buildBriefExecutionPrompt(DEFAULT_BRIEF_TEMPLATE_SECTIONS, {
      issueType: "bug",
      actualPhenomenon: "按钮无响应",
    });
    expect(prompt).toContain("【问题类型】");
    expect(prompt).toContain("按钮无响应");
  });
});
