import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getDb,
  insertConversation,
  insertProject,
  listCoachMessages,
  resetDb,
  saveRoundtableTextMessage,
} from "./db.js";

function seedConversation(id = "conv-rt") {
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

/** 模拟迁移前旧行：仅有 role，speaker_* 为 NULL */
function insertLegacyTextMessage(
  conversationId: string,
  role: "user" | "coach",
  text: string,
): number {
  const result = getDb()
    .prepare(
      `INSERT INTO coach_messages (
        conversation_id, goal_id, role, text, kind, meta_json, created_at,
        speaker_type, speaker_id, reply_to_message_id, round_id,
        generation_status, generation_meta_json
      ) VALUES (?, NULL, ?, ?, 'text', NULL, ?, NULL, NULL, NULL, NULL, NULL, NULL)`,
    )
    .run(conversationId, role, text, new Date().toISOString());
  return Number(result.lastInsertRowid);
}

describe("roundtable coach message speaker compat", () => {
  beforeEach(() => {
    process.env.OPENX_DB_PATH = ":memory:";
    resetDb();
  });

  afterEach(() => {
    resetDb();
    delete process.env.OPENX_DB_PATH;
  });

  it("旧行 speaker_* 为空时从 role 派生 speakerType", () => {
    const id = seedConversation();
    insertLegacyTextMessage(id, "user", "你好");
    insertLegacyTextMessage(id, "coach", "工头答");

    const raw = getDb()
      .prepare(
        `SELECT speaker_type, speaker_id, role FROM coach_messages WHERE conversation_id = ? ORDER BY id`,
      )
      .all(id) as Array<{
      speaker_type: string | null;
      speaker_id: string | null;
      role: string;
    }>;
    expect(raw[0]?.speaker_type).toBeNull();
    expect(raw[0]?.speaker_id).toBeNull();
    expect(raw[1]?.speaker_type).toBeNull();

    const msgs = listCoachMessages(id).filter((m) => m.kind === "text");
    expect(msgs[0]).toMatchObject({
      speakerType: "user",
      speakerId: "user",
      role: "user",
      text: "你好",
    });
    expect(msgs[1]).toMatchObject({
      speakerType: "foreman",
      speakerId: "foreman",
      role: "coach",
      text: "工头答",
    });
  });

  it("participant 消息保留 speakerId", () => {
    const id = seedConversation();
    saveRoundtableTextMessage({
      conversationId: id,
      speakerType: "participant",
      speakerId: "part-1",
      text: "架构观点",
      generationStatus: "completed",
      generationMeta: { modelRef: "zen/big-pickle", profileId: "architect" },
    });
    const msg = listCoachMessages(id).find((m) => m.kind === "text");
    expect(msg).toMatchObject({
      kind: "text",
      speakerType: "participant",
      speakerId: "part-1",
      role: "coach",
      text: "架构观点",
    });
  });
});
