import { describe, expect, it } from "vitest";
import {
  buildApiCatalogResponse,
  listApiCatalog,
  OPENX_API_CATALOG,
  OPENX_API_CATEGORIES,
} from "./api-catalog.js";

describe("api-catalog", () => {
  it("includes core goal and connect endpoints", () => {
    const ids = new Set(OPENX_API_CATALOG.map((e) => e.id));
    expect(ids.has("goals_create")).toBe(true);
    expect(ids.has("connect_register")).toBe(true);
    expect(ids.has("internal_complete")).toBe(true);
    expect(ids.has("catalog_get")).toBe(true);
    expect(ids.has("operator_playbook")).toBe(true);
    expect(ids.has("workspace_file_preview")).toBe(true);
  });

  it("filters by category", () => {
    const goals = listApiCatalog({ category: "goals" });
    expect(goals.length).toBeGreaterThan(5);
    expect(goals.every((g) => g.category === "goals")).toBe(true);
  });

  it("builds catalog response with meta", () => {
    const res = buildApiCatalogResponse();
    expect(res.meta.endpointCount).toBe(OPENX_API_CATALOG.length);
    expect(res.endpoints.length).toBe(OPENX_API_CATALOG.length);
    expect(res.meta.mcpServerId).toBe("openx");
  });

  it("declares every endpoint category in catalog meta", () => {
    const declared = new Set<string>(OPENX_API_CATEGORIES);
    for (const endpoint of OPENX_API_CATALOG) {
      expect(declared.has(endpoint.category), endpoint.id).toBe(true);
    }
  });
});
