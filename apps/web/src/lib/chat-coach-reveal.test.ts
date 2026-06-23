import { describe, expect, it } from "vitest";
import {
  maxCoachTextMessageId,
  pickCoachRevealMessageId,
} from "./chat-coach-reveal";

describe("chat-coach-reveal", () => {
  it("picks coach text after baseline", () => {
    const messages = [
      { kind: "text" as const, id: 1, role: "coach" as const, text: "old", timestamp: "" },
      { kind: "text" as const, id: 2, role: "user" as const, text: "hi", timestamp: "" },
      { kind: "text" as const, id: 3, role: "coach" as const, text: "new", timestamp: "" },
    ];
    expect(maxCoachTextMessageId(messages)).toBe(3);
    expect(pickCoachRevealMessageId(messages, 1)).toBe(3);
    expect(pickCoachRevealMessageId(messages, 3)).toBeNull();
  });
});
