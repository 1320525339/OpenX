import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultModelSection, createDefaultProvidersMap } from "@openx/shared";
import { resetDb } from "./db.js";
import { resetConnections } from "./connect-store.js";
import { app } from "./routes.js";
import { resetOrchestrator } from "./orchestrator.js";
import {
  GOAL_API_TEST_TIMEOUT_MS,
  MOCK_PI_TIMEOUT_MS,
  seedTestProjectAndConversation,
  TEST_CONVERSATION_ID,
  waitForGoalStatus,
} from "./test-helpers.js";

vi.mock("@openx/coach", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openx/coach")>();
  return {
    ...actual,
    refineGoal: vi.fn(async (input: { userDraft: string; constraints?: string[] }) => ({
      refined: {
        title: input.userDraft.slice(0, 48) || "未命名目标",
        acceptance: "验收通过",
        executionPrompt: input.userDraft,
        constraints: input.constraints ?? [],
      },
    })),
    coachChatReply: vi.fn(async () => ({ message: "ok" })),
    reviewGoalCompletion: vi.fn(async () => ({
      verdict: null,
      llmError: "routes.test mock",
    })),
    reviewParentGoalCompletion: vi.fn(async () => ({
      verdict: null,
      llmError: "routes.test mock",
    })),
  };
});

vi.mock("./review-verify.js", () => ({
  runReviewVerification: vi.fn(() => []),
  formatVerifyEvidenceBlock: vi.fn(() => "## 验证命令输出（mock）\n（无）"),
}));

function enableMockPi() {
  process.env.OPENX_MOCK_PI = "1";
  resetOrchestrator();
}

function disableMockPi() {
  delete process.env.OPENX_MOCK_PI;
  resetOrchestrator();
}

const jsonHeaders = { "Content-Type": "application/json" };

