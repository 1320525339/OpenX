import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { nanoid } from "nanoid";
import type { Goal } from "@openx/shared";
import {
  resetDb,
  insertProject,
  insertConversation,
  insertGoal,
  getGoalById,
  getConversationById,
  getProjectById,
  listCoachMessages,
  listConversations,
  listGoals,
  saveCoachMessage,
  appendCrewExchange,
  listCrewExchanges,
  projectGoalVaultConversationId,
  isProjectGoalVaultConversationId,
} from "./db.js";
import {
  listConversationParticipants,
  seedRoundtableParticipants,
  insertChatRound,
  listRunningChatRounds,
} from "./db/roundtable-repo.js";
import { appendSseEvent, listSseEventsAfter } from "./db/sse-repo.js";
import {
  ensureSystemMainConversation,
  SYSTEM_MAIN_CONVERSATION_ID,
  SYSTEM_PROJECT_ID,
} from "./system-workspace.js";
import {
  ConversationForgetError,
  forgetConversation,
  forgetProjectConversations,
} from "./conversation-forget.js";
import { createKnowledgeEntry, listKnowledgeEntries } from "./knowledge-store.js";
import * as roundtableService from "./roundtable-service.js";

function makeGoal(conversationId: string, overrides: Partial<Goal> = {}): Goal {
  const now = new Date().toISOString();
  return {
    id: nanoid(),
    conversationId,
    title: "任务",
    acceptance: "通过",
    executionPrompt: "执行",
    constraints: [],
    executorId: "pi",
    status: "draft",
    progress: 0,
    dependsOn: [],
    priority: "medium",
    orderNo: 1,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function seedUserProject(
  opts?: { withRoundtable?: boolean },
  trackWorkspace?: (dir: string) => void,
) {
  const now = new Date().toISOString();
  const projectId = nanoid();
  const conversationId = nanoid();
  const workspaceDir = mkdtempSync(join(tmpdir(), "openx-forget-ws-"));
  trackWorkspace?.(workspaceDir);
  insertProject({
    id: projectId,
    name: "遗忘测试项目",
    workspaceDir,
    createdAt: now,
  });
  insertConversation({
    id: conversationId,
    projectId,
    title: "测试对话",
    mode: opts?.withRoundtable ? "roundtable" : "foreman",
    createdAt: now,
    updatedAt: now,
  });
  if (opts?.withRoundtable) {
    seedRoundtableParticipants(conversationId, []);
  }
  return { projectId, conversationId, workspaceDir };
}

describe("conversation forget", () => {
  let openxHome = "";
  const workspaceDirs: string[] = [];
  const prevHome = process.env.OPENX_HOME;
  const prevConfig = process.env.OPENX_CONFIG_PATH;
  const prevProviders = process.env.OPENX_PROVIDERS_PATH;
  const prevDb = process.env.OPENX_DB_PATH;

  beforeEach(() => {
    openxHome = mkdtempSync(join(tmpdir(), "openx-forget-home-"));
    workspaceDirs.length = 0;
    writeFileSync(join(openxHome, "config.json"), "{}");
    process.env.OPENX_HOME = openxHome;
    process.env.OPENX_CONFIG_PATH = join(openxHome, "config.json");
    process.env.OPENX_PROVIDERS_PATH = join(openxHome, "providers.json");
    process.env.OPENX_DB_PATH = ":memory:";
    resetDb();
  });

  afterEach(() => {
    resetDb();
    vi.restoreAllMocks();
    if (prevDb === undefined) delete process.env.OPENX_DB_PATH;
    else process.env.OPENX_DB_PATH = prevDb;
    if (prevHome === undefined) delete process.env.OPENX_HOME;
    else process.env.OPENX_HOME = prevHome;
    if (prevConfig === undefined) delete process.env.OPENX_CONFIG_PATH;
    else process.env.OPENX_CONFIG_PATH = prevConfig;
    if (prevProviders === undefined) delete process.env.OPENX_PROVIDERS_PATH;
    else process.env.OPENX_PROVIDERS_PATH = prevProviders;
    rmSync(openxHome, { recursive: true, force: true });
    for (const dir of workspaceDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("clear_thread：清空消息与运行态，保留会话壳、席位与 goals", () => {
    const { conversationId } = seedUserProject({ withRoundtable: true }, (d) =>
      workspaceDirs.push(d),
    );
    const goal = makeGoal(conversationId);
    insertGoal(goal);
    saveCoachMessage(conversationId, "user", "你好");
    saveCoachMessage(conversationId, "coach", "收到");
    appendCrewExchange({
      goalId: goal.id,
      conversationId,
      direction: "foreman_to_crew",
      summary: "派单",
    });
    insertChatRound({
      id: nanoid(),
      conversationId,
      mode: "diverge",
      participantIds: [],
      synthesize: false,
      status: "running",
      estimatedCalls: 1,
      createdAt: new Date().toISOString(),
    });
    const seatsBefore = listConversationParticipants(conversationId);
    expect(seatsBefore.length).toBeGreaterThan(0);

    const report = forgetConversation(conversationId, "clear_thread");

    expect(report.level).toBe("clear_thread");
    expect(report.messagesDeleted).toBeGreaterThanOrEqual(2);
    expect(listCoachMessages(conversationId)).toHaveLength(0);
    expect(listCrewExchanges(goal.id)).toHaveLength(0);
    expect(listRunningChatRounds(conversationId)).toHaveLength(0);
    expect(getConversationById(conversationId)).toBeDefined();
    expect(listConversationParticipants(conversationId)).toHaveLength(seatsBefore.length);
    expect(getGoalById(goal.id)?.conversationId).toBe(conversationId);
  });

  it("delete_conversation：删会话壳，goals 迁入任务保管箱，知识不动", () => {
    const { projectId, conversationId, workspaceDir } = seedUserProject(undefined, (d) =>
      workspaceDirs.push(d),
    );
    const goal = makeGoal(conversationId, { title: "保留任务" });
    insertGoal(goal);
    saveCoachMessage(conversationId, "user", "将删除");
    const marker = join(workspaceDir, ".openx-knowledge-marker.txt");
    writeFileSync(marker, "keep-me");
    createKnowledgeEntry(
      "user",
      {
        title: "项目知识条目",
        content: "遗忘会话不应删除本条",
        source: "manual",
      },
      projectId,
    );

    const report = forgetConversation(conversationId, "delete_conversation");

    expect(report.level).toBe("delete_conversation");
    expect(report.goalsReassigned).toBe(1);
    expect(getConversationById(conversationId)).toBeUndefined();
    const kept = getGoalById(goal.id);
    expect(kept).toBeDefined();
    expect(kept?.title).toBe("保留任务");
    expect(isProjectGoalVaultConversationId(kept!.conversationId)).toBe(true);
    expect(kept!.conversationId).toBe(projectGoalVaultConversationId(projectId));
    expect(getConversationById(kept!.conversationId)?.title).toBe("任务保管箱");
    expect(listGoals({ projectId }).some((g) => g.id === goal.id)).toBe(true);
    expect(existsSync(marker)).toBe(true);
    expect(readFileSync(marker, "utf8")).toBe("keep-me");
    expect(listKnowledgeEntries("user", projectId).length).toBeGreaterThanOrEqual(1);
  });

  it("系统会话禁止 delete，允许 clear_thread", () => {
    ensureSystemMainConversation();
    saveCoachMessage(SYSTEM_MAIN_CONVERSATION_ID, "user", "调度台消息");

    expect(() =>
      forgetConversation(SYSTEM_MAIN_CONVERSATION_ID, "delete_conversation"),
    ).toThrow(ConversationForgetError);

    try {
      forgetConversation(SYSTEM_MAIN_CONVERSATION_ID, "delete_conversation");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConversationForgetError);
      expect((err as ConversationForgetError).status).toBe(403);
    }

    const report = forgetConversation(SYSTEM_MAIN_CONVERSATION_ID, "clear_thread");
    expect(report.messagesDeleted).toBeGreaterThanOrEqual(1);
    expect(listCoachMessages(SYSTEM_MAIN_CONVERSATION_ID)).toHaveLength(0);
    expect(getConversationById(SYSTEM_MAIN_CONVERSATION_ID)).toBeDefined();
    expect(getProjectById(SYSTEM_PROJECT_ID)).toBeDefined();
  });

  it("forget_project：用户项目删掉全部会话壳，保留项目与 goals", () => {
    const { projectId, conversationId } = seedUserProject(undefined, (d) =>
      workspaceDirs.push(d),
    );
    const convB = nanoid();
    const now = new Date().toISOString();
    insertConversation({
      id: convB,
      projectId,
      title: "对话 B",
      createdAt: now,
      updatedAt: now,
    });
    const goalA = makeGoal(conversationId, { title: "A", orderNo: 1 });
    const goalB = makeGoal(convB, { title: "B", orderNo: 2 });
    insertGoal(goalA);
    insertGoal(goalB);
    saveCoachMessage(conversationId, "user", "A");
    saveCoachMessage(convB, "user", "B");

    const report = forgetProjectConversations(projectId);

    expect(report.level).toBe("forget_project");
    expect(getProjectById(projectId)).toBeDefined();
    expect(getConversationById(conversationId)).toBeUndefined();
    expect(getConversationById(convB)).toBeUndefined();
    const remaining = listConversations(projectId);
    expect(remaining.every((c) => isProjectGoalVaultConversationId(c.id))).toBe(true);
    expect(getGoalById(goalA.id)).toBeDefined();
    expect(getGoalById(goalB.id)).toBeDefined();
    expect(listGoals({ projectId })).toHaveLength(2);
  });

  it("clear/delete 前先 abort 进行中生成", async () => {
    const { conversationId } = seedUserProject(undefined, (d) => workspaceDirs.push(d));
    const roundSpy = vi
      .spyOn(roundtableService, "cancelActiveRounds")
      .mockReturnValue({ roundIds: ["r1"], cancelledMessageIds: [1] });
    const { createCoachStreamBroadcaster } = await import("./coach-stream.js");
    const live = createCoachStreamBroadcaster(conversationId);
    expect(live.isLive()).toBe(true);

    forgetConversation(conversationId, "clear_thread");
    expect(roundSpy).toHaveBeenCalledWith(conversationId);
    expect(live.isLive()).toBe(false);
    expect(live.signal.aborted).toBe(true);

    const conv2 = nanoid();
    insertConversation({
      id: conv2,
      projectId: getConversationById(conversationId)!.projectId,
      title: "待删",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const live2 = createCoachStreamBroadcaster(conv2);
    roundSpy.mockClear();
    forgetConversation(conv2, "delete_conversation");
    expect(roundSpy).toHaveBeenCalledWith(conv2);
    expect(live2.isLive()).toBe(false);
  });

  it("SSE 按 conversationId 作废，避免 catchup 幽灵事件", () => {
    const { conversationId } = seedUserProject(undefined, (d) => workspaceDirs.push(d));
    appendSseEvent({
      type: "coach.message",
      conversationId,
      message: {
        id: 1,
        conversationId,
        role: "coach",
        text: "幽灵",
        kind: "text",
        timestamp: new Date().toISOString(),
      },
    });
    appendSseEvent({
      type: "conversation.cleared",
      conversationId: "other",
      timestamp: new Date().toISOString(),
    });

    const report = forgetConversation(conversationId, "clear_thread");
    expect(report.ssePurged).toBeGreaterThanOrEqual(1);
    const leftover = listSseEventsAfter(0, 100);
    // 幽灵 coach.message 已清；broadcast 的 conversation.cleared 可保留
    expect(
      leftover.some(
        (e) =>
          e.eventType === "coach.message" &&
          "conversationId" in e.payload &&
          (e.payload as { conversationId?: string }).conversationId === conversationId,
      ),
    ).toBe(false);
    expect(
      leftover.some(
        (e) =>
          e.eventType === "conversation.cleared" &&
          "conversationId" in e.payload &&
          (e.payload as { conversationId?: string }).conversationId === "other",
      ),
    ).toBe(true);
  });

  it("任务保管箱禁止 delete_conversation", () => {
    const { projectId } = seedUserProject(undefined, (d) => workspaceDirs.push(d));
    const vaultId = projectGoalVaultConversationId(projectId);
    insertConversation({
      id: vaultId,
      projectId,
      title: "任务保管箱",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(() =>
      forgetConversation(vaultId, "delete_conversation"),
    ).toThrow(ConversationForgetError);
    try {
      forgetConversation(vaultId, "delete_conversation");
    } catch (err) {
      expect((err as ConversationForgetError).status).toBe(403);
    }
    expect(getConversationById(vaultId)).toBeDefined();
  });

  it("系统项目 forget_project 仅 clear 不删壳", () => {
    ensureSystemMainConversation();
    saveCoachMessage(SYSTEM_MAIN_CONVERSATION_ID, "user", "系统消息");
    const report = forgetProjectConversations(SYSTEM_PROJECT_ID);
    expect(report.level).toBe("forget_project");
    expect(getConversationById(SYSTEM_MAIN_CONVERSATION_ID)).toBeDefined();
    expect(listCoachMessages(SYSTEM_MAIN_CONVERSATION_ID)).toHaveLength(0);
  });
});
