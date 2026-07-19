import { describe, expect, it, beforeEach } from "vitest";
import type { DynamicIslandPayload } from "@openx/shared";
import {
  bindIslandQueueHandlers,
  completeIslandDisplay,
  getIslandDisplayToken,
  getIslandShowingId,
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

  it("dedupes same goal kind while showing without re-showing", () => {
    const shown: DynamicIslandPayload[] = [];
    const updated: DynamicIslandPayload[] = [];
    bindIslandQueueHandlers({
      show: (p) => shown.push(p),
      update: (p) => updated.push(p),
      dismiss: () => {},
    });
    requestIsland({ ...payload("a1"), goalId: "g1", kind: "goal.awaiting_review" });
    requestIsland({ ...payload("a2"), goalId: "g1", kind: "goal.awaiting_review" });
    expect(shown).toHaveLength(1);
    expect(updated).toHaveLength(1);
    expect(updated[0]!.id).toBe("a2");
  });

  it("skips goal kind already dismissed via dedupe key", () => {
    const shown: string[] = [];
    bindIslandQueueHandlers({
      show: (p) => shown.push(p.id),
      dismiss: () => {},
    });
    const card = { ...payload("a1"), goalId: "g1", kind: "goal.awaiting_review" as const };
    requestIsland(card);
    completeIslandDisplay("a1");
    requestIsland({ ...card, id: "a2" });
    expect(shown).toEqual(["a1"]);
  });

  it("catchup 时 transient 不展示且不 mark seen；durable 不 mark seen", () => {
    const shown: string[] = [];
    bindIslandQueueHandlers({
      show: (p) => shown.push(p.id),
      dismiss: () => {},
    });
    setIslandCatchupMode(true);
    requestIsland(payload("replay-transient"));
    expect(shown).toHaveLength(0);
    expect(isIslandSeen("replay-transient")).toBe(false);

    requestIsland({
      ...payload("replay-durable"),
      kind: "goal.awaiting_review",
      goalId: "g1",
      autoDismissMs: 0,
    });
    expect(shown).toHaveLength(0);
    expect(isIslandSeen("replay-durable")).toBe(false);

    setIslandCatchupMode(false);
    requestIsland(payload("fresh"));
    expect(shown).toEqual(["fresh"]);
  });

  it("severity 优先出队", () => {
    const shown: string[] = [];
    bindIslandQueueHandlers({
      show: (p) => shown.push(p.id),
      dismiss: () => {},
    });
    // 先入队两张再结束 catchup… 实际 catchup 已关；用：先展示一张后另一张在队列
    requestIsland({ ...payload("info1"), severity: "info" });
    requestIsland({ ...payload("err1"), severity: "error" });
    expect(shown[0]).toBe("info1");
    completeIslandDisplay("info1");
    expect(shown[1]).toBe("err1");
  });

  it("stale displayToken 不会误关下一张卡", () => {
    const shown: string[] = [];
    bindIslandQueueHandlers({
      show: (p) => shown.push(p.id),
      dismiss: () => {},
    });
    requestIsland(payload("1"));
    requestIsland(payload("2"));
    const token1 = getIslandDisplayToken();
    expect(token1).toBe(1);
    expect(getIslandShowingId()).toBe("1");

    completeIslandDisplay({ token: token1! });
    expect(shown).toEqual(["1", "2"]);
    expect(getIslandShowingId()).toBe("2");
    const token2 = getIslandDisplayToken();
    expect(token2).toBe(2);

    // 延迟回调仍持有旧 token，不应关掉第 2 张
    completeIslandDisplay({ token: token1! });
    expect(getIslandShowingId()).toBe("2");
    expect(isIslandSeen("2")).toBe(false);
  });

  it("error toast 抢占当前 durable 展示且不 ack", () => {
    const shown: string[] = [];
    const dismissed: number[] = [];
    bindIslandQueueHandlers({
      show: (p) => shown.push(p.id),
      dismiss: () => dismissed.push(1),
    });
    requestIsland({
      ...payload("await-1"),
      kind: "goal.awaiting_review",
      goalId: "g1",
      autoDismissMs: 0,
    });
    expect(shown).toEqual(["await-1"]);
    expect(getIslandShowingId()).toBe("await-1");

    requestIsland({
      ...payload("err-1"),
      severity: "error",
      title: "确认失败",
      message: "Failed to fetch",
    });
    expect(dismissed.length).toBeGreaterThanOrEqual(1);
    expect(getIslandShowingId()).toBe("err-1");
    expect(shown).toContain("err-1");
    expect(isIslandSeen("await-1")).toBe(false);

    completeIslandDisplay({ token: getIslandDisplayToken()! });
    expect(getIslandShowingId()).toBe("await-1");
  });

  it("同 dedupe 更新不更换 displayToken", () => {
    const tokens: number[] = [];
    bindIslandQueueHandlers({
      show: (_p, token) => tokens.push(token),
      update: (_p, token) => tokens.push(token),
      dismiss: () => {},
    });
    requestIsland({ ...payload("a1"), goalId: "g1", kind: "goal.awaiting_review" });
    const token = getIslandDisplayToken();
    requestIsland({ ...payload("a2"), goalId: "g1", kind: "goal.awaiting_review" });
    expect(getIslandDisplayToken()).toBe(token);
    expect(tokens).toEqual([token, token]);
    expect(getIslandShowingId()).toBe("a2");

    // 用展示令牌完成，应关掉当前（已更新为 a2）
    completeIslandDisplay({ token: token! });
    expect(getIslandShowingId()).toBeNull();
    expect(isIslandSeen("a2")).toBe(true);
  });
});
