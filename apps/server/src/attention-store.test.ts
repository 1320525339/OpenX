import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, insertGoal } from "./db.js";
import { app } from "./routes.js";
import { seedTestProjectAndConversation, TEST_CONVERSATION_ID } from "./test-helpers.js";
import type { Goal } from "@openx/shared";
import { pushIsland, islandForAwaitingReview } from "./island-push.js";
import { listOpenAttentions } from "./attention-store.js";

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  const now = new Date().toISOString();
  return {
    id: "g-attn-1",
    orderNo: 1,
    conversationId: TEST_CONVERSATION_ID,
    title: "Attention 测试",
    acceptance: "ok",
    executionPrompt: "do",
    constraints: [],
    executorId: "pi",
    status: "awaiting_review",
    progress: 100,
    dependsOn: [],
    priority: "medium",
    autoReview: false,
    iterationCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("attention records", () => {
  beforeEach(() => {
    process.env.OPENX_DB_PATH = ":memory:";
    resetDb();
    seedTestProjectAndConversation();
  });

  it("pushIsland durable 写入 open attention", () => {
    const goal = makeGoal();
    insertGoal(goal);
    pushIsland(islandForAwaitingReview(goal));
    const open = listOpenAttentions();
    expect(open.some((a) => a.key === "goal.awaiting_review:g-attn-1")).toBe(true);
  });

  it("GET /api/island/attentions 从 Goal 补齐", async () => {
    insertGoal(makeGoal({ id: "g-attn-2" }));
    const res = await app.request("/api/island/attentions?state=open");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { attentions: Array<{ key: string }> };
    expect(body.attentions.some((a) => a.key === "goal.awaiting_review:g-attn-2")).toBe(
      true,
    );
  });

  it("POST ack 将 attention 标为 acknowledged", async () => {
    const goal = makeGoal({ id: "g-attn-3" });
    insertGoal(goal);
    pushIsland(islandForAwaitingReview(goal));
    const key = encodeURIComponent("goal.awaiting_review:g-attn-3");
    const res = await app.request(`/api/island/attentions/${key}/ack`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: string };
    expect(body.state).toBe("acknowledged");
  });
});
