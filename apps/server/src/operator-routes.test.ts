import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "./db.js";
import { resetConnections } from "./connect-store.js";
import { resetOrchestrator } from "./orchestrator.js";
import { app } from "./routes.js";
import { resetOperatorGatewayState } from "./operator-gateway.js";
import { runOperatorSelfTest } from "./operator-self-test.js";
import { loadSettings, saveSettings } from "./settings-store.js";
import { setInProcessApiHandler } from "./operator-api-client.js";

describe("operator self-test", () => {
  beforeEach(() => {
    process.env.OPENX_DB_PATH = ":memory:";
    process.env.OPENX_MOCK_PI = "1";
    resetDb();
    resetConnections();
    resetOrchestrator();
    resetOperatorGatewayState();
  });

  afterEach(() => {
    delete process.env.OPENX_DB_PATH;
    delete process.env.OPENX_MOCK_PI;
    resetOrchestrator();
    resetOperatorGatewayState();
    resetDb();
  });

  it("runs isolated self-test suite", async () => {
    const result = await runOperatorSelfTest({ tier: "operator", isolate: true });
    expect(result.steps.length).toBeGreaterThan(0);
    for (const step of result.steps) {
      if (!step.ok) {
        console.error("failed step:", step.id, step.detail);
      }
    }
    expect(result.ok).toBe(true);
  });
});

describe("operator routes", () => {
  beforeEach(() => {
    process.env.OPENX_DB_PATH = ":memory:";
    resetDb();
    resetOperatorGatewayState();
    saveSettings({ ...loadSettings(), operatorTier: "admin" });
    setInProcessApiHandler(async (input) => {
      const res = await app.request(input.path, {
        method: input.method,
        headers: input.body ? { "Content-Type": "application/json" } : undefined,
        body:
          input.body && input.method !== "GET"
            ? JSON.stringify(input.body)
            : undefined,
      });
      const text = await res.text();
      let data: unknown = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
      return {
        ok: res.ok,
        status: res.status,
        path: input.path,
        method: input.method.toUpperCase(),
        data,
      };
    });
  });

  afterEach(() => {
    setInProcessApiHandler(undefined);
    delete process.env.OPENX_DB_PATH;
    resetOperatorGatewayState();
    resetDb();
  });

  it("returns playbook for enabled tier", async () => {
    const res = await app.request("/api/operator/playbook");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.flows?.length).toBeGreaterThan(0);
  });

  it("confirm and dismiss pending admin actions", async () => {
    const pending = await app.request("/api/operator/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "PUT",
        path: "/api/settings",
        body: { notifyOnComplete: false },
        summary: "测试",
      }),
    });
    expect(pending.status).toBe(200);
    const pendingBody = (await pending.json()) as {
      kind: string;
      pendingActionId?: string;
    };
    expect(pendingBody.kind).toBe("pending");

    const dismissed = await app.request(
      `/api/operator/actions/${pendingBody.pendingActionId}/dismiss`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
    );
    expect(dismissed.status).toBe(200);
  });
});
