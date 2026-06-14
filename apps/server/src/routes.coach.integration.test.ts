import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "./db.js";
import { app } from "./routes.js";
import {
  REAL_ENV_TIMEOUT_MS,
  seedTestProjectAndConversation,
  TEST_CONVERSATION_ID,
} from "./test-helpers.js";

const jsonHeaders = { "Content-Type": "application/json" };

async function post(path: string, body?: unknown) {
  return app.request(path, {
    method: "POST",
    headers: jsonHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/** 真实 LLM 集成测试（较慢，默认随 pnpm test 运行；CI 可单独排除） */
describe("coach API (real LLM)", () => {
  beforeEach(() => {
    process.env.OPENX_DB_PATH = ":memory:";
    resetDb();
    seedTestProjectAndConversation();
  });

  afterEach(() => {
    resetDb();
    delete process.env.OPENX_DB_PATH;
  });

  it(
    "refine returns structured goal fields via real LLM",
    async () => {
      const res = await post("/api/coach/refine", {
        userDraft: "实现登录 API\n验收：返回 200",
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        title: string;
        acceptance: string;
        executionPrompt: string;
      };
      expect(body.title.length).toBeGreaterThan(0);
      expect(body.acceptance.length).toBeGreaterThan(0);
      expect(body.executionPrompt.length).toBeGreaterThan(10);
    },
    REAL_ENV_TIMEOUT_MS,
  );

  it(
    "coach chat returns reply via real LLM",
    async () => {
      const res = await post("/api/coach/chat", {
        conversationId: TEST_CONVERSATION_ID,
        message: "最近任务情况",
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { message: string };
      expect(body.message.length).toBeGreaterThan(0);
    },
    REAL_ENV_TIMEOUT_MS,
  );

  it(
    "persists coach messages",
    async () => {
      await post("/api/coach/chat", {
        conversationId: TEST_CONVERSATION_ID,
        message: "你好",
      });
      const res = await app.request(
        `/api/coach/messages?conversationId=${TEST_CONVERSATION_ID}`,
      );
      const { messages } = (await res.json()) as {
        messages: { role: string; text: string }[];
      };
      expect(messages.length).toBeGreaterThanOrEqual(2);
      expect(messages.some((m) => m.role === "user" && m.text === "你好")).toBe(true);
    },
    REAL_ENV_TIMEOUT_MS,
  );
});
