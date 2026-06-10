import { describe, expect, it } from "vitest";
import { SettingsSchema, upgradeToModelConfig } from "@openx/shared";
import { coachChatReply, refineGoal } from "./service.js";

const REAL_ENV_TIMEOUT_MS = 60_000;

const zenSettings = () => upgradeToModelConfig(SettingsSchema.parse({}));

describe("coachChatReply (real env)", () => {
  it(
    "returns agent reply from zen",
    async () => {
      const result = await coachChatReply("你好，简单打个招呼", {}, zenSettings());

      expect(result.message.length).toBeGreaterThan(0);
    },
    REAL_ENV_TIMEOUT_MS,
  );
});

describe("refineGoal (real env)", () => {
  it(
    "returns structured fields from zen",
    async () => {
      const { refined } = await refineGoal(
        { userDraft: "写 README\n验收：文档完整可读" },
        zenSettings(),
      );

      expect(refined.title.length).toBeGreaterThan(0);
      expect(refined.acceptance.length).toBeGreaterThan(0);
      expect(refined.executionPrompt.length).toBeGreaterThan(10);
    },
    REAL_ENV_TIMEOUT_MS,
  );
});
