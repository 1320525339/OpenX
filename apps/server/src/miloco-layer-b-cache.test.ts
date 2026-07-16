import { describe, expect, it, beforeEach } from "vitest";
import {
  getCachedMilocoLayerBStatus,
  resetMilocoLayerBCacheForTests,
} from "./miloco-layer-b-cache.js";

describe("miloco-layer-b-cache", () => {
  beforeEach(() => {
    resetMilocoLayerBCacheForTests();
  });

  it("returns empty cache immediately without blocking", () => {
    const cached = getCachedMilocoLayerBStatus();
    expect(cached.checkedAt).toBe("");
    expect(cached.refreshing).toBe(false);
    expect(cached.stale).toBe(true);
  });
});
