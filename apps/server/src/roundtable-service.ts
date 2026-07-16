import { nanoid } from "nanoid";
import {
  resolveRoundParticipants,
  generateParticipantReply,
  synthesizeRoundtable,
  formatCoachLlmError,
  coachChatReply,
  type ParticipantToolHandlers,
  type RoundtableAttendee,
  type PeerReplySnippet,
} from "@openx/coach";
import type {
  ChatRound,
  CoachMessageRecord,
  ConversationParticipant,
  CreateChatRoundInput,
  PeerRequest,
  RoundSynthesisPayload,
} from "@openx/shared";
import { ROUNDTABLE_FOREMAN_PROFILE_ID } from "@openx/shared";
import {
  getCoachMessageById,
  getConversationById,
  listCoachMessages,
  savePeerRequestMessage,
  saveRoundSynthesisMessage,
  saveRoundtableTextMessage,
  updateCoachMessageGeneration,
  updatePeerRequestMessage,
  touchConversation,
} from "./db.js";
import {
  getAiProfileById,
  getChatRoundById,
  getPeerRequestById,
  hasPeerMentionGrant,
  insertChatRound,
  insertPeerRequest,
  listConversationParticipants,
  listRunningChatRounds,
  updateChatRoundStatus,
  updatePeerRequest,
  upsertPeerMentionGrant,
} from "./db/roundtable-repo.js";
import { loadSettings } from "./settings-store.js";
import { broadcast } from "./sse.js";
import { buildCoachChatContextAsync } from "./coach-context.js";
import {
  formatRoundtableHistory,
  historyTextForReplyMode,
  resolveChatRoundStatus,
} from "./roundtable-logic.js";

const abortByMessageId = new Map<number, AbortController>();
const abortByRoundId = new Map<string, Set<number>>();

function trackAbort(roundId: string, messageId: number, controller: AbortController): void {
  abortByMessageId.set(messageId, controller);
  let set = abortByRoundId.get(roundId);
  if (!set) {
    set = new Set();
    abortByRoundId.set(roundId, set);
  }
  set.add(messageId);
}

function untrackAbort(roundId: string, messageId: number): void {
  abortByMessageId.delete(messageId);
  const set = abortByRoundId.get(roundId);
  if (set) {
    set.delete(messageId);
    if (set.size === 0) abortByRoundId.delete(roundId);
  }
}

function nameMapFor(conversationId: string): Map<string, string> {
  const participants = listConversationParticipants(conversationId);
  return new Map(participants.map((p) => [p.id, p.displayName]));
}

function buildHistoryText(
  conversationId: string,
  opts?: { excludeRoundId?: string; limit?: number },
): string {
  const records = listCoachMessages(conversationId, opts?.limit ?? 40);
  return formatRoundtableHistory(records, {
    excludeRoundId: opts?.excludeRoundId,
    nameBySpeakerId: nameMapFor(conversationId),
  });
}

function toAttendees(participants: ConversationParticipant[]): RoundtableAttendee[] {
  return participants.map((p) => {
    const profile = getAiProfileById(p.profileId);
    return {
      id: p.id,
      displayName: p.displayName,
      profileId: p.profileId,
      description: profile?.description,
      enabled: p.enabled,
    };
  });
}

function collectPeerReplies(
  conversationId: string,
  input: { speakerIds?: string[]; roundId?: string; limit?: number },
): PeerReplySnippet[] {
  const limit = input.limit ?? 12;
  const nameById = nameMapFor(conversationId);
  const records = listCoachMessages(conversationId, 80);
  const out: PeerReplySnippet[] = [];
  for (const r of [...records].reverse()) {
    if (r.kind !== "text") continue;
    if (r.speakerType === "user") continue;
    if (r.generationStatus && r.generationStatus !== "completed") continue;
    if (!r.text?.trim()) continue;
    if (input.roundId && r.roundId !== input.roundId) continue;
    if (input.speakerIds?.length && !input.speakerIds.includes(r.speakerId ?? "")) {
      continue;
    }
    out.push({
      speakerId: r.speakerId ?? "",
      displayName: nameById.get(r.speakerId ?? "") ?? r.speakerId ?? "成员",
      text: r.text.slice(0, 2000),
      roundId: r.roundId,
      messageId: r.id,
    });
    if (out.length >= limit) break;
  }
  return out;
}

