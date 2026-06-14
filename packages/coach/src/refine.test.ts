import { describe, expect, it } from "vitest";

import { refineGoalRules, coachChatReplyRules } from "./rules.js";

import { refineGoal } from "./service.js";

import {
  SettingsSchema,
  upgradeToModelConfig,
  upsertProvider,
  providerConfigFromTemplate,
} from "@openx/shared";

import { resolveLlmCredentials } from "./llm.js";



describe("refineGoalRules", () => {

  it("extracts title from first line", () => {

    const r = refineGoalRules({ userDraft: "接入登录 API\n验收：接口 200" });

    expect(r.title).toContain("接入登录");

    expect(r.acceptance).toBeTruthy();

    expect(r.executionPrompt).toContain("【用户期望】");

  });

});



describe("coachChatReplyRules", () => {

  it("responds to status query", () => {

    const msg = coachChatReplyRules("最近任务情况", {

      goalsSummary: "· 测试 [进行中] 50%",

    });

    expect(msg).toContain("测试");

  });

});



describe("refineGoal service", () => {

  it("falls back to rules when model credentials missing", async () => {
    const base = upgradeToModelConfig(SettingsSchema.parse({}));
    const openai = upsertProvider(
      base,
      "no-key-openai",
      providerConfigFromTemplate("openai"),
    );
    const settings = {
      ...openai,
      model: {
        coach: "no-key-openai/gpt-4o-mini",
        pi: "zen/big-pickle",
        default: "zen/big-pickle",
      },
    };

    const result = await refineGoal({ userDraft: "写 README" }, settings, [], {
      apiKey: "",
      baseUrl: "",
      model: "",
    });

    expect(result.refined.title).toBeTruthy();
    expect(result.llmError).toMatch(/模型未配置/);
  });

});



describe("zen model config", () => {

  it("resolves public key without env", () => {

    const settings = upgradeToModelConfig(SettingsSchema.parse({}));

    const creds = resolveLlmCredentials(settings, "coach");

    expect(creds?.apiKey).toBe("public");

    expect(creds?.baseUrl).toBe("https://opencode.ai/zen/v1");

    expect(creds?.model).toBe("big-pickle");

  });

});


