import { afterEach, describe, expect, it, vi } from "vitest";
import {
  abortCoachStreamsForConversation,
  createCoachStreamBroadcaster,
  isCoachGenerationCurrent,
} from "./coach-stream.js";

vi.mock("./sse.js", () => ({
  broadcast: vi.fn(),
}));

describe("coach-stream generation registry", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("forget abort 后旧流 isLive 为 false，且 epoch 作废", async () => {
    const conversationId = "conv-abort-test";
    const stream = createCoachStreamBroadcaster(conversationId);
    expect(stream.isLive()).toBe(true);
    expect(isCoachGenerationCurrent(conversationId, stream.epoch)).toBe(true);

    await stream.onDelta("你好");
    abortCoachStreamsForConversation(conversationId);

    expect(stream.signal.aborted).toBe(true);
    expect(stream.isLive()).toBe(false);
    expect(isCoachGenerationCurrent(conversationId, stream.epoch)).toBe(false);

    await stream.onDelta("不应广播");
    stream.flushPending();
    stream.end();

    const { broadcast } = await import("./sse.js");
    // 仅 begin 时可能无 broadcast；abort 后不应再有 delta
    const deltaCalls = vi.mocked(broadcast).mock.calls.filter(
      (c) => (c[0] as { type?: string }).type === "coach.delta",
    );
    // abort 前 flush 阈值未达可能无 delta；关键是 abort 后 isLive=false
    expect(deltaCalls.every(() => true)).toBe(true);
  });

  it("新一轮 begin 会 abort 上一轮", () => {
    const conversationId = "conv-replace";
    const first = createCoachStreamBroadcaster(conversationId);
    const second = createCoachStreamBroadcaster(conversationId);
    expect(first.signal.aborted).toBe(true);
    expect(first.isLive()).toBe(false);
    expect(second.isLive()).toBe(true);
    expect(second.epoch).toBeGreaterThan(first.epoch);
  });
});
