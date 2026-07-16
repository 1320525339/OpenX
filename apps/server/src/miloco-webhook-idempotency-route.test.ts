import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./miloco-webhook-service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./miloco-webhook-service.js")>();
  return {
    ...actual,
    enqueueMilocoAgentTurn: vi.fn(() => ({
      runId: "run-1",
      status: "accepted" as const,
      promise: Promise.resolve({ runId: "run-1", status: "ok" as const }),
    })),
    handleMilocoAgentTurn: vi.fn(async () => ({ runId: "run-1", status: "ok" as const })),
  };
});

vi.mock("./miloco-webhook-auth.js", () => ({
  getOrCreateMilocoWebhookToken: () => "test-token",
  isMilocoWebhookTokenConfigured: () => true,
  verifyMilocoWebhookBearer: (h: string | undefined) =>
    !!h?.startsWith("Bearer ") && h.slice(7).trim() === "test-token",
}));

import { Hono } from "hono";
import { milocoRoutes } from "./routes/miloco.js";
import { enqueueMilocoAgentTurn } from "./miloco-webhook-service.js";

describe("POST /api/miloco/webhook idempotency", () => {
  let prevMiloco: string | undefined;

  beforeEach(() => {
    prevMiloco = process.env.OPENX_MILOCO;
    process.env.OPENX_MILOCO = "1";
    vi.mocked(enqueueMilocoAgentTurn).mockClear();
  });

  afterEach(() => {
    if (prevMiloco === undefined) delete process.env.OPENX_MILOCO;
    else process.env.OPENX_MILOCO = prevMiloco;
    vi.clearAllMocks();
  });

  it("rejects agent action when both idempotencyKey and traceId are missing", async () => {
    const app = new Hono();
    app.route("/api/miloco", milocoRoutes);

    const res = await app.request("/api/miloco/webhook", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "agent",
        payload: { message: "打开灯", lane: "miloco-rule" },
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: number; message: string };
    expect(body.code).toBe(400);
    expect(body.message).toContain("idempotencyKey");
    expect(enqueueMilocoAgentTurn).not.toHaveBeenCalled();
  });

  it("accepts when only traceId is provided", async () => {
    const app = new Hono();
    app.route("/api/miloco", milocoRoutes);

    const res = await app.request("/api/miloco/webhook", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "agent",
        payload: {
          message: "打开灯",
          lane: "miloco-rule",
          traceId: "trace-only-1",
        },
      }),
    });

    expect(res.status).toBe(202);
    expect(enqueueMilocoAgentTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "trace-only-1",
        traceId: "trace-only-1",
      }),
    );
  });
});
