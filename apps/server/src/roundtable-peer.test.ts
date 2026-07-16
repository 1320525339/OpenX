import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROUNDTABLE_FOREMAN_PROFILE_ID } from "@openx/shared";
import {
  resetDb,
  listCoachMessages,
  getConversationById,
} from "./db.js";
import {
  listConversationParticipants,
  hasPeerMentionGrant,
  getPeerRequestById,
} from "./db/roundtable-repo.js";
import { app } from "./routes.js";
import {
  seedTestProjectAndConversation,
  TEST_CONVERSATION_ID,
} from "./test-helpers.js";
import {
  handleRequestPeerReply,
  cancelActiveRounds,
  rejectPeerRequest,
  approvePeerRequest,
} from "./roundtable-service.js";

vi.mock("@openx/coach", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openx/coach")>();
  return {
    ...actual,
    generateParticipantReply: vi.fn(async (input: { displayName: string; modelRef: string; onDelta?: (d: string) => void }) => {
      input.onDelta?.("x");
      await new Promise((r) => setTimeout(r, 30));
      return { text: `${input.displayName}：答`, modelRef: input.modelRef };
    }),
    synthesizeRoundtable: vi.fn(async (input: { roundId: string }) => ({
      roundId: input.roundId,
      consensus: "c",
      disagreements: "d",
      recommendation: "r",
      nextSteps: "n",
    })),
    coachChatReply: vi.fn(async () => ({ message: "ok" })),
  };
});

const jsonHeaders = { "Content-Type": "application/json" };

async function post(path: string, body?: unknown) {
  return app.request(path, {
    method: "POST",
    headers: jsonHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function enableRoundtable() {
  await post(`/api/roundtable/conversations/${TEST_CONVERSATION_ID}/enable`, {});
}

describe("roundtable peer + cancel", () => {
  beforeEach(() => {
    process.env.OPENX_DB_PATH = ":memory:";
    resetDb();
    seedTestProjectAndConversation();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetDb();
    delete process.env.OPENX_DB_PATH;
  });

  it("handleRequestPeerReply 创建 pending 卡；reject 后状态更新", async () => {
    await enableRoundtable();
    const parts = listConversationParticipants(TEST_CONVERSATION_ID);
    const from = parts.find((p) => p.profileId !== ROUNDTABLE_FOREMAN_PROFILE_ID)!;
    const to = parts.find(
      (p) => p.profileId !== ROUNDTABLE_FOREMAN_PROFILE_ID && p.id !== from.id,
    )!;

    const r = handleRequestPeerReply({
      conversationId: TEST_CONVERSATION_ID,
      roundId: "round-x",
      from,
      participants: parts,
      targetParticipantId: to.id,
      question: "请评估风险",
    });
    expect(r.ok).toBe(true);
    expect(r.autoApproved).toBeFalsy();
    const req = getPeerRequestById(r.requestId!)!;
    expect(req.status).toBe("pending");

    const card = listCoachMessages(TEST_CONVERSATION_ID).find(
      (m) => m.kind === "peer_request",
    );
    expect(card?.kind).toBe("peer_request");

    const rejected = await rejectPeerRequest(req.id);
    expect(rejected.status).toBe("rejected");
  });

  it("approve-session 写入 grant，再次请求 auto_approved", async () => {
    await enableRoundtable();
    const parts = listConversationParticipants(TEST_CONVERSATION_ID);
    const from = parts.find((p) => p.profileId !== ROUNDTABLE_FOREMAN_PROFILE_ID)!;
    const to = parts.find(
      (p) => p.profileId !== ROUNDTABLE_FOREMAN_PROFILE_ID && p.id !== from.id,
    )!;

    const first = handleRequestPeerReply({
      conversationId: TEST_CONVERSATION_ID,
      roundId: "r1",
      from,
      participants: parts,
      targetParticipantId: to.id,
      question: "Q1",
    });
    await approvePeerRequest(first.requestId!, { session: true });
    expect(
      hasPeerMentionGrant(TEST_CONVERSATION_ID, from.id, to.id),
    ).toBe(true);

    const second = handleRequestPeerReply({
      conversationId: TEST_CONVERSATION_ID,
      roundId: "r2",
      from,
      participants: parts,
      targetParticipantId: to.id,
      question: "Q2",
    });
    expect(second.autoApproved).toBe(true);
    expect(getPeerRequestById(second.requestId!)?.status).toBe("auto_approved");
  });

  it("cancel-active API 可调用", async () => {
    await enableRoundtable();
    expect(getConversationById(TEST_CONVERSATION_ID)?.mode).toBe("roundtable");

    // 启动一轮（异步生成）
    const res = await post(
      `/api/roundtable/conversations/${TEST_CONVERSATION_ID}/chat/rounds`,
      { message: "停我", mode: "direct" },
    );
    expect(res.status).toBe(202);

    const cancel = await post(
      `/api/roundtable/conversations/${TEST_CONVERSATION_ID}/rounds/cancel-active`,
    );
    expect(cancel.status).toBe(200);
    const body = (await cancel.json()) as { ok: boolean; roundIds: string[] };
    expect(body.ok).toBe(true);

    // 直接函数也可
    const r2 = cancelActiveRounds(TEST_CONVERSATION_ID);
    expect(Array.isArray(r2.roundIds)).toBe(true);
  });
});
