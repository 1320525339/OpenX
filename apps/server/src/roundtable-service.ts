import { nanoid } from "nanoid";
import {
  resolveRoundParticipants,
  generateParticipantReply,
  synthesizeRoundtable,
  describeLlmFailure,
  isAbortError,
  coachChatReply,
  type ParticipantToolHandlers,
  type RoundtableAttendee,
  type RoundtableComposerContextBlock,
  type PeerReplySnippet,
} from "@openx/coach";
import type {
  ChatRound,
  ChatRoundComposerContext,
  CoachMessageRecord,
  ConversationParticipant,
  CreateChatRoundInput,
  PeerRequest,
  RefinedGoal,
  RoundSynthesisPayload,
} from "@openx/shared";
import {
  COACH_MCP_CATALOG,
  DEFAULT_EXECUTION_AGENT_ID,
  ROUNDTABLE_FOREMAN_PROFILE_ID,
  pickChatRoundComposerContext,
} from "@openx/shared";
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
  listPendingPeerRequests,
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
import { listSkillCatalog, loadSkillManifest } from "./skills-service.js";
import { backfillRefinedGoal } from "./refined-backfill.js";

const abortByMessageId = new Map<number, AbortController>();
const abortByRoundId = new Map<string, Set<number>>();

/** 同会话未结束 peer 追问链的最大跳数（计 approved / auto_approved） */
export const MAX_PEER_CHAIN_HOPS = 5;

type PeerChainState = {
  hopCount: number;
  /** 当前链已 conclude 或用户停止 */
  closed: boolean;
};

const peerChains = new Map<string, PeerChainState>();

function getOrCreatePeerChain(conversationId: string): PeerChainState {
  let state = peerChains.get(conversationId);
  if (!state) {
    state = { hopCount: 0, closed: false };
    peerChains.set(conversationId, state);
  }
  return state;
}

/** 测试用：清空进程内 peer 链状态 */
export function resetPeerChainStateForTests(): void {
  peerChains.clear();
  clearDeferredPeerPublishesForTests();
}

export function isPeerChainClosed(conversationId: string): boolean {
  return peerChains.get(conversationId)?.closed === true;
}

/** 用户开启新一轮圆桌发言时，允许重新开始追问链 */
export function openPeerChainForNewRound(conversationId: string): void {
  peerChains.set(conversationId, { hopCount: 0, closed: false });
}

/** 将 CreateChatRound / round 快照解析为席位提示词 Context 块 */
export async function resolveRoundtableComposerContextBlock(
  conversationId: string,
  message: string,
  composer?: ChatRoundComposerContext | null,
): Promise<RoundtableComposerContextBlock | undefined> {
  if (!composer) return undefined;
  const skillIds = composer.skillIds?.filter((id) => id.trim()) ?? [];
  const mcpIds = composer.mcpIds?.filter((id) => id.trim()) ?? [];
  const hasKnowledge = composer.knowledge != null;
  const hasPermission = composer.permissionMode != null;
  if (
    skillIds.length === 0 &&
    mcpIds.length === 0 &&
    !hasKnowledge &&
    !hasPermission
  ) {
    return undefined;
  }

  let enabledSkills: RoundtableComposerContextBlock["enabledSkills"];
  if (skillIds.length > 0) {
    const catalog = listSkillCatalog(loadSkillManifest());
    enabledSkills = catalog
      .filter((s) => skillIds.includes(s.id))
      .map((s) => ({ id: s.id, name: s.name, desc: s.desc }));
  }

  let enabledMcps: RoundtableComposerContextBlock["enabledMcps"];
  if (mcpIds.length > 0) {
    enabledMcps = COACH_MCP_CATALOG.filter((m) => mcpIds.includes(m.id)).map(
      (m) => ({ id: m.id, name: m.name }),
    );
  }

  let knowledgeSummary: string | undefined;
  if (hasKnowledge || skillIds.length > 0 || mcpIds.length > 0) {
    const ctx = await buildCoachChatContextAsync(conversationId, undefined, {
      message,
      mcpIds: mcpIds.length > 0 ? mcpIds : undefined,
      knowledgeSelection: composer.knowledge,
      permissionMode: composer.permissionMode,
    });
    knowledgeSummary =
      ctx.knowledgeSelectionSummary?.trim() ||
      ctx.projectMemory?.trim() ||
      undefined;
  }

  return {
    ...(enabledSkills?.length ? { enabledSkills } : {}),
    ...(enabledMcps?.length ? { enabledMcps } : {}),
    ...(knowledgeSummary ? { knowledgeSummary } : {}),
    ...(composer.permissionMode
      ? { permissionMode: composer.permissionMode }
      : {}),
  };
}

