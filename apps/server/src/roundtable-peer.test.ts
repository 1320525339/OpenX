import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROUNDTABLE_FOREMAN_PROFILE_ID } from "@openx/shared";
import {
  resetDb,
  listCoachMessages,
  getConversationById,
  getCoachMessageById,
  saveRoundtableTextMessage,
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
  handleConcludeDiscussion,
  cancelActiveRounds,
  cancelRoundtableReply,
  rejectPeerRequest,
  approvePeerRequest,
  resetPeerChainStateForTests,
  openPeerChainForNewRound,
  flushDeferredPeerPublishes,
  healOrphanStreamingMessages,
  MAX_PEER_CHAIN_HOPS,
  isPeerChainClosed,
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

function nonForemanPair() {
  const parts = listConversationParticipants(TEST_CONVERSATION_ID);
  const from = parts.find((p) => p.profileId !== ROUNDTABLE_FOREMAN_PROFILE_ID)!;
  const to = parts.find(
    (p) => p.profileId !== ROUNDTABLE_FOREMAN_PROFILE_ID && p.id !== from.id,
  )!;
  return { parts, from, to };
}

describe("roundtable peer + cancel", () => {
  beforeEach(() => {
    process.env.OPENX_DB_PATH = ":memory:";
    resetDb();
    seedTestProjectAndConversation();
    resetPeerChainStateForTests();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetDb();
    resetPeerChainStateForTests();
    delete process.env.OPENX_DB_PATH;
  });

  it("handleRequestPeerReply 创建 pending 卡；reject 后状态更新", async () => {
    await enableRoundtable();
    const { parts, from, to } = nonForemanPair();

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

  it("approve 后目标方回答且发起方再反馈", async () => {
    await enableRoundtable();
    const { parts, from, to } = nonForemanPair();

    const r = handleRequestPeerReply({
      conversationId: TEST_CONVERSATION_ID,
      roundId: "round-feedback",
      from,
      participants: parts,
      targetParticipantId: to.id,
      question: "请评估风险",
    });
    expect(r.ok).toBe(true);
    await approvePeerRequest(r.requestId!);

    await vi.waitFor(
      () => {
        const texts = listCoachMessages(TEST_CONVERSATION_ID).filter(
          (m) =>
            m.kind === "text" &&
            m.generationStatus === "completed" &&
            m.text.trim().length > 0,
        );
        const targetMsgs = texts.filter((m) => m.speakerId === to.id);
        const fromMsgs = texts.filter((m) => m.speakerId === from.id);
        expect(targetMsgs.length).toBeGreaterThanOrEqual(1);
        expect(fromMsgs.length).toBeGreaterThanOrEqual(1);
      },
      { timeout: 5000, interval: 50 },
    );
  });

  it("conclude 后写入 synthesis，且再追问被拒绝", async () => {
    await enableRoundtable();
    openPeerChainForNewRound(TEST_CONVERSATION_ID);
    const { parts, from, to } = nonForemanPair();

    const r = handleRequestPeerReply({
      conversationId: TEST_CONVERSATION_ID,
      roundId: "round-conclude",
      from,
      participants: parts,
      targetParticipantId: to.id,
      question: "Q",
    });
    expect(r.ok).toBe(true);

    const concluded = handleConcludeDiscussion({
      conversationId: TEST_CONVERSATION_ID,
      roundId: "round-conclude",
      summary: "已达成共识",
      goalMet: true,
      nextSteps: "开工",
    });
    expect(concluded.ok).toBe(true);
    expect(isPeerChainClosed(TEST_CONVERSATION_ID)).toBe(true);

    const syn = listCoachMessages(TEST_CONVERSATION_ID).find(
      (m) => m.kind === "round_synthesis",
    );
    expect(syn?.kind).toBe("round_synthesis");
    if (syn?.kind === "round_synthesis") {
      expect(syn.synthesis.consensus).toBe("已达成共识");
      expect(syn.synthesis.disagreements).toBe("追问链收束");
    }

    const blocked = handleRequestPeerReply({
      conversationId: TEST_CONVERSATION_ID,
      roundId: "round-after",
      from,
      participants: parts,
      targetParticipantId: to.id,
      question: "再问",
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.message).toMatch(/追问链已结束/);
  });

  it("cancelActiveRounds 将 pending peer 标为 cancelled", async () => {
    await enableRoundtable();
    openPeerChainForNewRound(TEST_CONVERSATION_ID);
    const { parts, from, to } = nonForemanPair();

    const r = handleRequestPeerReply({
      conversationId: TEST_CONVERSATION_ID,
      roundId: "round-stop",
      from,
      participants: parts,
      targetParticipantId: to.id,
      question: "停我",
    });
    expect(r.ok).toBe(true);
    cancelActiveRounds(TEST_CONVERSATION_ID);
    expect(getPeerRequestById(r.requestId!)?.status).toBe("cancelled");
    expect(isPeerChainClosed(TEST_CONVERSATION_ID)).toBe(true);

    const blocked = handleRequestPeerReply({
      conversationId: TEST_CONVERSATION_ID,
      roundId: "round-stop-2",
      from,
      participants: parts,
      targetParticipantId: to.id,
      question: "再问",
    });
    expect(blocked.ok).toBe(false);
  });

  it("追问链深度达上限后拒绝新追问", async () => {
    await enableRoundtable();
    openPeerChainForNewRound(TEST_CONVERSATION_ID);
    const { parts, from, to } = nonForemanPair();

    for (let i = 0; i < MAX_PEER_CHAIN_HOPS; i++) {
      const r = handleRequestPeerReply({
        conversationId: TEST_CONVERSATION_ID,
        roundId: `round-hop-${i}`,
        from,
        participants: parts,
        targetParticipantId: to.id,
        question: `Q${i}`,
      });
      expect(r.ok).toBe(true);
      await approvePeerRequest(r.requestId!);
    }

    const blocked = handleRequestPeerReply({
      conversationId: TEST_CONVERSATION_ID,
      roundId: "round-hop-over",
      from,
      participants: parts,
      targetParticipantId: to.id,
      question: "Q-over",
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.message).toMatch(/上限/);
  });

  it("approve-session 写入 grant，再次请求 auto_approved", async () => {
    await enableRoundtable();
    openPeerChainForNewRound(TEST_CONVERSATION_ID);
    const { parts, from, to } = nonForemanPair();

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

    const r2 = cancelActiveRounds(TEST_CONVERSATION_ID);
    expect(Array.isArray(r2.roundIds)).toBe(true);
  });

  it("无 AbortController 时仍可取消 streaming 消息", async () => {
    await enableRoundtable();
    const pending = saveRoundtableTextMessage({
      conversationId: TEST_CONVERSATION_ID,
      speakerType: "participant",
      speakerId: "seat-x",
      text: "半截",
      generationStatus: "streaming",
    });

    expect(cancelRoundtableReply(pending.id)).toBe(true);
    const updated = getCoachMessageById(pending.id);
    expect(updated?.kind).toBe("text");
    if (updated?.kind === "text") {
      expect(updated.generationStatus).toBe("cancelled");
      expect(updated.text).toContain("半截");
    }
  });

  it("cancelActiveRounds 可清掉无 running round 的 streaming", async () => {
    await enableRoundtable();
    openPeerChainForNewRound(TEST_CONVERSATION_ID);
    const pending = saveRoundtableTextMessage({
      conversationId: TEST_CONVERSATION_ID,
      speakerType: "participant",
      speakerId: "seat-y",
      text: "",
      generationStatus: "streaming",
    });

    const result = cancelActiveRounds(TEST_CONVERSATION_ID);
    expect(result.cancelledMessageIds).toContain(pending.id);
    const updated = getCoachMessageById(pending.id);
    expect(updated?.kind).toBe("text");
    if (updated?.kind === "text") {
      expect(updated.generationStatus).toBe("cancelled");
    }
  });

  it("healOrphanStreamingMessages 只清理非 running round 的 streaming", async () => {
    await enableRoundtable();
    const orphan = saveRoundtableTextMessage({
      conversationId: TEST_CONVERSATION_ID,
      speakerType: "participant",
      speakerId: "seat-x",
      text: "",
      generationStatus: "streaming",
    });
    const healed = healOrphanStreamingMessages(TEST_CONVERSATION_ID);
    expect(healed).toContain(orphan.id);
    const updated = getCoachMessageById(orphan.id);
    expect(updated?.kind).toBe("text");
    if (updated?.kind === "text") {
      expect(updated.generationStatus).toBe("cancelled");
    }
  });

  it("deferPublish 时确认卡在 flush 后才出现", async () => {
    await enableRoundtable();
    openPeerChainForNewRound(TEST_CONVERSATION_ID);
    const { parts, from, to } = nonForemanPair();

    const r = handleRequestPeerReply({
      conversationId: TEST_CONVERSATION_ID,
      roundId: "round-defer",
      from,
      participants: parts,
      targetParticipantId: to.id,
      question: "请从产品角度评估",
      deferPublish: true,
    });
    expect(r.ok).toBe(true);
    expect(
      listCoachMessages(TEST_CONVERSATION_ID).some((m) => m.kind === "peer_request"),
    ).toBe(false);

    flushDeferredPeerPublishes("round-defer");
    const card = listCoachMessages(TEST_CONVERSATION_ID).find(
      (m) => m.kind === "peer_request",
    );
    expect(card?.kind).toBe("peer_request");
    expect(getPeerRequestById(r.requestId!)?.messageId).toBeDefined();
  });
});