function buildToolHandlers(ctx: {
  conversationId: string;
  roundId: string;
  from: ConversationParticipant;
  participants: ConversationParticipant[];
}): ParticipantToolHandlers {
  return {
    listAttendees: () => toAttendees(ctx.participants),
    getPeerReplies: (input) => collectPeerReplies(ctx.conversationId, input),
    requestPeerReply: (input) => handleRequestPeerReply({
      conversationId: ctx.conversationId,
      roundId: ctx.roundId,
      from: ctx.from,
      participants: ctx.participants,
      targetParticipantId: input.targetParticipantId,
      targetDisplayName: input.targetDisplayName,
      question: input.question,
    }),
  };
}

function resolveTargetParticipant(
  participants: ConversationParticipant[],
  targetParticipantId?: string,
  targetDisplayName?: string,
): ConversationParticipant | undefined {
  if (targetParticipantId) {
    return participants.find((p) => p.id === targetParticipantId);
  }
  if (targetDisplayName) {
    const name = targetDisplayName.trim();
    return participants.find(
      (p) => p.displayName === name || p.displayName.includes(name),
    );
  }
  return undefined;
}

export function handleRequestPeerReply(input: {
  conversationId: string;
  roundId: string;
  from: ConversationParticipant;
  participants: ConversationParticipant[];
  targetParticipantId?: string;
  targetDisplayName?: string;
  question: string;
}): { ok: boolean; message: string; requestId?: string; autoApproved?: boolean } {
  const target = resolveTargetParticipant(
    input.participants,
    input.targetParticipantId,
    input.targetDisplayName,
  );
  if (!target) {
    return { ok: false, message: "未找到目标成员，请用 list_attendees 核对显示名或 id。" };
  }
  if (target.id === input.from.id) {
    return { ok: false, message: "不能请求自己回答。" };
  }
  if (!target.enabled) {
    return { ok: false, message: `${target.displayName} 当前静音，无法请求。` };
  }

  const question = input.question.trim();
  if (!question) {
    return { ok: false, message: "问题不能为空。" };
  }

  const now = new Date().toISOString();
  const auto = hasPeerMentionGrant(
    input.conversationId,
    input.from.id,
    target.id,
  );

  const req: PeerRequest = {
    id: nanoid(),
    conversationId: input.conversationId,
    roundId: input.roundId,
    fromParticipantId: input.from.id,
    toParticipantId: target.id,
    fromDisplayName: input.from.displayName,
    toDisplayName: target.displayName,
    question,
    status: auto ? "auto_approved" : "pending",
    createdAt: now,
    resolvedAt: auto ? now : undefined,
  };

  const msg = savePeerRequestMessage(input.conversationId, req);
  req.messageId = msg.id;
  insertPeerRequest(req);
  updatePeerRequest(req.id, { messageId: msg.id });

  if (auto) {
    broadcast({
      type: "chat.peer_request.created",
      conversationId: input.conversationId,
      request: req,
      message: msg,
      timestamp: now,
    });
    broadcast({
      type: "chat.peer_request.resolved",
      conversationId: input.conversationId,
      request: req,
      message: msg,
      timestamp: now,
    });
    void spawnPeerTargetReply(req).catch((err) =>
      console.error("[roundtable] auto peer reply failed", err),
    );
    return {
      ok: true,
      requestId: req.id,
      autoApproved: true,
      message: `已自动获准：${target.displayName} 正在回答。请勿臆造其答案。`,
    };
  }

  broadcast({
    type: "chat.peer_request.created",
    conversationId: input.conversationId,
    request: req,
    message: msg,
    timestamp: now,
  });
  broadcast({
    type: "coach.message",
    conversationId: input.conversationId,
    message: msg,
  });

  return {
    ok: true,
    requestId: req.id,
    message: `已向用户发起确认：「${input.from.displayName} 请求 ${target.displayName} 回答」。请等待用户选择；勿臆造对方答案。`,
  };
}

