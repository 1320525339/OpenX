import { Hono } from "hono";
import { nanoid } from "nanoid";
import {
  CreateAiProfileSchema,
  CreateChatRoundSchema,
  UpdateAiProfileSchema,
  UpsertConversationParticipantsSchema,
  ROUNDTABLE_FOREMAN_PROFILE_ID,
  type ConversationParticipant,
} from "@openx/shared";
import {
  getConversationById,
  saveCoachRefinedMessage,
  updateConversation,
} from "../db.js";
import {
  deleteAiProfile,
  getAiProfileById,
  getChatRoundById,
  insertAiProfile,
  listAiProfiles,
  listConversationParticipants,
  replaceConversationParticipants,
  seedRoundtableParticipants,
  updateAiProfile,
} from "../db/roundtable-repo.js";
import { broadcast } from "../sse.js";
import {
  cancelRoundtableReply,
  retryRoundtableReply,
  roundToWorkOrder,
  runChatRound,
  synthesizeExistingRound,
  cancelActiveRounds,
  rejectPeerRequest,
  approvePeerRequest,
} from "../roundtable-service.js";
import type { RefinedGoal } from "@openx/shared";

export const roundtableRoutes = new Hono();

roundtableRoutes.get("/ai-profiles", (c) => {
  return c.json({ profiles: listAiProfiles() });
});

roundtableRoutes.post("/ai-profiles", async (c) => {
  const input = CreateAiProfileSchema.parse(await c.req.json());
  const profile = insertAiProfile(input);
  return c.json({ profile }, 201);
});

roundtableRoutes.patch("/ai-profiles/:id", async (c) => {
  const id = c.req.param("id");
  const patch = UpdateAiProfileSchema.parse(await c.req.json());
  const profile = updateAiProfile(id, patch);
  if (!profile) return c.json({ error: "Not found" }, 404);
  return c.json({ profile });
});

roundtableRoutes.delete("/ai-profiles/:id", (c) => {
  const id = c.req.param("id");
  if (id === ROUNDTABLE_FOREMAN_PROFILE_ID) {
    return c.json({ error: "工头助手不可删除" }, 403);
  }
  const ok = deleteAiProfile(id);
  if (!ok) return c.json({ error: "无法删除（不存在或内置）" }, 400);
  return c.json({ ok: true });
});

roundtableRoutes.get("/conversations/:id/participants", (c) => {
  const conversation = getConversationById(c.req.param("id"));
  if (!conversation) return c.json({ error: "Not found" }, 404);
  return c.json({ participants: listConversationParticipants(conversation.id) });
});

roundtableRoutes.put("/conversations/:id/participants", async (c) => {
  const conversation = getConversationById(c.req.param("id"));
  if (!conversation) return c.json({ error: "Not found" }, 404);
  const body = UpsertConversationParticipantsSchema.parse(await c.req.json());
  const next: ConversationParticipant[] = [];
  let order = 0;
  let hasForeman = false;
  for (const item of body.participants) {
    const profile = getAiProfileById(item.profileId);
    if (!profile) {
      return c.json({ error: `未知画像：${item.profileId}` }, 400);
    }
    if (profile.id === ROUNDTABLE_FOREMAN_PROFILE_ID) hasForeman = true;
    next.push({
      id: item.id ?? nanoid(),
      conversationId: conversation.id,
      profileId: profile.id,
      displayName: item.displayName?.trim() || profile.name,
      modelRef: item.modelRef ?? profile.modelRef,
      enabled: item.enabled ?? true,
      capabilityIds: item.capabilityIds ?? [...profile.defaultCapabilityIds],
      sortOrder: item.sortOrder ?? order,
    });
    order += 1;
  }
  if (!hasForeman) {
    const foreman = getAiProfileById(ROUNDTABLE_FOREMAN_PROFILE_ID);
    if (foreman) {
      next.unshift({
        id: nanoid(),
        conversationId: conversation.id,
        profileId: foreman.id,
        displayName: foreman.name,
        modelRef: foreman.modelRef,
        enabled: true,
        capabilityIds: [...foreman.defaultCapabilityIds],
        sortOrder: -1,
      });
    }
  }
  const participants = replaceConversationParticipants(conversation.id, next);
  return c.json({ participants });
});

