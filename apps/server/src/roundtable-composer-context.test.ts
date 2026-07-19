import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getDb,
  insertConversation,
  insertProject,
  resetDb,
} from "./db.js";
import {
  getChatRoundById,
  insertChatRound,
} from "./db/roundtable-repo.js";

function seedConversation(id = "conv-ctx") {
  const now = new Date().toISOString();
  const projectId = `proj-${id}`;
  insertProject({
    id: projectId,
    name: "Test",
    workspaceDir: process.cwd(),
    createdAt: now,
  });
  insertConversation({
    id,
    projectId,
    title: "圆桌",
    mode: "roundtable",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

describe("chat_rounds composerContext 持久化", () => {
  beforeEach(() => {
    process.env.OPENX_DB_PATH = ":memory:";
    resetDb();
  });

  afterEach(() => {
    resetDb();
    delete process.env.OPENX_DB_PATH;
  });

  it("insert/get 往返 composerContext", () => {
    const conversationId = seedConversation();
    const now = new Date().toISOString();
    insertChatRound({
      id: "round-1",
      conversationId,
      mode: "direct",
      participantIds: ["p1"],
      synthesize: false,
      status: "completed",
      estimatedCalls: 1,
      composerContext: {
        skillIds: ["shell"],
        mcpIds: ["openx"],
        permissionMode: "ask_write",
        knowledge: { mode: "custom", includeGlobal: true },
      },
      createdAt: now,
      completedAt: now,
    });
    const raw = getDb()
      .prepare("SELECT composer_context_json FROM chat_rounds WHERE id = ?")
      .get("round-1") as { composer_context_json: string | null };
    expect(raw.composer_context_json).toBeTruthy();
    const loaded = getChatRoundById("round-1");
    expect(loaded?.composerContext).toEqual({
      skillIds: ["shell"],
      mcpIds: ["openx"],
      permissionMode: "ask_write",
      knowledge: { mode: "custom", includeGlobal: true },
    });
  });

  it("无 composerContext 时读回 undefined", () => {
    const conversationId = seedConversation("conv-empty");
    const now = new Date().toISOString();
    insertChatRound({
      id: "round-2",
      conversationId,
      mode: "diverge",
      participantIds: ["p1", "p2"],
      synthesize: true,
      status: "running",
      estimatedCalls: 3,
      createdAt: now,
    });
    expect(getChatRoundById("round-2")?.composerContext).toBeUndefined();
  });
});
