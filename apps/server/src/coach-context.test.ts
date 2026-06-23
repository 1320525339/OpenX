import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { nanoid } from "nanoid";
import type { Goal } from "@openx/shared";
import { insertGoal, resetDb } from "./db.js";
import { buildCoachChatContext, buildCoachChatContextAsync, resolveNorthStarGoal } from "./coach-context.js";
import { createKnowledgeEntry } from "./knowledge-store.js";
import {
  seedTestProjectAndConversation,
  TEST_CONVERSATION_ID,
  TEST_PROJECT_ID,
} from "./test-helpers.js";
import { shutdownZvecKnowledgeIndex } from "./zvec-knowledge-index.js";

function makeGoal(overrides: Partial<Goal> & Pick<Goal, "title">): Goal {
  const now = new Date().toISOString();
  return {
    id: nanoid(),
    conversationId: TEST_CONVERSATION_ID,
    title: overrides.title,
    acceptance: overrides.acceptance ?? "验收通过",
    executionPrompt: overrides.executionPrompt ?? "执行",
    constraints: overrides.constraints ?? [],
    executorId: "pi",
    status: overrides.status ?? "draft",
    progress: overrides.progress ?? 0,
    userDraft: overrides.userDraft,
    resultSummary: overrides.resultSummary,
    effectStatus: overrides.effectStatus,
    reworkReason: overrides.reworkReason,
    parentGoalId: overrides.parentGoalId,
    dependsOn: overrides.dependsOn ?? [],
    priority: overrides.priority ?? "medium",
    createdAt: now,
    updatedAt: now,
  };
}

describe("coach-context", () => {
  let tempDir = "";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "openx-coach-ctx-"));
    writeFileSync(join(tempDir, "config.json"), "{}");
    process.env.OPENX_CONFIG_PATH = join(tempDir, "config.json");
    process.env.OPENX_DB_PATH = ":memory:";
    resetDb();
    seedTestProjectAndConversation();
  });

  afterEach(() => {
    resetDb();
    shutdownZvecKnowledgeIndex();
    delete process.env.OPENX_DB_PATH;
    delete process.env.OPENX_CONFIG_PATH;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("resolveNorthStarGoal walks up to root parent", () => {
    const root = makeGoal({ title: "核心目标", status: "running" });
    insertGoal(root);
    const child = makeGoal({
      title: "子任务",
      parentGoalId: root.id,
      status: "running",
    });
    insertGoal(child);

    expect(resolveNorthStarGoal(child.id)?.id).toBe(root.id);
  });

  it("buildCoachChatContext includes north star and sub goals", () => {
    const root = makeGoal({
      title: "搭建登录",
      status: "running",
      acceptance: "可登录",
    });
    insertGoal(root);
    const sub = makeGoal({
      title: "写 API",
      parentGoalId: root.id,
      status: "awaiting_review",
      progress: 100,
      resultSummary: "POST /login OK",
    });
    insertGoal(sub);

    const ctx = buildCoachChatContext(TEST_CONVERSATION_ID, sub.id);
    expect(ctx.northStar?.title).toBe("搭建登录");
    expect(ctx.northStar?.acceptance).toBe("可登录");
    expect(ctx.subGoals?.some((g) => g.title === "写 API")).toBe(true);
    expect(ctx.selectedGoal?.title).toBe("写 API");
    expect(ctx.workspaceRoot).toBeTruthy();
  });

  it("always uses foreman agent regardless of legacy agentId opt", () => {
    const ctx = buildCoachChatContext(TEST_CONVERSATION_ID, undefined, {
      message: "你好",
    });
    expect(ctx.agentId).toBe("coach");
    expect(ctx.agentName).toContain("工头");
  });

  it("injects project knowledge block when user knowledge exists", () => {
    createKnowledgeEntry(
      "user",
      { title: "测试知识", content: "必须使用中文 UI" },
      TEST_PROJECT_ID,
    );
    const ctx = buildCoachChatContext(TEST_CONVERSATION_ID, undefined, {
      message: "继续开发",
    });
    expect(ctx.projectMemory).toContain("项目用户知识");
    expect(ctx.projectMemory).toContain("中文 UI");
  });

  it("buildCoachChatContextAsync includes knowledge selection summary", async () => {
    createKnowledgeEntry(
      "user",
      { title: "范围测试", content: "知识库选择测试内容" },
      TEST_PROJECT_ID,
    );
    const ctx = await buildCoachChatContextAsync(TEST_CONVERSATION_ID, undefined, {
      message: "如何使用知识库",
      knowledgeSelection: { mode: "all" },
    });
    expect(ctx.knowledgeSelectionSummary).toContain("当前启用知识库");
    expect(ctx.projectMemory).toContain("当前启用知识库");
  });

  it("buildCoachChatContextAsync respects custom knowledge selection", async () => {
    createKnowledgeEntry(
      "user",
      { title: "应出现", content: "应出现在上下文中" },
      TEST_PROJECT_ID,
    );
    createKnowledgeEntry(
      "global",
      { title: "应隐藏", content: "全局知识不应出现" },
    );
    const ctx = await buildCoachChatContextAsync(TEST_CONVERSATION_ID, undefined, {
      message: "继续",
      knowledgeSelection: {
        mode: "custom",
        includeGlobal: false,
        includeProject: true,
        includeRuntime: false,
      },
    });
    expect(ctx.knowledgeSelectionSummary).toContain("自定义");
    expect(ctx.projectMemory).toContain("应出现在上下文中");
    expect(ctx.projectMemory).not.toContain("全局知识不应出现");
  });
});
