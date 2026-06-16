import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadOxspCatalog } from "./oxsp-catalog";

const CATALOG_KEY = "openx.oxsp.catalog.console";
const LEGACY_KEY = "openx.pinDesktop.extension.console";

describe("oxsp-catalog migration", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      store: {} as Record<string, string>,
      getItem(key: string) {
        return this.store[key] ?? null;
      },
      setItem(key: string, value: string) {
        this.store[key] = value;
      },
      removeItem(key: string) {
        delete this.store[key];
      },
      clear() {
        this.store = {};
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns empty catalog when no storage", () => {
    expect(loadOxspCatalog("console").slots).toEqual([]);
  });

  it("migrates legacy cards[] to slots[] and writes new key", () => {
    const legacy = {
      cards: [{ id: "w-legacy-1", url: "https://legacy.test/page", title: "Legacy" }],
    };
    localStorage.setItem(LEGACY_KEY, JSON.stringify(legacy));

    const catalog = loadOxspCatalog("console");
    expect(catalog.slots).toHaveLength(1);
    expect(catalog.slots[0]).toMatchObject({
      id: "w-legacy-1",
      kind: "browser",
      title: "Legacy",
      config: { kind: "browser", startUrl: "https://legacy.test/page" },
    });
    expect(localStorage.getItem(CATALOG_KEY)).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(CATALOG_KEY)!).slots).toHaveLength(1);
  });

  it("prefers new catalog key over legacy", () => {
    localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify({ cards: [{ id: "old", url: "https://old.test" }] }),
    );
    localStorage.setItem(
      CATALOG_KEY,
      JSON.stringify({
        slots: [
          {
            id: "s-new",
            kind: "web",
            config: { kind: "web", url: "https://new.test" },
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }),
    );

    const catalog = loadOxspCatalog("console");
    expect(catalog.slots).toHaveLength(1);
    expect(catalog.slots[0]?.id).toBe("s-new");
    expect(catalog.slots[0]?.kind).toBe("browser");
    expect(catalog.slots[0]?.config).toMatchObject({
      kind: "browser",
      startUrl: "https://new.test",
    });
  });
});
