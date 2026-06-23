import { afterEach, describe, expect, it, vi } from "vitest";
import {
  notifyEventWebhook,
  registerEventWebhookHandler,
  resetEventWebhookHandler,
} from "./event-webhook.js";

describe("event webhook", () => {
  afterEach(() => {
    resetEventWebhookHandler();
  });

  it("ignores notifications when no handler is registered", async () => {
    await expect(
      notifyEventWebhook("goal_failed", {
        goalId: "goal-1",
        errorMessage: "boom",
      }),
    ).resolves.toBeUndefined();
  });

  it("forwards event payload to registered handler", async () => {
    const handler = vi.fn();
    registerEventWebhookHandler(handler);

    await notifyEventWebhook("goal_failed", {
      goalId: "goal-2",
      errorMessage: "runner failed",
    });

    expect(handler).toHaveBeenCalledWith("goal_failed", {
      goalId: "goal-2",
      errorMessage: "runner failed",
    });
  });
});
