/**
 * 【已返工】自动验收：灵动岛与三态筛选
 *
 * 覆盖：
 * 1. 灵动岛推送 payload 正确性（各卡片类型）
 * 2. 灵动岛 /api/island/seen 已读标记
 * 3. 灵动岛 /api/system/island/push 推送端点
 * 4. 三态筛选 goalDisplayOutcome 映射
 * 5. 三态筛选 goalMatchesDisplayFilter 过滤
 * 6. 三态筛选 goalDisplayLabel / goalDisplayHint 展示文案
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  DynamicIslandPayloadSchema,
  IslandPayloadKindSchema,
  goalDisplayOutcome,
  goalMatchesDisplayFilter,
  goalDisplayLabel,
  goalDisplayHint,
  type Goal,
  type GoalDisplayOutcome,
} from "@openx/shared";
import {
  islandForReviewLimit,
  islandForReviewBlocked,
  islandForReviewUnavailable,
  islandForAwaitingReview,
} from "./island-push.js";
import {
  isIslandSeenInDb,
  resetDb,
} from "./db.js";
import { app } from "./routes.js";

const jsonHeaders = { "Content-Type": "application/json" };

// ---------------------------------------------------------------------------
// 测试辅助：构造最小 Goal
// ---------------------------------------------------------------------------
function makeGoal(overrides: Partial<Goal> = {}): Goal {
  const now = new Date().toISOString();
  return {
    id: "goal-test-1",
    conversationId: "conv-test-1",
    title: "测试目标",
    acceptance: "所有测试通过",
    executionPrompt: "执行测试",
    constraints: [],
    executorId: "pi",
    status: "awaiting_review",
    progress: 100,
    dependsOn: [],
    priority: "medium",
    autoReview: false,
    iterationCount: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. 灵动岛 — Payload 构建与 schema 校验
// ---------------------------------------------------------------------------
describe("灵动岛 — Payload 构建与校验", () => {
  it("islandForReviewLimit 生成有效 payload（审查上限）", () => {
    const goal = makeGoal({
      id: "g-review-limit",
      title: "审查上限测试",
      status: "awaiting_review",
      iterationCount: 20,
      maxIterations: 20,
    });
    const payload = islandForReviewLimit(goal, "仍需修改", 20);
    const parsed = DynamicIslandPayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.kind).toBe("goal.review_limit");
      expect(parsed.data.severity).toBe("warning");
      expect(parsed.data.goalId).toBe("g-review-limit");
      expect(parsed.data.expanded).toBe(true);
      expect(parsed.data.autoDismissMs).toBe(0);
      expect(parsed.data.allowFeedback).toBe(true);
      expect(parsed.data.actions).toHaveLength(3);
      expect(parsed.data.actions!.some((a) => a.id === "approve")).toBe(true);
      expect(parsed.data.actions!.some((a) => a.id === "rework")).toBe(true);
      expect(parsed.data.actions!.some((a) => a.id === "review")).toBe(true);
    }
  });

  it("islandForReviewBlocked 生成有效 payload（审查阻塞）", () => {
    const goal = makeGoal({
      id: "g-review-blocked",
      title: "阻塞测试",
      status: "awaiting_review",
    });
    const payload = islandForReviewBlocked(goal, "依赖不可用");
    const parsed = DynamicIslandPayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.kind).toBe("goal.review_fail");
      expect(parsed.data.severity).toBe("warning");
      expect(parsed.data.message).toContain("依赖不可用");
      expect(parsed.data.actions!.some((a) => a.id === "approve")).toBe(true);
      expect(parsed.data.actions!.some((a) => a.id === "rework")).toBe(true);
      expect(parsed.data.actions!.some((a) => a.id === "navigate")).toBe(true);
    }
  });

  it("islandForReviewUnavailable 生成有效 payload（审查员不可用）", () => {
    const goal = makeGoal({
      id: "g-unavail",
      title: "审查不可用测试",
      status: "awaiting_review",
    });
    const payload = islandForReviewUnavailable(goal, "LLM 配额耗尽");
    const parsed = DynamicIslandPayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.kind).toBe("goal.review_unavailable");
      expect(parsed.data.severity).toBe("error");
      expect(parsed.data.message).toContain("LLM 配额耗尽");
      expect(parsed.data.actions).toHaveLength(2);
    }
  });

  it("islandForReviewUnavailable 无错误信息时使用默认消息", () => {
    const goal = makeGoal({ id: "g-unavail2", title: "默认错误消息" });
    const payload = islandForReviewUnavailable(goal);
    const parsed = DynamicIslandPayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.message).toContain("审查员不可用");
    }
  });

  it("islandForAwaitingReview 生成有效 payload（待验收）", () => {
    const goal = makeGoal({
      id: "g-await",
      title: "待验收测试",
      status: "awaiting_review",
      iterationCount: 3,
      maxIterations: 20,
      resultSummary: "已完成所有修改",
    });
    const payload = islandForAwaitingReview(goal);
    const parsed = DynamicIslandPayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.kind).toBe("goal.awaiting_review");
      expect(parsed.data.severity).toBe("info");
      expect(parsed.data.expanded).toBe(false);
      expect(parsed.data.allowFeedback).toBe(true);
      expect(parsed.data.meta?.iterationCount).toBe(3);
      expect(parsed.data.meta?.resultPreview).toBe("已完成所有修改");
      expect(parsed.data.actions).toHaveLength(3);
      expect(parsed.data.actions!.some((a) => a.id === "review")).toBe(true);
    }
  });

  it("所有 IslandPayloadKind 均可被 schema 接受", () => {
    const kinds = IslandPayloadKindSchema.options;
    for (const kind of kinds) {
      const minimal = {
        id: `test-${kind}-${Date.now()}`,
        kind,
        severity: "info" as const,
        title: `测试 ${kind}`,
        message: `kind=${kind} 的自动化验收测试`,
      };
      const parsed = DynamicIslandPayloadSchema.safeParse(minimal);
      expect(parsed.success).toBe(true);
    }
  });

  it("无效 kind 被 schema 拒绝", () => {
    const bad = {
      id: "bad-1",
      kind: "invalid.kind",
      severity: "info",
      title: "坏数据",
      message: "不应通过",
    };
    const parsed = DynamicIslandPayloadSchema.safeParse(bad);
    expect(parsed.success).toBe(false);
  });

  it("缺少必填字段被 schema 拒绝", () => {
    const missingTitle = {
      id: "no-title",
      kind: "goal.done",
      severity: "success",
      message: "缺标题",
    };
    const parsed = DynamicIslandPayloadSchema.safeParse(missingTitle);
    expect(parsed.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. 灵动岛 — /api/island/seen 已读标记 API
// ---------------------------------------------------------------------------
describe("灵动岛 — /api/island/seen 已读标记", () => {
  beforeEach(() => {
    process.env.OPENX_DB_PATH = ":memory:";
    resetDb();
  });

  it("GET /api/island/seen 空库返回空数组", async () => {
    const res = await app.request("/api/island/seen");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { seenIds: string[] };
    expect(body.seenIds).toEqual([]);
  });

  it("POST /api/island/seen 标记后 GET 可查到", async () => {
    const post = await app.request("/api/island/seen", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ ids: ["isl-1", "isl-2", "isl-3"] }),
    });
    expect(post.status).toBe(200);
    const postBody = (await post.json()) as { ok: true; marked: number };
    expect(postBody.marked).toBe(3);

    // 验证持久化
    expect(isIslandSeenInDb("isl-1")).toBe(true);
    expect(isIslandSeenInDb("isl-2")).toBe(true);
    expect(isIslandSeenInDb("isl-3")).toBe(true);
    expect(isIslandSeenInDb("isl-nonexist")).toBe(false);
  });

  it("重复标记幂等（不报错、marked 只计新增）", async () => {
    await app.request("/api/island/seen", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ ids: ["dup-1", "dup-2"] }),
    });
    const post2 = await app.request("/api/island/seen", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ ids: ["dup-1", "dup-3"] }),
    });
    const body = (await post2.json()) as { ok: true; marked: number };
    expect(body.marked).toBe(1); // 仅 dup-3 为新
    expect(isIslandSeenInDb("dup-1")).toBe(true);
    expect(isIslandSeenInDb("dup-3")).toBe(true);
  });

  it("POST 空 ids 返回错误", async () => {
    const res = await app.request("/api/island/seen", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ ids: [] }),
    });
    // Zod parse 失败会 throw → 500
    expect(res.status).toBe(500);
  });

  it("GET 支持 limit 参数", async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `batch-${i}`);
    await app.request("/api/island/seen", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ ids }),
    });
    const res = await app.request("/api/island/seen?limit=5");
    const body = (await res.json()) as { seenIds: string[] };
    expect(body.seenIds).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// 3. 灵动岛 — /api/system/island/push 推送端点
// ---------------------------------------------------------------------------
describe("灵动岛 — /api/system/island/push", () => {
  it("推送有效 payload 返回 ok", async () => {
    const res = await app.request("/api/system/island/push", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        id: "push-test-1",
        kind: "broadcast",
        severity: "info",
        title: "推送测试",
        message: "自动化验收推送",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; id: string };
    expect(body.ok).toBe(true);
    expect(body.id).toBe("push-test-1");
  });

  it("推送含 actions 的完整 payload", async () => {
    const res = await app.request("/api/system/island/push", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        id: "push-full-1",
        kind: "goal.awaiting_review",
        severity: "info",
        title: "完整推送",
        message: "包含按钮",
        goalId: "g-1",
        expanded: true,
        allowFeedback: true,
        feedbackPlaceholder: "请输入反馈…",
        meta: {
          status: "awaiting_review",
          iterationCount: 2,
          maxIterations: 20,
          resultPreview: "结果预览",
        },
        actions: [
          {
            id: "approve",
            label: "确认完成",
            variant: "primary",
            action: { type: "approve", goalId: "g-1" },
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; id: string };
    expect(body.ok).toBe(true);
  });

  it("推送无效 payload 返回 500", async () => {
    const res = await app.request("/api/system/island/push", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        // 缺少 kind / title / message
        id: "bad-push",
      }),
    });
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// 4. 三态筛选 — goalDisplayOutcome 映射
// ---------------------------------------------------------------------------
describe("三态筛选 — goalDisplayOutcome 映射", () => {
  it("done → done", () => {
    const goal = makeGoal({ status: "done" });
    expect(goalDisplayOutcome(goal)).toBe("done");
  });

  it("failed → failed", () => {
    const goal = makeGoal({ status: "failed" });
    expect(goalDisplayOutcome(goal)).toBe("failed");
  });

  it("cancelled → failed", () => {
    const goal = makeGoal({ status: "cancelled" });
    expect(goalDisplayOutcome(goal)).toBe("failed");
  });

  it("draft → incomplete", () => {
    const goal = makeGoal({ status: "draft" });
    expect(goalDisplayOutcome(goal)).toBe("incomplete");
  });

  it("running → incomplete", () => {
    const goal = makeGoal({ status: "running" });
    expect(goalDisplayOutcome(goal)).toBe("incomplete");
  });

  it("awaiting_review → incomplete", () => {
    const goal = makeGoal({ status: "awaiting_review" });
    expect(goalDisplayOutcome(goal)).toBe("incomplete");
  });

  it("覆盖所有 GoalStatus → GoalDisplayOutcome 映射", () => {
    const cases: [Goal["status"], GoalDisplayOutcome][] = [
      ["draft", "incomplete"],
      ["running", "incomplete"],
      ["awaiting_review", "incomplete"],
      ["done", "done"],
      ["failed", "failed"],
      ["cancelled", "failed"],
    ];
    for (const [status, expected] of cases) {
      const goal = makeGoal({ status });
      expect(goalDisplayOutcome(goal)).toBe(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. 三态筛选 — goalMatchesDisplayFilter
// ---------------------------------------------------------------------------
describe("三态筛选 — goalMatchesDisplayFilter", () => {
  it('filter "all" 匹配所有状态', () => {
    const statuses: Goal["status"][] = [
      "draft", "running", "awaiting_review", "done", "failed", "cancelled",
    ];
    for (const status of statuses) {
      const goal = makeGoal({ status });
      expect(goalMatchesDisplayFilter(goal, "all")).toBe(true);
    }
  });

  it('filter "incomplete" 仅匹配未完成', () => {
    expect(goalMatchesDisplayFilter(makeGoal({ status: "draft" }), "incomplete")).toBe(true);
    expect(goalMatchesDisplayFilter(makeGoal({ status: "running" }), "incomplete")).toBe(true);
    expect(goalMatchesDisplayFilter(makeGoal({ status: "awaiting_review" }), "incomplete")).toBe(true);
    expect(goalMatchesDisplayFilter(makeGoal({ status: "done" }), "incomplete")).toBe(false);
    expect(goalMatchesDisplayFilter(makeGoal({ status: "failed" }), "incomplete")).toBe(false);
    expect(goalMatchesDisplayFilter(makeGoal({ status: "cancelled" }), "incomplete")).toBe(false);
  });

  it('filter "done" 仅匹配已完成', () => {
    expect(goalMatchesDisplayFilter(makeGoal({ status: "done" }), "done")).toBe(true);
    expect(goalMatchesDisplayFilter(makeGoal({ status: "draft" }), "done")).toBe(false);
    expect(goalMatchesDisplayFilter(makeGoal({ status: "running" }), "done")).toBe(false);
    expect(goalMatchesDisplayFilter(makeGoal({ status: "awaiting_review" }), "done")).toBe(false);
    expect(goalMatchesDisplayFilter(makeGoal({ status: "failed" }), "done")).toBe(false);
  });

  it('filter "failed" 匹配 failed 和 cancelled', () => {
    expect(goalMatchesDisplayFilter(makeGoal({ status: "failed" }), "failed")).toBe(true);
    expect(goalMatchesDisplayFilter(makeGoal({ status: "cancelled" }), "failed")).toBe(true);
    expect(goalMatchesDisplayFilter(makeGoal({ status: "done" }), "failed")).toBe(false);
    expect(goalMatchesDisplayFilter(makeGoal({ status: "draft" }), "failed")).toBe(false);
  });

  it('filter "rework" 仅匹配返工中（running + effectStatus=rework）', () => {
    expect(goalMatchesDisplayFilter(
      makeGoal({ status: "running", effectStatus: "rework" }), "rework",
    )).toBe(true);
    expect(goalMatchesDisplayFilter(
      makeGoal({ status: "running" }), "rework",
    )).toBe(false);
    expect(goalMatchesDisplayFilter(
      makeGoal({ status: "awaiting_review", effectStatus: "rework" }), "rework",
    )).toBe(false);
  });

  it('filter "awaiting_review" 仅匹配 awaiting_review 状态', () => {
    expect(goalMatchesDisplayFilter(
      makeGoal({ status: "awaiting_review" }), "awaiting_review",
    )).toBe(true);
    expect(goalMatchesDisplayFilter(
      makeGoal({ status: "draft" }), "awaiting_review",
    )).toBe(false);
    expect(goalMatchesDisplayFilter(
      makeGoal({ status: "running" }), "awaiting_review",
    )).toBe(false);
  });

  it('filter "running" 仅匹配 running 状态', () => {
    expect(goalMatchesDisplayFilter(makeGoal({ status: "running" }), "running")).toBe(true);
    expect(goalMatchesDisplayFilter(makeGoal({ status: "draft" }), "running")).toBe(false);
  });

  it('filter "draft" 仅匹配 draft 状态', () => {
    expect(goalMatchesDisplayFilter(makeGoal({ status: "draft" }), "draft")).toBe(true);
    expect(goalMatchesDisplayFilter(makeGoal({ status: "running" }), "draft")).toBe(false);
  });

  it("未知 filter 回退到 status 精确匹配", () => {
    expect(goalMatchesDisplayFilter(makeGoal({ status: "done" }), "done")).toBe(true);
    expect(goalMatchesDisplayFilter(makeGoal({ status: "draft" }), "done")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. 三态筛选 — goalDisplayLabel / goalDisplayHint
// ---------------------------------------------------------------------------
describe("三态筛选 — 展示文案", () => {
  it("goalDisplayLabel 三态主标签", () => {
    expect(goalDisplayLabel(makeGoal({ status: "done" }))).toBe("已完成");
    expect(goalDisplayLabel(makeGoal({ status: "failed" }))).toBe("失败");
    expect(goalDisplayLabel(makeGoal({ status: "cancelled" }))).toBe("已取消");
    expect(goalDisplayLabel(makeGoal({ status: "draft" }))).toBe("未完成");
    expect(goalDisplayLabel(makeGoal({ status: "running" }))).toBe("未完成");
    expect(goalDisplayLabel(makeGoal({ status: "awaiting_review" }))).toBe("未完成");
  });

  it("goalDisplayHint 细分副标签", () => {
    expect(goalDisplayHint(makeGoal({ status: "awaiting_review" }))).toBe("待验收");
    expect(goalDisplayHint(makeGoal({ status: "running" }))).toBe("进行中");
    expect(goalDisplayHint(makeGoal({ status: "running", effectStatus: "rework" }))).toBe("返工中");
    expect(goalDisplayHint(makeGoal({ status: "draft" }))).toBe("未开始");
    expect(goalDisplayHint(makeGoal({ status: "done" }))).toBeNull();
    expect(goalDisplayHint(makeGoal({ status: "failed" }))).toBe("执行失败");
    expect(goalDisplayHint(makeGoal({ status: "cancelled" }))).toBe("已取消");
  });
});
