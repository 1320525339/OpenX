import { describe, expect, it } from "vitest";
import { validateGoalCompletion } from "./execution-outcome.js";

describe("validateGoalCompletion", () => {
  it("rejects empty summary without deliverables", () => {
    const result = validateGoalCompletion("  ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("empty_summary");
  });

  it("allows empty summary when deliverables exist", () => {
    const result = validateGoalCompletion("", [
      { kind: "file", path: "hello.txt", action: "created" },
    ]);
    expect(result.ok).toBe(true);
  });

  it("rejects summaries that claim the task is incomplete", () => {
    const result = validateGoalCompletion(
      "Pi 工具调用达到上限（20 次），任务未完成。摘要：仍缺少验证。",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("incomplete_claim");
  });

  it("accepts normal completion summaries", () => {
    expect(validateGoalCompletion("已创建 hello.txt").ok).toBe(true);
  });
});