async function post(path: string, body?: unknown) {
  return app.request(path, {
    method: "POST",
    headers: jsonHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function patch(path: string, body: unknown) {
  return app.request(path, {
    method: "PATCH",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
}

function goalBody(body: Record<string, unknown> = {}) {
  return { conversationId: TEST_CONVERSATION_ID, ...body };
}

describe("goals API", () => {
  beforeEach(() => {
    process.env.OPENX_DB_PATH = ":memory:";
    resetDb();
    seedTestProjectAndConversation();
    enableMockPi();
  });

  afterEach(() => {
    resetDb();
    delete process.env.OPENX_DB_PATH;
    disableMockPi();
  });

  it("deletes goal permanently", async () => {
    const create = await post("/api/goals", goalBody({
      userDraft: "待删除",
      executorId: "pi",
      autoStart: false,
    }));
    expect(create.status).toBe(201);
    const { goal } = (await create.json()) as { goal: { id: string } };

    const del = await app.request(`/api/goals/${goal.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    const body = (await del.json()) as { deleted: string[] };
    expect(body.deleted).toContain(goal.id);

    const get = await app.request(`/api/goals/${goal.id}`);
    expect(get.status).toBe(404);
  });

  it("batch deletes multiple goals", async () => {
    const a = await post("/api/goals", goalBody({ userDraft: "A", executorId: "pi", autoStart: false }));
    const b = await post("/api/goals", goalBody({ userDraft: "B", executorId: "pi", autoStart: false }));
    const ga = (await a.json()) as { goal: { id: string } };
    const gb = (await b.json()) as { goal: { id: string } };

    const res = await post("/api/goals/batch", {
      action: "delete",
      ids: [ga.goal.id, gb.goal.id],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: string[] };
    expect(body.ok).toHaveLength(2);

    const list = await app.request("/api/goals");
    const { goals } = (await list.json()) as { goals: { id: string }[] };
    expect(goals.some((g) => g.id === ga.goal.id || g.id === gb.goal.id)).toBe(false);
  });

  it("creates draft goal without autoStart", async () => {
    await app.request("/api/settings", {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify({
        autoExecute: false,
        model: { coach: "zen/big-pickle", pi: "zen/big-pickle", default: "zen/big-pickle" },
      }),
    });

    const res = await post("/api/goals", goalBody({
      userDraft: "写单元测试",
      executorId: "pi",
      autoStart: false,
    }));
    expect(res.status).toBe(201);
    const { goal } = (await res.json()) as { goal: { status: string; executorId: string } };
    expect(goal.status).toBe("draft");
    // executorId 等于默认执行器时视为未明确选择，允许规则推荐覆盖（去偏置后
    // 本地任务可能推荐 ACP CLI），结果依赖本机检测到的执行器，仅断言非空
    expect(goal.executorId).toBeTruthy();
  });

  it(
    "creates and auto-starts with Pi executor",
    async () => {
      const res = await post("/api/goals", goalBody({
        userDraft: "只回复 OK，不要调用任何工具",
        title: "Pi 冒烟",
        acceptance: "回复包含 OK",
        executionPrompt: "只回复 OK，不要调用任何工具，不要读写文件。",
        executorId: "pi",
        autoStart: true,
      }));
      expect(res.status).toBe(201);
      const { goal } = (await res.json()) as { goal: { status: string; id: string } };
      expect(goal.status).toBe("running");

      const updated = await waitForGoalStatus(goal.id, ["awaiting_review", "failed"], {
        timeoutMs: MOCK_PI_TIMEOUT_MS,
      });
      expect(updated.status).toBe("awaiting_review");
    },
    GOAL_API_TEST_TIMEOUT_MS,
  );

  it(
    "approve only from awaiting_review",
    async () => {
      const create = await post("/api/goals", goalBody({
        userDraft: "只回复 OK，不要调用任何工具",
        title: "验收流",
        acceptance: "回复包含 OK",
        executionPrompt: "只回复 OK，不要调用任何工具。",
        autoStart: false,
        autoReview: false,
      }));
      const { goal } = (await create.json()) as { goal: { id: string } };

      const badApprove = await post(`/api/goals/${goal.id}/approve`);
      expect(badApprove.status).toBe(400);

      await post(`/api/goals/${goal.id}/start`);
      const running = await waitForGoalStatus(goal.id, ["awaiting_review"], {
        timeoutMs: MOCK_PI_TIMEOUT_MS,
      });
      expect(running.status).toBe("awaiting_review");

      const ok = await post(`/api/goals/${goal.id}/approve`);
      expect(ok.status).toBe(200);
      const { goal: done } = (await ok.json()) as { goal: { status: string } };
      expect(done.status).toBe("done");
    },
    GOAL_API_TEST_TIMEOUT_MS,
  );

  it(
    "rework only from awaiting_review",
    async () => {
      const create = await post("/api/goals", goalBody({
        userDraft: "只回复 OK，不要调用任何工具",
        title: "返工流",
        acceptance: "回复包含 OK",
        executionPrompt: "只回复 OK，不要调用任何工具。",
        autoStart: false,
      }));
      const { goal } = (await create.json()) as { goal: { id: string } };

      const bad = await post(`/api/goals/${goal.id}/rework`, { reason: "太早" });
      expect(bad.status).toBe(400);

      await post(`/api/goals/${goal.id}/start`);
      const g = await waitForGoalStatus(goal.id, ["awaiting_review"], {
        timeoutMs: MOCK_PI_TIMEOUT_MS,
      });
      expect(g.status).toBe("awaiting_review");

      const ok = await post(`/api/goals/${goal.id}/rework`, { reason: "需补测试" });
      expect(ok.status).toBe(200);
      const { goal: reworked } = (await ok.json()) as {
        goal: { status: string; effectStatus?: string; reworkReason?: string };
      };
      expect(reworked.status).toBe("running");
      expect(reworked.effectStatus).toBe("rework");
      expect(reworked.reworkReason).toBe("需补测试");
    },
    GOAL_API_TEST_TIMEOUT_MS,
  );
});

describe("coach provider API", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "openx-coach-route-test-"));
    const configPath = join(tempDir, "config.json");
    const providersPath = join(tempDir, "providers.json");
    writeFileSync(
      configPath,
      JSON.stringify({ revision: 0, model: createDefaultModelSection() }),
    );
    writeFileSync(providersPath, JSON.stringify(createDefaultProvidersMap()));
    process.env.OPENX_CONFIG_PATH = configPath;
    process.env.OPENX_PROVIDERS_PATH = providersPath;
    process.env.OPENX_DB_PATH = ":memory:";
    resetDb();
  });

  afterEach(() => {
    resetDb();
    delete process.env.OPENX_DB_PATH;
    delete process.env.OPENX_CONFIG_PATH;
    delete process.env.OPENX_PROVIDERS_PATH;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("lists llm providers", async () => {
    const res = await app.request("/api/coach/providers");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { providers: { id: string; name: string }[] };
    expect(body.providers.some((p) => p.id === "opencode-zen")).toBe(true);
    expect(body.providers.some((p) => p.id === "openai")).toBe(true);
  });

  it("returns coach status with slug", async () => {
    const res = await app.request("/api/coach/status");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { providerId?: string; ready: boolean; ref?: string };
    expect(body.ready).toBe(true);
    expect(body.ref).toContain("zen/");
  });
});

describe("model config API", () => {
  beforeEach(() => {
    process.env.OPENX_DB_PATH = ":memory:";
    resetDb();
  });

  afterEach(() => {
    resetDb();
    delete process.env.OPENX_DB_PATH;
  });

  it("lists templates", async () => {
    const res = await app.request("/api/model/templates");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { templates: { id: string }[] };
    expect(body.templates.some((t) => t.id === "opencode-zen")).toBe(true);
  });

  it("fetch-models falls back to template list", async () => {
    const res = await post("/api/model/fetch-models", {
      config: {
        api: { type: "openai-compatible", baseUrl: "https://invalid.example/v1" },
        auth: { apiKey: "public" },
        source: { template: "opencode-zen" },
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      source?: string;
      models?: { id: string }[];
    };
    expect(body.ok).toBe(true);
    expect(body.source).toBe("template");
    expect(body.models?.some((m) => m.id === "big-pickle")).toBe(true);
  });

  it("creates and deletes provider", async () => {
    const create = await post("/api/model/providers", {
      slug: "test-openai",
      config: {
        name: "Test OpenAI",
        api: { type: "openai-compatible", baseUrl: "https://api.openai.com/v1" },
        auth: { apiKey: "sk-test" },
        models: { "gpt-4o-mini": { name: "GPT-4o Mini" } },
        source: { template: "openai" },
      },
    });
    expect(create.status).toBe(200);

    const list = await app.request("/api/model/providers");
    const listed = (await list.json()) as { providers: Record<string, unknown> };
    expect(listed.providers["test-openai"]).toBeTruthy();

    const del = await app.request("/api/model/providers/test-openai", { method: "DELETE" });
    expect(del.status).toBe(200);
    const after = (await del.json()) as { settings: { providers: Record<string, unknown> } };
    expect(after.settings.providers["test-openai"]).toBeUndefined();
  });
});

describe("connect API", () => {
  beforeEach(() => {
    process.env.OPENX_DB_PATH = ":memory:";
    resetDb();
    seedTestProjectAndConversation();
    resetConnections();
    enableMockPi();
  });

  afterEach(() => {
    resetDb();
    resetConnections();
    delete process.env.OPENX_DB_PATH;
    disableMockPi();
  });

  it(
    "registers connection and heartbeat reflects Pi running goals",
    async () => {
      const connect = await post("/api/connect", {
        toolName: "pi",
        agentName: "test-agent",
        executorId: "pi",
      });
      expect(connect.status).toBe(200);
      const conn = (await connect.json()) as {
        connectionId: string;
        heartbeatUrl: string;
        executorId: string;
      };
      expect(conn.executorId).toBe("pi");

      const create = await post("/api/goals", goalBody({
        userDraft: "只回复 OK，不要调用任何工具",
        title: "connect 测试",
        acceptance: "回复包含 OK",
        executionPrompt: "只回复 OK，不要调用任何工具。",
        executorId: "pi",
        autoStart: false,
      }));
      expect(create.status).toBe(201);
      const { goal } = (await create.json()) as { goal: { id: string } };

      const start = await post(`/api/goals/${goal.id}/start`);
      expect(start.status).toBe(200);
      const { goal: started } = (await start.json()) as { goal: { status: string } };
      expect(started.status).toBe("running");

      const hb = await post(conn.heartbeatUrl, {});
      expect(hb.status).toBe(200);
      const body = (await hb.json()) as {
        status: string;
        pendingGoals: Array<{
          goal: { status: string; id: string };
          receiptId?: string;
          runId?: string;
        }>;
      };
      expect(body.status).toBe("alive");

      const detail = await app.request(`/api/goals/${goal.id}`);
      const { goal: current } = (await detail.json()) as { goal: { status: string } };
      if (current.status === "running") {
        expect(
          body.pendingGoals.some(
            (item) => item.goal.id === goal.id && item.goal.status === "running",
          ),
        ).toBe(true);
        expect(body.pendingGoals.some((item) => Boolean(item.receiptId))).toBe(true);
      } else {
        expect(["awaiting_review", "failed"]).toContain(current.status);
      }
    },
    GOAL_API_TEST_TIMEOUT_MS,
  );
});

describe("catalog API", () => {
  it("returns machine-readable API catalog", async () => {
    const res = await app.request("/api/catalog");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      meta: { endpointCount: number; mcpServerId: string };
      endpoints: { id: string; path: string }[];
    };
    expect(body.meta.mcpServerId).toBe("openx");
    expect(body.meta.endpointCount).toBeGreaterThan(40);
    expect(body.endpoints.some((e) => e.id === "goals_create")).toBe(true);
  });
});
