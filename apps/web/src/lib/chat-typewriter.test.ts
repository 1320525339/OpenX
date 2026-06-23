import { describe, expect, it } from "vitest";
import {
  advanceTypewriterVisible,
  typewriterCharsPerStep,
  typewriterPauseAfterChar,
} from "./chat-typewriter";

describe("chat-typewriter", () => {
  it("emits at least one char per tick", () => {
    expect(
      typewriterCharsPerStep({
        visible: 0,
        targetLength: 10,
        deltaMs: 16,
        charsPerSecond: 30,
        backlogBoost: false,
      }),
    ).toBeGreaterThanOrEqual(1);
  });

  it("boosts speed when backlog is large", () => {
    const slow = typewriterCharsPerStep({
      visible: 0,
      targetLength: 200,
      deltaMs: 32,
      charsPerSecond: 30,
      backlogBoost: false,
    });
    const fast = typewriterCharsPerStep({
      visible: 0,
      targetLength: 200,
      deltaMs: 32,
      charsPerSecond: 30,
      backlogBoost: true,
    });
    expect(fast).toBeGreaterThan(slow);
  });

  it("pauses after punctuation", () => {
    expect(typewriterPauseAfterChar("。")).toBeGreaterThan(0);
    expect(typewriterPauseAfterChar("a")).toBe(0);
  });

  it("advances visible count over time", () => {
    const first = advanceTypewriterVisible(0, "你好世界", 40, {
      charsPerSecond: 40,
      backlogBoost: false,
      pauseMs: 0,
    });
    expect(first.next).toBeGreaterThan(0);
    expect(first.next).toBeLessThanOrEqual(4);
  });
});
