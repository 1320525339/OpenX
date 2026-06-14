import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  confirmOperatorAction,
  dismissOperatorAction,
  operatorCallApi,
  resetOperatorGatewayState,
} from "./operator-gateway.js";
import { setInProcessApiHandler } from "./operator-api-client.js";
import { app } from "./routes.js";
import { resetDb } from "./db.js";

describe("operator-gateway", () => {
  beforeEach(() => {
    resetOperatorGatewayState();
    process.env.OPENX_DB_PATH = ":memory:";
    resetDb();
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
    resetOperatorGatewayState();
    delete process.env.OPENX_DB_PATH;
    resetDb();
  });

  it("blocks calls when tier is off", async () => {
    const out = await operatorCallApi("off", { method: "GET", path: "/api/health" });
    expect(out.kind).toBe("executed");
    if (out.kind === "executed") expect(out.result.ok).toBe(false);
  });

  it("allows read tier GET", async () => {
    const out = await operatorCallApi("read", { method: "GET", path: "/api/health" });
    expect(out.kind).toBe("executed");
    if (out.kind === "executed") expect(out.result.ok).toBe(true);
  });

  it("requires pending confirm for admin settings put", async () => {
    const out = await operatorCallApi("admin", {
      method: "PUT",
      path: "/api/settings",
      body: { notifyOnComplete: false },
      summary: "测试更新设置",
    });
    expect(out.kind).toBe("pending");
    if (out.kind === "pending") {
      const confirmed = await confirmOperatorAction(out.pendingActionId);
      expect(confirmed?.status).toBe("confirmed");
      expect(confirmed?.result?.ok).toBe(true);
    }
  });

  it("dismisses pending action", async () => {
    const out = await operatorCallApi("admin", {
      method: "PUT",
      path: "/api/settings",
      body: { notifyOnComplete: true },
    });
    expect(out.kind).toBe("pending");
    if (out.kind === "pending") {
      const dismissed = dismissOperatorAction(out.pendingActionId);
      expect(dismissed?.status).toBe("dismissed");
    }
  });
});
