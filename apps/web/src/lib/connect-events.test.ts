import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type EsListener = (ev: MessageEvent) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: EsListener | null = null;
  closed = false;
  private listeners = new Map<string, Set<EsListener>>();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EsListener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, data: unknown) {
    const ev = { data: JSON.stringify(data) } as MessageEvent;
    for (const listener of this.listeners.get(type) ?? []) listener(ev);
    if (type === "message") this.onmessage?.(ev);
  }
}

describe("connectEvents gap rebuild", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("收到 gap 后关闭并重建 EventSource，且等待 onGap 完成", async () => {
    const { connectEvents } = await import("../api");
    let gapResolve: () => void = () => {};
    const gapDone = new Promise<void>((resolve) => {
      gapResolve = resolve;
    });
    const onGap = vi.fn(() => gapDone);
    const onCatchupComplete = vi.fn();

    const stop = connectEvents({
      onEvent: () => {},
      onGap,
      onCatchupComplete,
    });

    expect(MockEventSource.instances).toHaveLength(1);
    const first = MockEventSource.instances[0]!;

    first.emit("gap", { reason: "invalid_last_event_id" });
    expect(first.closed).toBe(true);
    expect(onGap).toHaveBeenCalledWith("invalid_last_event_id", undefined);
    expect(MockEventSource.instances).toHaveLength(1);

    gapResolve();
    await vi.waitFor(() => {
      expect(MockEventSource.instances.length).toBeGreaterThanOrEqual(2);
    });
    const second = MockEventSource.instances[1]!;
    expect(second.closed).toBe(false);
    expect(second).not.toBe(first);

    second.emit("connected", { type: "connected", clientId: "c1" });
    expect(onCatchupComplete).toHaveBeenCalled();

    stop();
    expect(second.closed).toBe(true);
  });
});