/**
 * 治愈孤儿「回复中」气泡：所属 round 已非 running（或无 roundId）。
 * 仍标记 running 的轮次留给 abortActiveRounds / 新用户发言去收束，避免与刚创建的 pending 竞态。
 */
export function healOrphanStreamingMessages(conversationId: string): number[] {
  const runningIds = new Set(
    listRunningChatRounds(conversationId).map((r) => r.id),
  );
  const healed: number[] = [];
  for (const r of listCoachMessages(conversationId, 200)) {
    if (r.kind !== "text" || r.generationStatus !== "streaming") continue;
    if (r.roundId && runningIds.has(r.roundId)) continue;
    if (markStreamingMessageCancelled(r.id)) {
      healed.push(r.id);
    }
  }
  return healed;
}

/** 用户发送新消息前：中止残留生成、取消 pending peer、打开新追问链 */
function prepareConversationForNewUserTurn(conversationId: string): void {
  abortActiveRoundsImpl(conversationId);
  cancelPendingPeerRequests(conversationId);
  openPeerChainForNewRound(conversationId);
}

/** 新追问前：链已关闭则拒绝；超深度则拒绝 */
function preparePeerChainForRequest(conversationId: string): {
  ok: boolean;
  message?: string;
} {
  const state = getOrCreatePeerChain(conversationId);
  if (state.closed) {
    return {
      ok: false,
      message:
        "追问链已结束。请等待用户发送新消息开启新一轮后再追问，或请用户先停止后重开讨论。",
    };
  }
  if (state.hopCount >= MAX_PEER_CHAIN_HOPS) {
    return {
      ok: false,
      message: `追问链已达上限（${MAX_PEER_CHAIN_HOPS} 跳）。请调用 conclude_discussion 收束，或请用户停止全部回答后再开新讨论。`,
    };
  }
  return { ok: true };
}

function recordPeerHop(conversationId: string): void {
  const state = getOrCreatePeerChain(conversationId);
  state.hopCount += 1;
}

function cancelPendingPeerRequests(conversationId: string): void {
  const pending = listPendingPeerRequests(conversationId);
  const resolvedAt = new Date().toISOString();
  for (const req of pending) {
    const next = updatePeerRequest(req.id, {
      status: "cancelled",
      resolvedAt,
    });
    if (!next?.messageId) continue;
    const msg = updatePeerRequestMessage(next.messageId, next);
    broadcast({
      type: "chat.peer_request.resolved",
      conversationId,
      request: next,
      message: msg ?? undefined,
      timestamp: resolvedAt,
    });
    if (msg) {
      broadcast({
        type: "coach.message",
        conversationId,
        message: msg,
      });
    }
  }
}

function markStreamingMessageCancelled(messageId: number): boolean {
  const msg = getCoachMessageById(messageId);
  if (!msg || msg.kind !== "text") return false;
  if (msg.generationStatus !== "streaming") return false;

  const text = (msg.text || "").trim() || "（已取消）";
  updateCoachMessageGeneration(messageId, {
    text,
    generationStatus: "cancelled",
  });
  const updated = getCoachMessageById(messageId);
  if (updated) {
    broadcast({
      type: "coach.message",
      conversationId: updated.conversationId,
      message: updated,
    });
  }
  broadcast({
    type: "chat.reply.failed",
    conversationId: msg.conversationId,
    roundId: msg.roundId ?? "",
    messageId,
    speakerId: msg.speakerId ?? "",
    streamId: "",
    error: "已取消",
    timestamp: new Date().toISOString(),
  });
  return true;
}

