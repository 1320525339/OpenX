import { describe, expect, it } from "vitest";
import { OPENX_API_CATALOG, enrichApiCatalog } from "@openx/shared";

/** 已实现且须在 catalog 中的路由（method + path 模板） */
const IMPLEMENTED_ROUTES: Array<{ method: string; path: string }> = [
  { method: "GET", path: "/api/health" },
  { method: "GET", path: "/api/catalog" },
  { method: "GET", path: "/api/bootstrap" },
  { method: "GET", path: "/api/workspace/file-preview" },
  { method: "GET", path: "/api/managed-agents" },
  { method: "GET", path: "/api/system/console" },
  { method: "GET", path: "/api/island/seen" },
  { method: "POST", path: "/api/island/seen" },
  { method: "POST", path: "/api/system/island/push" },
  { method: "GET", path: "/api/cli/system-conversation" },
  { method: "GET", path: "/api/cli/bootstrap-status" },
  { method: "GET", path: "/api/goals/:id/review-rounds" },
  { method: "POST", path: "/api/goals/:id/trigger-review" },
  { method: "POST", path: "/api/coach/refined/:messageId/respond" },
  { method: "POST", path: "/api/coach/clarify/:messageId/respond" },
  { method: "GET", path: "/api/operator/playbook" },
  { method: "POST", path: "/api/operator/self-test" },
  { method: "GET", path: "/api/desktop/slots" },
  { method: "POST", path: "/api/desktop/slots" },
  { method: "POST", path: "/api/desktop/slots/:slotId/command" },
  { method: "DELETE", path: "/api/desktop/slots/:slotId" },
  { method: "PUT", path: "/api/desktop/state" },
  { method: "GET", path: "/api/desktop/browser/:sessionId/frame" },
  { method: "GET", path: "/api/desktop/browser/:sessionId/ws" },
  { method: "GET", path: "/api/desktop/browser/:sessionId/stream" },
  { method: "GET", path: "/api/desktop/browser/:sessionId/dom" },
  { method: "GET", path: "/api/desktop/browser/:sessionId/network" },
  { method: "POST", path: "/api/desktop/browser/:sessionId/ensure" },
  { method: "POST", path: "/api/desktop/browser/:sessionId/input" },
];

describe("api-catalog sync", () => {
  it("includes all implemented routes", () => {
    const enriched = enrichApiCatalog(OPENX_API_CATALOG);
    for (const route of IMPLEMENTED_ROUTES) {
      const match = enriched.find(
        (e) => e.method === route.method && e.path === route.path,
      );
      expect(match, `missing catalog for ${route.method} ${route.path}`).toBeTruthy();
    }
  });

  it("assigns minTier to every endpoint", () => {
    for (const ep of enrichApiCatalog(OPENX_API_CATALOG)) {
      expect(ep.minTier).toBeTruthy();
      expect(typeof ep.confirmRequired).toBe("boolean");
    }
  });

  it("has at least 80 endpoints after operator expansion", () => {
    expect(OPENX_API_CATALOG.length).toBeGreaterThanOrEqual(80);
  });
});
