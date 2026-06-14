import { describe, expect, it } from "vitest";
import {
  buildCoachThreadBlockFromTurns,
  buildDeterministicCoachCheckpoint,
  detectCoachThreadPressure,
  selectRecentCoachTurns,
} from "./coach-thread-compaction.js";

describe("coach-thread-compaction", () => {
  it("keeps recent turns when budget is exceeded", () => {
    const turns = Array.from({ length: 6 }, (_, index) => ({
      role: "user" as const,
      text: `消息-${index}-${"x".repeat(80)}`,
    }));
    const { selected, omittedEarlier } = selectRecentCoachTurns(turns, 120);
    expect(omittedEarlier).toBeGreaterThan(0);
    expect(selected[selected.length - 1]?.text).toContain("消息-5");
  });

  it("escalates pressure for long threads", () => {
    const turns = Array.from({ length: 30 }, (_, index) => ({
      role: "user" as const,
      text: `turn-${index}-${"y".repeat(120)}`,
    }));
    expect(detectCoachThreadPressure(turns, 1200)).toBeGreaterThan(1);
  });

  it("builds deterministic checkpoint sections", () => {
    const summary = buildDeterministicCoachCheckpoint([
      {
        id: 1,
        conversationId: "c1",
        kind: "text",
        role: "user",
        text: "实现登录页",
        timestamp: "t1",
      },
      {
        id: 2,
        conversationId: "c1",
        kind: "refined",
        timestamp: "t2",
        refined: {
          title: "登录页",
          acceptance: "可登录",
          executionPrompt: "做页面",
          constraints: [],
          executorId: "pi",
        },
      },
    ]);
    expect(summary).toContain("会话意图");
    expect(summary).toContain("登录页");
  });

  it("prefixes checkpoint before recent history block", () => {
    const block = buildCoachThreadBlockFromTurns(
      [{ role: "user", text: "继续" }],
      { checkpointPrefix: "### 摘要\n已完成澄清" },
    );
    expect(block).toContain("会话摘要（checkpoint");
    expect(block).toContain("继续");
  });
});