function abortActiveRoundsImpl(conversationId: string): {
  roundIds: string[];
  cancelledMessageIds: number[];
} {
  const rounds = listRunningChatRounds(conversationId);
  const cancelledMessageIds: number[] = [];
  const roundIds: string[] = [];
  const seen = new Set<number>();

  for (const round of rounds) {
    roundIds.push(round.id);
    const ids = abortByRoundId.get(round.id);
    if (ids) {
      for (const messageId of [...ids]) {
        const controller = abortByMessageId.get(messageId);
        controller?.abort();
        if (!seen.has(messageId)) {
          seen.add(messageId);
          cancelledMessageIds.push(messageId);
        }
        markStreamingMessageCancelled(messageId);
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

  // 兜底：无 running round / 控制器丢失时，仍清掉残留 streaming
  for (const r of listCoachMessages(conversationId, 120)) {
    if (r.kind !== "text" || r.generationStatus !== "streaming") continue;
    abortByMessageId.get(r.id)?.abort();
    if (markStreamingMessageCancelled(r.id) && !seen.has(r.id)) {
      seen.add(r.id);
      cancelledMessageIds.push(r.id);
    }
  }

  const timestamp = new Date().toISOString();
  if (roundIds.length > 0 || cancelledMessageIds.length > 0) {
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

/** 结束当前 peer 追问链：关闭状态、取消 pending、中止进行中生成 */
export function endPeerChain(
  conversationId: string,
  _reason: "concluded" | "user_stop",
): { roundIds: string[]; cancelledMessageIds: number[] } {
  const state = getOrCreatePeerChain(conversationId);
  state.closed = true;
  cancelPendingPeerRequests(conversationId);
  return abortActiveRoundsImpl(conversationId);
}

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
      modelRef: p.modelRef,
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
      // 生成未结束前不广播确认卡，等正文完成后再弹出
      deferPublish: true,
    }),
    concludeDiscussion: (input) =>
      handleConcludeDiscussion({
        conversationId: ctx.conversationId,
        roundId: ctx.roundId,
        summary: input.summary,
        goalMet: input.goalMet,
        nextSteps: input.nextSteps,
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
  /** 为 true 时先落库不广播，等发言正文完成后再 publish（避免确认卡早于气泡） */
  deferPublish?: boolean;
}): { ok: boolean; message: string; requestId?: string; autoApproved?: boolean } {
  const chainGate = preparePeerChainForRequest(input.conversationId);
  if (!chainGate.ok) {
    return { ok: false, message: chainGate.message ?? "追问链不可用。" };
  }

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

  if (auto) {
    recordPeerHop(input.conversationId);
  }

  if (input.deferPublish) {
    insertPeerRequest(req);
    enqueueDeferredPeerPublish(input.roundId, req);
    if (auto) {
      return {
        ok: true,
        requestId: req.id,
        autoApproved: true,
        message: `已自动获准：${target.displayName} 将在你本轮发言展示后开始回答。请勿臆造其答案。`,
      };
    }
    return {
      ok: true,
      requestId: req.id,
      message: `已记录对「${target.displayName}」的回答请求；将在你本轮发言展示后弹出用户确认。请勿臆造对方答案。`,
    };
  }

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
      message: `已自动获准：${target.displayName} 正在回答。请勿臆造其答案；答完后你会再获得反馈轮，可续问或 conclude_discussion。`,
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

/** roundId → 待在发言完成后发布的 peer 请求 */
const deferredPeerByRound = new Map<string, PeerRequest[]>();

function enqueueDeferredPeerPublish(roundId: string, req: PeerRequest): void {
  const list = deferredPeerByRound.get(roundId) ?? [];
  list.push(req);
  deferredPeerByRound.set(roundId, list);
}

/** 将延迟的 peer 确认卡发布到线程（在发起方正文完成之后调用） */
export function flushDeferredPeerPublishes(roundId: string): void {
  const list = deferredPeerByRound.get(roundId);
  if (!list?.length) {
    deferredPeerByRound.delete(roundId);
    return;
  }
  deferredPeerByRound.delete(roundId);

  for (const req of list) {
    const latest = getPeerRequestById(req.id) ?? req;
    // 生成期间用户若已处理则跳过发布
    if (
      latest.status !== "pending" &&
      latest.status !== "auto_approved"
    ) {
      continue;
    }
    if (latest.messageId) {
      continue;
    }

    const msg = savePeerRequestMessage(latest.conversationId, latest);
    const withMsg = updatePeerRequest(latest.id, { messageId: msg.id }) ?? {
      ...latest,
      messageId: msg.id,
    };
    const now = new Date().toISOString();

    if (withMsg.status === "auto_approved") {
      broadcast({
        type: "chat.peer_request.created",
        conversationId: withMsg.conversationId,
        request: withMsg,
        message: msg,
        timestamp: now,
      });
      broadcast({
        type: "chat.peer_request.resolved",
        conversationId: withMsg.conversationId,
        request: withMsg,
        message: msg,
        timestamp: now,
      });
      broadcast({
        type: "coach.message",
        conversationId: withMsg.conversationId,
        message: msg,
      });
      void spawnPeerTargetReply(withMsg).catch((err) =>
        console.error("[roundtable] deferred auto peer reply failed", err),
      );
      continue;
    }

    broadcast({
      type: "chat.peer_request.created",
      conversationId: withMsg.conversationId,
      request: withMsg,
      message: msg,
      timestamp: now,
    });
    broadcast({
      type: "coach.message",
      conversationId: withMsg.conversationId,
      message: msg,
    });
  }
}

export function clearDeferredPeerPublishesForTests(): void {
  deferredPeerByRound.clear();
}

export function handleConcludeDiscussion(input: {
  conversationId: string;
  roundId: string;
  summary: string;
  goalMet: boolean;
  nextSteps?: string;
}): { ok: boolean; message: string } {
  const summary = input.summary.trim();
  if (!summary) {
    return { ok: false, message: "总结不能为空。" };
  }

  const synthesis: RoundSynthesisPayload = {
    roundId: input.roundId,
    consensus: summary,
    disagreements: "追问链收束",
    recommendation: input.goalMet ? "讨论目标已达成" : "讨论目标尚未完全达成，见总结与下一步",
    nextSteps: (input.nextSteps ?? "").trim() || "（无）",
  };
  const synMsg = saveRoundSynthesisMessage(input.conversationId, synthesis);
  broadcast({
    type: "coach.message",
    conversationId: input.conversationId,
    message: synMsg,
  });
  endPeerChain(input.conversationId, "concluded");
  return {
    ok: true,
    message: "追问链已结束，勿再 request_peer_reply。总结已写入线程。",
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
  composerContext?: RoundtableComposerContextBlock;
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
      composerContext: opts.composerContext,
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
    const current = getCoachMessageById(messageId);
    const alreadyCancelled =
      current?.kind === "text" && current.generationStatus === "cancelled";
    const cancelled =
      alreadyCancelled || controller.signal.aborted || isAbortError(err);

    if (cancelled) {
      // 主动停止 / 新发言收束旧流：保持「已取消」，勿覆盖成英文 AbortError 失败文案
      if (!alreadyCancelled) {
        updateCoachMessageGeneration(messageId, {
          text: "（已取消）",
          generationStatus: "cancelled",
          generationMeta: {
            modelRef: opts.participant.modelRef,
            profileId: opts.participant.profileId,
            error: "已取消",
          },
        });
      }
      broadcast({
        type: "chat.reply.failed",
        conversationId: opts.round.conversationId,
        roundId: opts.round.id,
        messageId,
        speakerId: opts.participant.id,
        streamId,
        error: "已取消",
        timestamp: new Date().toISOString(),
      });
      const cancelledMsg = getCoachMessageById(messageId);
      if (cancelledMsg) {
        broadcast({
          type: "coach.message",
          conversationId: opts.round.conversationId,
          message: cancelledMsg,
        });
      }
      return {
        participant: opts.participant,
        text: "（已取消）",
        messageId,
      };
    }

    const error = describeLlmFailure(err);
    updateCoachMessageGeneration(messageId, {
      text: `（失败）${error}`,
      generationStatus: "failed",
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
    // 正文（成功/失败）已推送后再弹出 peer 确认卡，避免卡夹在「回复中」之前
    flushDeferredPeerPublishes(opts.round.id);
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

  // 先收束上一轮残留「回复中」，再开新追问链，避免旧气泡压在新用户消息之上
  prepareConversationForNewUserTurn(conversationId);

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
  const composerContext = pickChatRoundComposerContext(input);
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
    composerContext,
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

  const composerBlock = await resolveRoundtableComposerContextBlock(
    round.conversationId,
    userMessage,
    round.composerContext ?? pickChatRoundComposerContext(input),
  );

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
        composerContext: composerBlock,
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
  if (controller) {
    controller.abort();
  }
  const marked = markStreamingMessageCancelled(messageId);
  return Boolean(controller) || marked;
}

/** 停止该会话所有 running 轮次的进行中生成（含 peer 追问链） */
export function cancelActiveRounds(conversationId: string): {
  roundIds: string[];
  cancelledMessageIds: number[];
} {
  return endPeerChain(conversationId, "user_stop");
}

export async function spawnPeerTargetReply(req: PeerRequest): Promise<void> {
  if (isPeerChainClosed(req.conversationId)) return;

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

  if (isPeerChainClosed(req.conversationId)) return;

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
    const result = await runOneParticipantReply({
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
    if (isPeerChainClosed(req.conversationId)) return;
    try {
      await notifyRequesterWithPeerAnswer(req, result.text);
    } catch (err) {
      console.error("[roundtable] requester feedback failed", err);
    }
  } catch (err) {
    console.error("[roundtable] peer target reply failed", err);
    if (getChatRoundById(round.id)?.status === "running") {
      updateChatRoundStatus(round.id, "failed", new Date().toISOString());
    }
  }
}

const MAX_PEER_ANSWER_CHARS = 4000;

function truncatePeerAnswer(text: string): string {
  if (text.length <= MAX_PEER_ANSWER_CHARS) return text;
  return `${text.slice(0, MAX_PEER_ANSWER_CHARS)}\n…（已截断）`;
}

/** 对方答完后，再拉起发起方基于该回答做反馈（发起人自主续问或收束）。 */
async function notifyRequesterWithPeerAnswer(
  req: PeerRequest,
  peerAnswerText: string,
): Promise<void> {
  if (isPeerChainClosed(req.conversationId)) return;

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
  broadcast({
    type: "chat.round.started",
    conversationId: req.conversationId,
    roundId: round.id,
    mode: "direct",
    participantIds: [from.id],
    estimatedCalls: 1,
    timestamp: now,
  });

  if (isPeerChainClosed(req.conversationId)) return;

  try {
    await runOneParticipantReply({
      round,
      participant: from,
      participants,
      userMessage: [
        "你刚才通过 request_peer_reply 请求的对方已完成回答。",
        `目标：${req.toDisplayName}`,
        `你的问题：${req.question}`,
        "对方回答：",
        truncatePeerAnswer(peerAnswerText),
        "请自主决定下一步：",
        "- 若信息仍不足：可再调用 request_peer_reply 追问（勿臆造未发生的回答）；",
        "- 若讨论目标已达成或信息已足够：必须调用 conclude_discussion 给出总结并结束追问链；",
        "- 也可先陈述采纳/分歧点，再在同轮工具中 conclude 或续问。",
      ].join("\n"),
      historyText: buildHistoryText(req.conversationId),
    });
    if (isPeerChainClosed(req.conversationId)) {
      if (getChatRoundById(round.id)?.status === "running") {
        updateChatRoundStatus(round.id, "cancelled", new Date().toISOString());
      }
      return;
    }
    updateChatRoundStatus(round.id, "completed", new Date().toISOString());
    broadcast({
      type: "chat.round.completed",
      conversationId: req.conversationId,
      roundId: round.id,
      status: "completed",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[roundtable] peer answer notify failed", err);
    updateChatRoundStatus(round.id, "failed", new Date().toISOString());
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

  if (isPeerChainClosed(req.conversationId)) {
    throw new Error("追问链已结束，无法批准");
  }
  const state = getOrCreatePeerChain(req.conversationId);
  if (state.hopCount >= MAX_PEER_CHAIN_HOPS) {
    throw new Error(
      `追问链已达上限（${MAX_PEER_CHAIN_HOPS} 跳），请先 conclude 或停止后再开新讨论`,
    );
  }

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
  recordPeerHop(req.conversationId);
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

  // 在线程末尾新建气泡，禁止原地把旧失败消息改回 streaming（否则会插在后续对话上方）
  if (round.status !== "running") {
    updateChatRoundStatus(round.id, "running");
  }
  await runOneParticipantReply({
    round,
    participant,
    participants,
    userMessage: userMessage || "（请基于上下文继续）",
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
  refined?: RefinedGoal;
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

  const composer = round.composerContext;
  const settings = loadSettings();
  const ctx = await buildCoachChatContextAsync(round.conversationId, undefined, {
    message: brief,
    mcpIds: composer?.mcpIds,
    knowledgeSelection: composer?.knowledge,
    permissionMode: composer?.permissionMode,
  });
  if (composer?.skillIds?.length) {
    const catalog = listSkillCatalog(loadSkillManifest());
    ctx.enabledSkills = catalog
      .filter((s) => composer.skillIds!.includes(s.id))
      .map((s) => ({ id: s.id, name: s.name, desc: s.desc }));
  }

  const reply = await coachChatReply(brief, ctx, settings, [], undefined, [], {
    forceRefine: true,
  });

  if (reply.refined) {
    const refined = await backfillRefinedGoal(reply.refined, {
      settings,
      userDraft: brief,
      dispatch: {
        agentId: reply.refined.agentId ?? DEFAULT_EXECUTION_AGENT_ID,
        mcpIds: composer?.mcpIds,
        skillIds: composer?.skillIds,
      },
    });
    return { message: reply.message, refined };
  }
  return { message: reply.message };
}