async function runOneParticipantReply(opts: {
  round: ChatRound;
  participant: ConversationParticipant;
  participants: ConversationParticipant[];
  userMessage: string;
  historyText?: string;
  sourceSnippet?: string;
  outputGoal?: CreateChatRoundInput["outputGoal"];
  length?: CreateChatRoundInput["length"];
  pendingMessageId?: number;
}): Promise<{ participant: ConversationParticipant; text: string; messageId: number }> {
  const profile = getAiProfileById(opts.participant.profileId);
  if (!profile) throw new Error(`画像不存在: ${opts.participant.profileId}`);
  const settings = loadSettings();

  let messageId = opts.pendingMessageId;
  if (messageId == null) {
    const pending = saveRoundtableTextMessage({
      conversationId: opts.round.conversationId,
      speakerType:
        opts.participant.profileId === ROUNDTABLE_FOREMAN_PROFILE_ID
          ? "foreman"
          : "participant",
      speakerId: opts.participant.id,
      text: "",
      replyToMessageId: opts.round.sourceMessageId,
      roundId: opts.round.id,
      generationStatus: "streaming",
      generationMeta: {
        modelRef: opts.participant.modelRef,
        profileId: opts.participant.profileId,
      },
    });
    messageId = pending.id;
    broadcast({
      type: "coach.message",
      conversationId: opts.round.conversationId,
      message: pending,
    });
  } else {
    updateCoachMessageGeneration(messageId, {
      text: "",
      generationStatus: "streaming",
      generationMeta: {
        modelRef: opts.participant.modelRef,
        profileId: opts.participant.profileId,
      },
    });
  }

  const streamId = nanoid();
  const controller = new AbortController();
  trackAbort(opts.round.id, messageId, controller);

  broadcast({
    type: "chat.reply.started",
    conversationId: opts.round.conversationId,
    roundId: opts.round.id,
    messageId,
    speakerId: opts.participant.id,
    streamId,
    timestamp: new Date().toISOString(),
  });

  try {
    const { text, modelRef } = await generateParticipantReply({
      settings,
      modelRef: opts.participant.modelRef,
      rolePrompt: profile.rolePrompt,
      displayName: opts.participant.displayName,
      userMessage: opts.userMessage,
      historyText: opts.historyText,
      sourceSnippet: opts.sourceSnippet,
      outputGoal: opts.outputGoal,
      length: opts.length,
      attendees: toAttendees(opts.participants),
      tools: buildToolHandlers({
        conversationId: opts.round.conversationId,
        roundId: opts.round.id,
        from: opts.participant,
        participants: opts.participants,
      }),
      abortSignal: controller.signal,
      onDelta: (delta) => {
        broadcast({
          type: "chat.reply.delta",
          conversationId: opts.round.conversationId,
          roundId: opts.round.id,
          messageId: messageId!,
          speakerId: opts.participant.id,
          streamId,
          delta,
          timestamp: new Date().toISOString(),
        });
      },
    });

    updateCoachMessageGeneration(messageId, {
      text,
      generationStatus: "completed",
      generationMeta: { modelRef, profileId: opts.participant.profileId },
    });
    const completed = getCoachMessageById(messageId)!;
    broadcast({
      type: "chat.reply.completed",
      conversationId: opts.round.conversationId,
      roundId: opts.round.id,
      messageId,
      speakerId: opts.participant.id,
      streamId,
      text,
      timestamp: new Date().toISOString(),
    });
    broadcast({
      type: "coach.message",
      conversationId: opts.round.conversationId,
      message: completed,
    });
    return { participant: opts.participant, text, messageId };
  } catch (err) {
    const error = formatCoachLlmError(err) ?? "生成失败";
    const cancelled = controller.signal.aborted;
    updateCoachMessageGeneration(messageId, {
      text: cancelled ? "（已取消）" : `（失败）${error}`,
      generationStatus: cancelled ? "cancelled" : "failed",
      generationMeta: {
        modelRef: opts.participant.modelRef,
        profileId: opts.participant.profileId,
        error,
      },
    });
    broadcast({
      type: "chat.reply.failed",
      conversationId: opts.round.conversationId,
      roundId: opts.round.id,
      messageId,
      speakerId: opts.participant.id,
      streamId,
      error,
      timestamp: new Date().toISOString(),
    });
    const failed = getCoachMessageById(messageId);
    if (failed) {
      broadcast({
        type: "coach.message",
        conversationId: opts.round.conversationId,
        message: failed,
      });
    }
    throw err;
  } finally {
    untrackAbort(opts.round.id, messageId);
  }
}

