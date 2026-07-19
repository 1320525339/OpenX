import { describe, expect, it } from "vitest";
import {
  chatContextDisabledReason,
  displaySeatCount,
  resolveEffectiveRoundtable,
  shouldDisableChatContext,
} from "./roundtable-composer-policy";

describe("roundtable-composer-policy", () => {
  it("resolveEffectiveRoundtable：mode 或席位任一成立即为圆桌", () => {
    expect(resolveEffectiveRoundtable("foreman", 0)).toBe(false);
    expect(resolveEffectiveRoundtable("foreman", 2)).toBe(true);
    expect(resolveEffectiveRoundtable("roundtable", 0)).toBe(true);
    expect(resolveEffectiveRoundtable(undefined, 0)).toBe(false);
  });

  it("shouldDisableChatContext：圆桌已接入 Context，不再灰显", () => {
    expect(shouldDisableChatContext(false)).toBe(false);
    expect(shouldDisableChatContext(true)).toBe(false);
    expect(chatContextDisabledReason(false)).toBeUndefined();
    expect(chatContextDisabledReason(true)).toBeUndefined();
  });

  it("displaySeatCount：空席工头占位为 1", () => {
    expect(displaySeatCount(0)).toBe(1);
    expect(displaySeatCount(3)).toBe(3);
  });
});
