import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ROUNDTABLE_ALL_PARTICIPANTS_ID,
  ROUNDTABLE_FOREMAN_PROFILE_ID,
  ROUNDTABLE_MAX_PARALLEL_REPLIES,
  type ChatRound,
  type CoachMessageRecord,
  type ConversationParticipant,
} from "@openx/shared";
import { resetDb, listCoachMessages, getConversationById } from "./db.js";
import { getChatRoundById, listConversationParticipants } from "./db/roundtable-repo.js";
import { app } from "./routes.js";
import {
  seedTestProjectAndConversation,
  TEST_CONVERSATION_ID,
} from "./test-helpers.js";

type ParticipantReplyInput = {
  displayName: string;
  historyText?: string;
  abortSignal?: AbortSignal;
  onDelta?: (delta: string) => void;
  userMessage: string;
  modelRef: string;
};

let replyImpl: (input: ParticipantReplyInput) => Promise<{ text: string; modelRef: string }>;

vi.mock("@openx/coach", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openx/coach")>();
  return {
    ...actual,
    generateParticipantReply: vi.fn((input: ParticipantReplyInput) => replyImpl(input)),
    synthesizeRoundtable: vi.fn(
      async (input: {
        roundId: string;
        userMessage: string;
        replies: { displayName: string; text: string }[];
      }) => ({
        roundId: input.roundId,
        consensus: "测试共识",
        disagreements: "测试分歧",
        recommendation: "测试建议",
        nextSteps: "验证并派单",
      }),
    ),
    coachChatReply: vi.fn(async () => ({
      message: "已生成任务单草稿",
      refined: {
        title: "圆桌任务",
        acceptance: "验收",
        executionPrompt: "执行",
        constraints: [],
      },
    })),
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

async function waitFor(
  predicate: () => boolean,
  opts?: { timeoutMs?: number; intervalMs?: number },
): Promise<void> {
  const timeoutMs = opts?.timeoutMs ?? 5_000;
  const intervalMs = opts?.intervalMs ?? 20;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timeout after ${timeoutMs}ms`);
}

function defaultFastReply() {
  replyImpl = async (input) => {
    input.onDelta?.("片段");
    return { text: `${input.displayName}：回复`, modelRef: input.modelRef };
  };
}

describe("roundtable API (mocked LLM)", () => {
  beforeEach(() => {
    process.env.OPENX_DB_PATH = ":memory:";
    resetDb();
    seedTestProjectAndConversation();
    defaultFastReply();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetDb();
    delete process.env.OPENX_DB_PATH;
  });

  it("enable 切换为 roundtable 并播种成员；工头画像不可删", async () => {
    const enable = await post(
      `/api/roundtable/conversations/${TEST_CONVERSATION_ID}/enable`,
      {},
    );
    expect(enable.status).toBe(200);
    const body = (await enable.json()) as {
      conversation: { mode: string };
      participants: ConversationParticipant[];
    };
    expect(body.conversation.mode).toBe("roundtable");
    expect(body.participants.some((p) => p.profileId === ROUNDTABLE_FOREMAN_PROFILE_ID)).toBe(
      true,
    );
    expect(getConversationById(TEST_CONVERSATION_ID)?.mode).toBe("roundtable");

    const del = await app.request(
      `/api/roundtable/ai-profiles/${ROUNDTABLE_FOREMAN_PROFILE_ID}`,
      { method: "DELETE" },
    );
    expect(del.status).toBe(403);
  });

  it("非圆桌会话拒绝 chat/rounds", async () => {
    const res = await post(
      `/api/roundtable/conversations/${TEST_CONVERSATION_ID}/chat/rounds`,
      { message: "hi", mode: "direct" },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/圆桌/);
  });

  it("@全体超过上限返回 400", async () => {
    await post(`/api/roundtable/conversations/${TEST_CONVERSATION_ID}/enable`, {});
    const profiles = (await (
      await app.request("/api/roundtable/ai-profiles")
    ).json()) as { profiles: { id: string; name: string }[] };

    // 塞入超过上限的自定义成员（启用）
    const extras = Array.from({ length: ROUNDTABLE_MAX_PARALLEL_REPLIES + 1 }, (_, i) => {
      const id = `overflow-${i}`;
      return {
        profileId: profiles.profiles.find((p) => p.id === "architect")!.id,
        displayName: `超额${i}`,
        id,
        enabled: true,
        sortOrder: i + 10,
      };
    });
    const put = await app.request(
      `/api/roundtable/conversations/${TEST_CONVERSATION_ID}/participants`,
      {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({
          participants: [
            {
              profileId: ROUNDTABLE_FOREMAN_PROFILE_ID,
              displayName: "工头助手",
              enabled: true,
              sortOrder: 0,
            },
            ...extras,
          ],
        }),
      },
    );
    expect(put.status).toBe(200);

    const res = await post(
      `/api/roundtable/conversations/${TEST_CONVERSATION_ID}/chat/rounds`,
      {
        message: "全体发言",
        mode: "diverge",
        mentionParticipantIds: [ROUNDTABLE_ALL_PARTICIPANTS_ID],
        synthesize: false,
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain(String(ROUNDTABLE_MAX_PARALLEL_REPLIES));
  });

  it("direct 无 mention 仅工头回复 202，并完成轮次", async () => {
    await post(`/api/roundtable/conversations/${TEST_CONVERSATION_ID}/enable`, {});
    const res = await post(
      `/api/roundtable/conversations/${TEST_CONVERSATION_ID}/chat/rounds`,
      { message: "只问工头", mode: "direct" },
    );
    expect(res.status).toBe(202);
    const { round } = (await res.json()) as { round: ChatRound };
    expect(round.participantIds).toHaveLength(1);

    await waitFor(() => getChatRoundById(round.id)?.status === "completed");
    const msgs = listCoachMessages(TEST_CONVERSATION_ID).filter((m) => m.kind === "text");
    const replies = msgs.filter((m) => m.speakerType !== "user");
    expect(replies.some((m) => m.generationStatus === "completed")).toBe(true);
  });

  it("diverge 盲答：generateParticipantReply 不带 historyText；可写 synthesis", async () => {
    const { generateParticipantReply, synthesizeRoundtable } = await import("@openx/coach");
    await post(`/api/roundtable/conversations/${TEST_CONVERSATION_ID}/enable`, {});
    const parts = listConversationParticipants(TEST_CONVERSATION_ID);
    const nonForeman = parts.filter((p) => p.profileId !== ROUNDTABLE_FOREMAN_PROFILE_ID).slice(0, 2);

    const res = await post(
      `/api/roundtable/conversations/${TEST_CONVERSATION_ID}/chat/rounds`,
      {
        message: "发散议题",
        mode: "diverge",
        mentionParticipantIds: nonForeman.map((p) => p.id),
        synthesize: true,
      },
    );
    expect(res.status).toBe(202);
    const { round } = (await res.json()) as { round: ChatRound };

    await waitFor(() => getChatRoundById(round.id)?.status === "completed");

    const calls = vi.mocked(generateParticipantReply).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const [arg] of calls) {
      expect(arg.historyText).toBeUndefined();
    }
    expect(vi.mocked(synthesizeRoundtable)).toHaveBeenCalled();
    const syn = listCoachMessages(TEST_CONVERSATION_ID).find(
      (m) => m.kind === "round_synthesis",
    );
    expect(syn).toBeTruthy();
  });

  it("并行一成一败 → partial", async () => {
    await post(`/api/roundtable/conversations/${TEST_CONVERSATION_ID}/enable`, {});
    const parts = listConversationParticipants(TEST_CONVERSATION_ID);
    const targets = parts
      .filter((p) => p.profileId !== ROUNDTABLE_FOREMAN_PROFILE_ID)
      .slice(0, 2);
    expect(targets.length).toBe(2);

    let n = 0;
    replyImpl = async (input) => {
      n += 1;
      if (n === 1) throw new Error("mock fail");
      return { text: `${input.displayName} ok`, modelRef: input.modelRef };
    };

    const res = await post(
      `/api/roundtable/conversations/${TEST_CONVERSATION_ID}/chat/rounds`,
      {
        message: "并行",
        mode: "diverge",
        mentionParticipantIds: targets.map((p) => p.id),
        synthesize: false,
      },
    );
    expect(res.status).toBe(202);
    const { round } = (await res.json()) as { round: ChatRound };
    await waitFor(() => getChatRoundById(round.id)?.status === "partial");
    expect(getChatRoundById(round.id)?.status).toBe("partial");
  });

  it("cancel 中止进行中的回复；retry 可再次完成", async () => {
    await post(`/api/roundtable/conversations/${TEST_CONVERSATION_ID}/enable`, {});

    replyImpl = async (input) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => resolve(), 30_000);
        const onAbort = () => {
          clearTimeout(timer);
          reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
        };
        if (input.abortSignal?.aborted) {
          onAbort();
          return;
        }
        input.abortSignal?.addEventListener("abort", onAbort, { once: true });
      });
      return { text: "不应到达", modelRef: input.modelRef };
    };

    const res = await post(
      `/api/roundtable/conversations/${TEST_CONVERSATION_ID}/chat/rounds`,
      { message: "可取消", mode: "direct" },
    );
    expect(res.status).toBe(202);
    const { round } = (await res.json()) as { round: ChatRound };

    let streamingId = 0;
    await waitFor(() => {
      const msg = listCoachMessages(TEST_CONVERSATION_ID).find(
        (m) =>
          m.kind === "text" &&
          m.roundId === round.id &&
          m.speakerType !== "user" &&
          m.generationStatus === "streaming",
      );
      if (msg) {
        streamingId = msg.id;
        return true;
      }
      return false;
    });

    const cancel = await post(`/api/roundtable/replies/${streamingId}/cancel`);
    expect(cancel.status).toBe(200);

    await waitFor(() => {
      const msg = listCoachMessages(TEST_CONVERSATION_ID).find(
        (m) => m.kind === "text" && m.id === streamingId,
      );
      return (
        msg?.kind === "text" &&
        (msg.generationStatus === "cancelled" || msg.generationStatus === "failed")
      );
    });

    // retry 改为快速成功（会在线程末尾新建气泡，不改旧 cancelled 消息）
    defaultFastReply();
    const retry = await post(`/api/roundtable/replies/${streamingId}/retry`);
    expect(retry.status).toBe(200);

    let retryMessageId = 0;
    await waitFor(() => {
      const msg = listCoachMessages(TEST_CONVERSATION_ID).find(
        (m) =>
          m.kind === "text" &&
          m.roundId === round.id &&
          m.speakerType !== "user" &&
          m.id !== streamingId &&
          m.generationStatus === "completed" &&
          m.text.trim().length > 0,
      );
      if (msg && msg.kind === "text") {
        retryMessageId = msg.id;
        return true;
      }
      return false;
    }, { timeoutMs: 10_000 });

    const cancelledMsg = listCoachMessages(TEST_CONVERSATION_ID).find(
      (m) => m.kind === "text" && m.id === streamingId,
    );
    expect(cancelledMsg?.kind === "text" && cancelledMsg.generationStatus).toBe(
      "cancelled",
    );
    const finalMsg = listCoachMessages(TEST_CONVERSATION_ID).find(
      (m) => m.kind === "text" && m.id === retryMessageId,
    ) as Extract<CoachMessageRecord, { kind: "text" }>;
    expect(finalMsg.text.length).toBeGreaterThan(0);
  });

  it("to-work-order 走工头 refine 路径", async () => {
    const { coachChatReply } = await import("@openx/coach");
    await post(`/api/roundtable/conversations/${TEST_CONVERSATION_ID}/enable`, {});
    const parts = listConversationParticipants(TEST_CONVERSATION_ID);
    const target = parts.find((p) => p.profileId !== ROUNDTABLE_FOREMAN_PROFILE_ID)!;

    const created = await post(
      `/api/roundtable/conversations/${TEST_CONVERSATION_ID}/chat/rounds`,
      {
        message: "要出单",
        mode: "diverge",
        mentionParticipantIds: [target.id],
        synthesize: true,
      },
    );
    const { round } = (await created.json()) as { round: ChatRound };
    await waitFor(() => getChatRoundById(round.id)?.status === "completed");

    const wo = await post(`/api/roundtable/rounds/${round.id}/to-work-order`);
    expect(wo.status).toBe(200);
    expect(vi.mocked(coachChatReply)).toHaveBeenCalled();
    const body = (await wo.json()) as { refined?: { title: string } };
    expect(body.refined?.title).toBe("圆桌任务");
  });
});
