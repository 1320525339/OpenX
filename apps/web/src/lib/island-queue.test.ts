import { describe, expect, it, beforeEach } from "vitest";
import type { DynamicIslandPayload } from "@openx/shared";
import {
  bindIslandQueueHandlers,
  completeIslandDisplay,
  isIslandSeen,
  markIslandSeen,
  requestIsland,
  resetIslandQueueForTests,
  setIslandCatchupMode,
} from "./island-queue";

function payload(id: string): DynamicIslandPayload {
  return {
    id,
    kind: "broadcast",
    severity: "info",
    title: id,
    message: "test",
  };
}

function installLocalStorageMock(): void {
  const store = new Map<string, string>();
  const mock = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
  Object.defineProperty(globalThis, "localStorage", { value: mock, configurable: true });
}

describe("island-queue", () => {
  beforeEach(() => {
    installLocalStorageMock();
    resetIslandQueueForTests();
    setIslandCatchupMode(false);
  });

  it("dedupes seen ids", () => {
    markIslandSeen("a");
    expect(isIslandSeen("a")).toBe(true);
    const shown: string[] = [];
    bindIslandQueueHandlers({
      show: (p) => shown.push(p.id),
      dismiss: () => {},
    });
    requestIsland(payload("a"));
    expect(shown).toHaveLength(0);
  });

  it("queues and drains in order", () => {
    const shown: string[] = [];
    bindIslandQueueHandlers({
      show: (p) => shown.push(p.id),
      dismiss: () => {},
    });
    requestIsland(payload("1"));
    requestIsland(payload("2"));
    expect(shown).toEqual(["1"]);
    completeIslandDisplay("1");
    expect(shown).toEqual(["1", "2"]);
    expect(isIslandSeen("1")).toBe(true);
  });

  it("dedupes same goal kind while showing", () => {
    const shown: DynamicIslandPayload[] = [];
    bindIslandQueueHandlers({
      show: (p) => shown.push(p),
      dismiss: () => {},
    });
    requestIsland({ ...payload("a1"), goalId: "g1", kind: "goal.awaiting_review" });
    requestIsland({ ...payload("a2"), goalId: "g1", kind: "goal.awaiting_review" });
    expect(shown).toHaveLength(2);
    expect(shown[1]!.id).toBe("a2");
  });

  it("marks replay as seen during catchup without showing", () => {
    const shown: string[] = [];
    bindIslandQueueHandlers({
      show: (p) => shown.push(p.id),
      dismiss: () => {},
    });
    setIslandCatchupMode(true);
    requestIsland(payload("replay"));
    expect(shown).toHaveLength(0);
    expect(isIslandSeen("replay")).toBe(true);
    setIslandCatchupMode(false);
    requestIsland(payload("replay"));
    expect(shown).toHaveLength(0);
    requestIsland(payload("fresh"));
    expect(shown).toEqual(["fresh"]);
  });
});
