import { describe, expect, it } from "vitest";
import type { Goal } from "@openx/shared";
import {
  findGoalByLocateQuery,
  formatConversationStatusSummary,
  parseChatSlash,
} from "./chat-slash.js";

function makeGoal(overrides: Partial<Goal> & Pick<Goal, "id" | "title">): Goal {
  const now = new Date().toISOString();
  return {
    orderNo: 1,
    conversationId: "c1",
    acceptance: "ok",
    executionPrompt: "run",
    constraints: [],
    executorId: "pi",
    status: "draft",
    progress: 0,
    dependsOn: [],
    priority: "medium",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("parseChatSlash", () => {
  it("parses help and status", () => {
    expect(parseChatSlash("/help")?.type).toBe("help");
    expect(parseChatSlash("/status")?.type).toBe("status");
  });

  it("parses locate with WO id", () => {
    const cmd = parseChatSlash("/locate WO-000042");
    expect(cmd?.type).toBe("locate");
    if (cmd?.type === "locate") expect(cmd.query).toBe("WO-000042");
  });

  it("parses rework with reason", () => {
    const cmd = parseChatSlash("/rework 需要补测试");
    expect(cmd?.type).toBe("rework");
    if (cmd?.type === "rework") expect(cmd.reason).toBe("需要补测试");
  });

  it("returns null for unknown command", () => {
    expect(parseChatSlash("/unknown")).toBeNull();
    expect(parseChatSlash("hello")).toBeNull();
  });
});

describe("findGoalByLocateQuery", () => {
  const goals = [
    makeGoal({ id: "g1", title: "登录模块", orderNo: 42 }),
    makeGoal({ id: "g2", title: "支付接口", orderNo: 7 }),
  ];

  it("finds by WO number", () => {
    expect(findGoalByLocateQuery(goals, "WO-000042")?.id).toBe("g1");
    expect(findGoalByLocateQuery(goals, "42")?.id).toBe("g1");
  });

  it("finds by title substring", () => {
    expect(findGoalByLocateQuery(goals, "支付")?.id).toBe("g2");
  });
});

describe("formatConversationStatusSummary", () => {
  it("summarizes counts", () => {
    const text = formatConversationStatusSummary([
      makeGoal({ id: "a", title: "A", status: "running" }),
      makeGoal({ id: "b", title: "B", status: "awaiting_review" }),
    ]);
    expect(text).toContain("2 个任务单");
    expect(text).toContain("进行中");
    expect(text).toContain("待验收");
  });
});