export async function runChatRound(
  conversationId: string,
  input: CreateChatRoundInput,
): Promise<{ round: ChatRound; userMessage: CoachMessageRecord }> {
  const conversation = getConversationById(conversationId);
  if (!conversation) throw new Error("对话不存在");

  const participants = listConversationParticipants(conversationId);
  if (participants.length === 0) {
    throw new Error("请先配置圆桌成员");
  }

  const routed = resolveRoundParticipants({
    mode: input.mode,
    mentionParticipantIds: input.mentionParticipantIds,
    participants,
    synthesize: input.synthesize,
  });
  if (!routed.ok) {
    throw new Error(routed.error);
  }

  const userMsg = saveRoundtableTextMessage({
    conversationId,
    speakerType: "user",
    speakerId: "user",
    text: input.message.trim(),
    replyToMessageId: input.sourceMessageId,
  });

  const now = new Date().toISOString();
  const round: ChatRound = {
    id: nanoid(),
    conversationId,
    sourceMessageId: input.sourceMessageId ?? userMsg.id,
    mode: input.mode,
    participantIds: routed.participantIds,
    synthesize: routed.synthesize,
    status: "running",
    estimatedCalls: routed.estimatedCalls,
    outputGoal: input.outputGoal,
    length: input.length,
    createdAt: now,
  };
  insertChatRound(round);

  broadcast({
    type: "chat.round.started",
    conversationId,
    roundId: round.id,
    mode: round.mode,
    participantIds: round.participantIds,
    estimatedCalls: round.estimatedCalls,
    timestamp: now,
  });
  broadcast({
    type: "coach.message",
    conversationId,
    message: userMsg,
  });

  void executeRoundReplies(round, input, participants, userMsg.text).catch((err) => {
    console.error("[roundtable] round failed", err);
    updateChatRoundStatus(round.id, "failed", new Date().toISOString());
    broadcast({
      type: "chat.round.completed",
      conversationId,
      roundId: round.id,
      status: "failed",
      timestamp: new Date().toISOString(),
    });
  });

  return { round, userMessage: userMsg };
}

async function executeRoundReplies(
  round: ChatRound,
  input: CreateChatRoundInput,
  participants: ConversationParticipant[],
  userMessage: string,
): Promise<void> {
  const byId = new Map(participants.map((p) => [p.id, p]));
  const sourceSnippet =
    input.sourceMessageId != null
      ? (() => {
          const m = getCoachMessageById(input.sourceMessageId);
          return m && m.kind === "text" ? m.text : undefined;
        })()
      : undefined;

  const historyText = buildHistoryText(round.conversationId, {
    excludeRoundId: round.mode === "diverge" ? round.id : undefined,
  });

  const settled = await Promise.allSettled(
    round.participantIds.map(async (participantId) => {
      const participant = byId.get(participantId);
      if (!participant) throw new Error(`成员不存在: ${participantId}`);
      return runOneParticipantReply({
        round,
        participant,
        participants,
        userMessage,
        historyText: historyTextForReplyMode(round.mode, historyText),
        sourceSnippet,
        outputGoal: input.outputGoal,
        length: input.length,
      });
    }),
  );

  // 若整轮已被取消，不再写 completed
  const current = getChatRoundById(round.id);
  if (current?.status === "cancelled") return;

  const okReplies = settled
    .filter(
      (
        s,
      ): s is PromiseFulfilledResult<{
        participant: ConversationParticipant;
        text: string;
        messageId: number;
      }> => s.status === "fulfilled",
    )
    .map((s) => s.value);

  const failCount = settled.filter((s) => s.status === "rejected").length;
  let synthesizeFailed = false;

  if (round.synthesize && okReplies.length > 0) {
    try {
      const synthesis = await synthesizeRoundtable({
        settings: loadSettings(),
        roundId: round.id,
        userMessage,
        replies: okReplies.map((r) => ({
          displayName: r.participant.displayName,
          text: r.text,
        })),
      });
      const synMsg = saveRoundSynthesisMessage(round.conversationId, synthesis);
      broadcast({
        type: "coach.message",
        conversationId: round.conversationId,
        message: synMsg,
      });
    } catch (err) {
      console.error("[roundtable] synthesize failed", err);
      synthesizeFailed = true;
    }
  }

  const status = resolveChatRoundStatus({
    okCount: okReplies.length,
    failCount,
    synthesizeFailed,
  });

  const completedAt = new Date().toISOString();
  updateChatRoundStatus(round.id, status, completedAt);
  touchConversation(round.conversationId);
  broadcast({
    type: "chat.round.completed",
    conversationId: round.conversationId,
    roundId: round.id,
    status,
    timestamp: completedAt,
  });
}