roundtableRoutes.post("/conversations/:id/chat/rounds", async (c) => {
  const conversation = getConversationById(c.req.param("id"));
  if (!conversation) return c.json({ error: "Not found" }, 404);
  if (conversation.mode !== "roundtable") {
    return c.json({ error: "仅圆桌会话可使用此接口" }, 400);
  }
  try {
    const input = CreateChatRoundSchema.parse(await c.req.json());
    if (listConversationParticipants(conversation.id).length === 0) {
      seedRoundtableParticipants(conversation.id, []);
    }
    const result = await runChatRound(conversation.id, input);
    return c.json(result, 202);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 400);
  }
});

roundtableRoutes.post("/rounds/:roundId/synthesize", async (c) => {
  try {
    const synthesis = await synthesizeExistingRound(c.req.param("roundId"));
    return c.json({ synthesis });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 400);
  }
});

roundtableRoutes.post("/rounds/:roundId/to-work-order", async (c) => {
  try {
    const round = getChatRoundById(c.req.param("roundId"));
    if (!round) return c.json({ error: "轮次不存在" }, 404);
    const result = await roundToWorkOrder(round.id);
    if (result.refined) {
      const refined = result.refined as RefinedGoal;
      const refinedMsg = saveCoachRefinedMessage(round.conversationId, refined);
      broadcast({
        type: "coach.message",
        conversationId: round.conversationId,
        message: refinedMsg,
      });
      broadcast({
        type: "coach.reply",
        conversationId: round.conversationId,
        message: result.message,
        timestamp: new Date().toISOString(),
        refined,
        intent: "task",
      });
      return c.json({ message: result.message, refined, refinedMessage: refinedMsg });
    }
    broadcast({
      type: "coach.reply",
      conversationId: round.conversationId,
      message: result.message,
      timestamp: new Date().toISOString(),
    });
    return c.json({ message: result.message });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 400);
  }
});

roundtableRoutes.post("/replies/:messageId/retry", async (c) => {
  try {
    await retryRoundtableReply(Number(c.req.param("messageId")));
    return c.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 400);
  }
});

roundtableRoutes.post("/replies/:messageId/cancel", (c) => {
  const ok = cancelRoundtableReply(Number(c.req.param("messageId")));
  if (!ok) return c.json({ error: "无可取消的生成" }, 404);
  return c.json({ ok: true });
});

roundtableRoutes.post("/conversations/:id/rounds/cancel-active", (c) => {
  const conversation = getConversationById(c.req.param("id"));
  if (!conversation) return c.json({ error: "Not found" }, 404);
  const result = cancelActiveRounds(conversation.id);
  return c.json({ ok: true, ...result });
});

roundtableRoutes.post("/peer-requests/:id/reject", async (c) => {
  try {
    const request = await rejectPeerRequest(c.req.param("id"));
    return c.json({ request });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 400);
  }
});

roundtableRoutes.post("/peer-requests/:id/approve", async (c) => {
  try {
    const request = await approvePeerRequest(c.req.param("id"));
    return c.json({ request });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 400);
  }
});

roundtableRoutes.post("/peer-requests/:id/approve-session", async (c) => {
  try {
    const request = await approvePeerRequest(c.req.param("id"), { session: true });
    return c.json({ request });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 400);
  }
});

/** 切换会话为圆桌并播种默认阵容 */
roundtableRoutes.post("/conversations/:id/enable", async (c) => {
  const conversation = getConversationById(c.req.param("id"));
  if (!conversation) return c.json({ error: "Not found" }, 404);
  conversation.mode = "roundtable";
  conversation.updatedAt = new Date().toISOString();
  updateConversation(conversation);
  let participants = listConversationParticipants(conversation.id);
  if (participants.length === 0) {
    const body = (await c.req.json().catch(() => ({}))) as {
      participantProfileIds?: string[];
    };
    participants = seedRoundtableParticipants(
      conversation.id,
      body.participantProfileIds ?? [],
    );
  }
  return c.json({ conversation, participants });
});
