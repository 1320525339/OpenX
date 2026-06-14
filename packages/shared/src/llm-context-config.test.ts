import { describe, expect, it } from "vitest";
import {
  DEFAULT_LLM_PROMPT_SECTIONS,
  mergeLlmContextSettings,
  renderPromptTemplate,
  resolveLlmContextConfig,
  listPromptSectionsForRole,
} from "./llm-context-config.js";

describe("llm-context-config", () => {
  it("provides default sections for each role", () => {
    expect(DEFAULT_LLM_PROMPT_SECTIONS.length).toBeGreaterThan(5);
    expect(listPromptSectionsForRole(resolveLlmContextConfig(), "coach").length).toBeGreaterThan(0);
    expect(listPromptSectionsForRole(resolveLlmContextConfig(), "operator").length).toBeGreaterThan(0);
  });

  it("merges section overrides from settings", () => {
    const config = resolveLlmContextConfig({
      sectionOverrides: {
        identity: "# 自定义工头身份",
      },
    });
    const identity = config.sections.find((s) => s.id === "identity");
    expect(identity?.content).toBe("# 自定义工头身份");
  });

  it("merges global and project section overrides", () => {
    const merged = mergeLlmContextSettings(
      { sectionOverrides: { identity: "全局工头" } },
      { sectionOverrides: { identity: "项目工头" } },
    );
    expect(merged.sectionOverrides?.identity).toBe("项目工头");
  });

  it("merges brief template sections by id from project over global", () => {
    const merged = mergeLlmContextSettings(
      {
        briefTemplate: {
          sections: [
            {
              id: "userExpectation",
              label: "【全局期望】",
              enabled: true,
              requiredForBug: true,
            },
          ],
        },
      },
      {
        briefTemplate: {
          sections: [
            {
              id: "userExpectation",
              label: "【项目期望】",
              hint: "项目专用",
              enabled: true,
              requiredForBug: true,
            },
          ],
        },
      },
    );
    const label = merged.briefTemplate?.sections?.find(
      (s) => s.id === "userExpectation",
    )?.label;
    expect(label).toBe("【项目期望】");
  });

  it("renders template placeholders", () => {
    const out = renderPromptTemplate("Hello {{config.productName}} at {{runtime.timezone}}", {
      "config.productName": "OpenX",
      "runtime.timezone": "Asia/Shanghai",
    });
    expect(out).toBe("Hello OpenX at Asia/Shanghai");
  });
});