export function cancelRoundtableReply(messageId: number): boolean {
  const controller = abortByMessageId.get(messageId);
  if (!controller) return false;
  controller.abort();
  return true;
}

/** 停止该会话所有 running 轮次的进行中生成 */
export function cancelActiveRounds(conversationId: string): {
  roundIds: string[];
  cancelledMessageIds: number[];
} {
  const rounds = listRunningChatRounds(conversationId);
  const cancelledMessageIds: number[] = [];
  const roundIds: string[] = [];

  for (const round of rounds) {
    roundIds.push(round.id);
    const ids = abortByRoundId.get(round.id);
    if (ids) {
      for (const messageId of [...ids]) {
        const controller = abortByMessageId.get(messageId);
        controller?.abort();
        cancelledMessageIds.push(messageId);
        const msg = getCoachMessageById(messageId);
        if (msg?.kind === "text" && msg.generationStatus === "streaming") {
          updateCoachMessageGeneration(messageId, {
            text: msg.text || "（已取消）",
            generationStatus: "cancelled",
          });
        }
      }
    }

    const records = listCoachMessages(conversationId, 80);
    const hasCompleted = records.some(
      (r) =>
        r.kind === "text" &&
        r.roundId === round.id &&
        r.generationStatus === "completed",
    );
    const status = hasCompleted ? "partial" : "cancelled";
    const completedAt = new Date().toISOString();
    updateChatRoundStatus(round.id, status, completedAt);
  }

  const timestamp = new Date().toISOString();
  if (roundIds.length > 0) {
    broadcast({
      type: "chat.round.cancelled",
      conversationId,
      roundIds,
      timestamp,
    });
  }
  touchConversation(conversationId);
  return { roundIds, cancelledMessageIds };
}

export async function spawnPeerTargetReply(req: PeerRequest): Promise<void> {
  const participants = listConversationParticipants(req.conversationId);
  const target = participants.find((p) => p.id === req.toParticipantId);
  const from = participants.find((p) => p.id === req.fromParticipantId);
  if (!target || !from) throw new Error("成员不存在");

  let round = req.roundId ? getChatRoundById(req.roundId) : undefined;
  if (!round) {
    const now = new Date().toISOString();
    round = {
      id: nanoid(),
      conversationId: req.conversationId,
      mode: "direct",
      participantIds: [target.id],
      synthesize: false,
      status: "running",
      estimatedCalls: 1,
      createdAt: now,
    };
    insertChatRound(round);
    broadcast({
      type: "chat.round.started",
      conversationId: req.conversationId,
      roundId: round.id,
      mode: "direct",
      participantIds: [target.id],
      estimatedCalls: 1,
      timestamp: now,
    });
  }

  const fromMsg = listCoachMessages(req.conversationId, 40)
    .filter((m) => m.kind === "text" && m.speakerId === from.id)
    .reverse()
    .find((m) => m.kind === "text" && m.generationStatus === "completed");

  const recent = collectPeerReplies(req.conversationId, { limit: 8 })
    .map((s) => `${s.displayName}: ${s.text}`)
    .join("\n");

  const userMessage = [
    `圆桌成员「${from.displayName}」请求你回答以下问题：`,
    req.question,
    fromMsg && fromMsg.kind === "text"
      ? `\n发起方刚才的发言：\n${fromMsg.text}`
      : "",
    recent ? `\n近期已完成回答摘要：\n${recent}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    await runOneParticipantReply({
      round,
      participant: target,
      participants,
      userMessage,
      historyText: buildHistoryText(req.conversationId, {
        excludeRoundId: round.mode === "diverge" ? round.id : undefined,
      }),
    });
    if (getChatRoundById(round.id)?.status === "running") {
      updateChatRoundStatus(round.id, "completed", new Date().toISOString());
      broadcast({
        type: "chat.round.completed",
        conversationId: req.conversationId,
        roundId: round.id,
        status: "completed",
        timestamp: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.error("[roundtable] peer target reply failed", err);
    if (getChatRoundById(round.id)?.status === "running") {
      updateChatRoundStatus(round.id, "failed", new Date().toISOString());
    }
  }
}

async function notifyRequesterRejected(req: PeerRequest): Promise<void> {
  const note = saveRoundtableTextMessage({
    conversationId: req.conversationId,
    speakerType: "foreman",
    speakerId: "foreman",
    text: `用户已拒绝：「${req.fromDisplayName}」请求「${req.toDisplayName}」回答。问题：${req.question}`,
    roundId: req.roundId,
    generationStatus: "completed",
  });
  broadcast({
    type: "coach.message",
    conversationId: req.conversationId,
    message: note,
  });

  const participants = listConversationParticipants(req.conversationId);
  const from = participants.find((p) => p.id === req.fromParticipantId);
  if (!from) return;

  const now = new Date().toISOString();
  const round: ChatRound = {
    id: nanoid(),
    conversationId: req.conversationId,
    mode: "direct",
    participantIds: [from.id],
    synthesize: false,
    status: "running",
    estimatedCalls: 1,
    createdAt: now,
  };
  insertChatRound(round);
  try {
    await runOneParticipantReply({
      round,
      participant: from,
      participants,
      userMessage: [
        "你刚才通过 request_peer_reply 请求的对方回答已被用户拒绝。",
        `目标：${req.toDisplayName}`,
        `你的问题：${req.question}`,
        "请根据这一事实继续你的分析，不要假设对方已作答；可换角度自行推进或提出不依赖对方的建议。",
      ].join("\n"),
    });
    updateChatRoundStatus(round.id, "completed", new Date().toISOString());
    broadcast({
      type: "chat.round.completed",
      conversationId: req.conversationId,
      roundId: round.id,
      status: "completed",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[roundtable] reject notify failed", err);
    updateChatRoundStatus(round.id, "failed", new Date().toISOString());
  }
}

export async function rejectPeerRequest(requestId: string): Promise<PeerRequest> {
  const req = getPeerRequestById(requestId);
  if (!req) throw new Error("请求不存在");
  if (req.status !== "pending") throw new Error("请求已处理");

  const resolvedAt = new Date().toISOString();
  const next = updatePeerRequest(requestId, {
    status: "rejected",
    resolvedAt,
  })!;
  if (next.messageId) {
    const msg = updatePeerRequestMessage(next.messageId, next);
    broadcast({
      type: "chat.peer_request.resolved",
      conversationId: next.conversationId,
      request: next,
      message: msg ?? undefined,
      timestamp: resolvedAt,
    });
    if (msg) {
      broadcast({
        type: "coach.message",
        conversationId: next.conversationId,
        message: msg,
      });
    }
  }
  void notifyRequesterRejected(next).catch((err) =>
    console.error("[roundtable] reject notify", err),
  );
  return next;
}

export async function approvePeerRequest(
  requestId: string,
  opts?: { session?: boolean },
): Promise<PeerRequest> {
  const req = getPeerRequestById(requestId);
  if (!req) throw new Error("请求不存在");
  if (req.status !== "pending") throw new Error("请求已处理");

  if (opts?.session) {
    upsertPeerMentionGrant({
      conversationId: req.conversationId,
      fromParticipantId: req.fromParticipantId,
      toParticipantId: req.toParticipantId,
      createdAt: new Date().toISOString(),
    });
  }

  const resolvedAt = new Date().toISOString();
  const next = updatePeerRequest(requestId, {
    status: "approved",
    resolvedAt,
  })!;
  if (next.messageId) {
    const msg = updatePeerRequestMessage(next.messageId, next);
    broadcast({
      type: "chat.peer_request.resolved",
      conversationId: next.conversationId,
      request: next,
      message: msg ?? undefined,
      timestamp: resolvedAt,
    });
    if (msg) {
      broadcast({
        type: "coach.message",
        conversationId: next.conversationId,
        message: msg,
      });
    }
  }

  void spawnPeerTargetReply(next).catch((err) =>
    console.error("[roundtable] approve peer reply failed", err),
  );
  return next;
}

export async function retryRoundtableReply(messageId: number): Promise<void> {
  const msg = getCoachMessageById(messageId);
  if (!msg || msg.kind !== "text" || !msg.roundId || !msg.speakerId) {
    throw new Error("消息不可重试");
  }
  const round = getChatRoundById(msg.roundId);
  if (!round) throw new Error("轮次不存在");
  const participants = listConversationParticipants(round.conversationId);
  const participant = participants.find((p) => p.id === msg.speakerId);
  if (!participant) throw new Error("成员不存在");

  const userMessage =
    round.sourceMessageId != null
      ? (() => {
          const m = getCoachMessageById(round.sourceMessageId);
          return m && m.kind === "text" ? m.text : "";
        })()
      : "";

  await runOneParticipantReply({
    round,
    participant,
    participants,
    userMessage: userMessage || "（请基于上下文继续）",
    pendingMessageId: messageId,
    historyText: historyTextForReplyMode(
      round.mode,
      buildHistoryText(round.conversationId, {
        excludeRoundId: round.mode === "diverge" ? round.id : undefined,
      }),
    ),
  });
}

export async function synthesizeExistingRound(
  roundId: string,
): Promise<RoundSynthesisPayload> {
  const round = getChatRoundById(roundId);
  if (!round) throw new Error("轮次不存在");
  const records = listCoachMessages(round.conversationId, 120);
  const replies = records.filter(
    (r) =>
      r.kind === "text" &&
      r.roundId === roundId &&
      r.speakerType !== "user" &&
      r.generationStatus === "completed" &&
      r.text.trim(),
  );
  const userMessage =
    records.find((r) => r.kind === "text" && r.id === round.sourceMessageId)?.kind ===
    "text"
      ? (records.find((r) => r.kind === "text" && r.id === round.sourceMessageId) as {
          text: string;
        }).text
      : "（圆桌讨论）";

  const participants = listConversationParticipants(round.conversationId);
  const nameById = new Map(participants.map((p) => [p.id, p.displayName]));

  const synthesis = await synthesizeRoundtable({
    settings: loadSettings(),
    roundId,
    userMessage,
    replies: replies
      .filter((r): r is Extract<typeof r, { kind: "text" }> => r.kind === "text")
      .map((r) => ({
        displayName: nameById.get(r.speakerId ?? "") ?? r.speakerId ?? "成员",
        text: r.text,
      })),
  });
  const synMsg = saveRoundSynthesisMessage(round.conversationId, synthesis);
  broadcast({
    type: "coach.message",
    conversationId: round.conversationId,
    message: synMsg,
  });
  return synthesis;
}

/** 基于圆桌总结走工头 forceRefine 生成任务单预览 */
export async function roundToWorkOrder(roundId: string): Promise<{
  message: string;
  refined?: unknown;
}> {
  const round = getChatRoundById(roundId);
  if (!round) throw new Error("轮次不存在");
  const records = listCoachMessages(round.conversationId, 120);
  const synthesis = [...records]
    .reverse()
    .find((r) => r.kind === "round_synthesis" && r.synthesis.roundId === roundId);
  if (!synthesis || synthesis.kind !== "round_synthesis") {
    throw new Error("请先生成工头总结再转任务单");
  }

  const brief = [
    "请根据以下圆桌共识整理成可派单的工单预览（propose_work_order / refine）。",
    `共识：${synthesis.synthesis.consensus}`,
    `分歧：${synthesis.synthesis.disagreements}`,
    `推荐方案：${synthesis.synthesis.recommendation}`,
    `下一步：${synthesis.synthesis.nextSteps}`,
  ].join("\n");

  const ctx = await buildCoachChatContextAsync(round.conversationId);
  const settings = loadSettings();
  const reply = await coachChatReply(brief, ctx, settings, [], undefined, [], {
    forceRefine: true,
  });

  if (reply.refined) {
    return { message: reply.message, refined: reply.refined };
  }
  return { message: reply.message };
}
