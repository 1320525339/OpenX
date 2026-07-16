import { nanoid } from "nanoid";
import type {
  AiCapabilityId,
  AiProfile,
  ChatRound,
  ChatRoundMode,
  ChatRoundOutputGoal,
  ChatRoundLength,
  ChatRoundStatus,
  ConversationParticipant,
  CreateAiProfileInput,
  PeerMentionGrant,
  PeerRequest,
  PeerRequestStatus,
  UpdateAiProfileInput,
} from "@openx/shared";
import {
  AiCapabilityIdSchema,
  BUILTIN_AI_PROFILES,
  ROUNDTABLE_FOREMAN_PROFILE_ID,
} from "@openx/shared";
import { getDb } from "./connection.js";

type AiProfileRow = {
  id: string;
  name: string;
  avatar: string | null;
  description: string;
  role_prompt: string;
  model_ref: string;
  default_capability_ids_json: string;
  builtin: number;
  created_at: string;
  updated_at: string;
};

type ParticipantRow = {
  id: string;
  conversation_id: string;
  profile_id: string;
  display_name: string;
  model_ref: string;
  enabled: number;
  capability_ids_json: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type ChatRoundRow = {
  id: string;
  conversation_id: string;
  source_message_id: number | null;
  mode: string;
  participant_ids_json: string;
  synthesize: number;
  status: string;
  estimated_calls: number;
  output_goal: string | null;
  length: string | null;
  created_at: string;
  completed_at: string | null;
};

function parseCapabilityIds(raw: string): AiCapabilityId[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((id) => AiCapabilityIdSchema.safeParse(id))
      .filter((r) => r.success)
      .map((r) => r.data);
  } catch {
    return [];
  }
}

function rowToProfile(row: AiProfileRow): AiProfile {
  return {
    id: row.id,
    name: row.name,
    avatar: row.avatar ?? undefined,
    description: row.description,
    rolePrompt: row.role_prompt,
    modelRef: row.model_ref,
    defaultCapabilityIds: parseCapabilityIds(row.default_capability_ids_json),
    builtin: row.builtin === 1,
  };
}

function rowToParticipant(row: ParticipantRow): ConversationParticipant {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    profileId: row.profile_id,
    displayName: row.display_name,
    modelRef: row.model_ref,
    enabled: row.enabled === 1,
    capabilityIds: parseCapabilityIds(row.capability_ids_json),
    sortOrder: row.sort_order,
  };
}

function rowToRound(row: ChatRoundRow): ChatRound {
  let participantIds: string[] = [];
  try {
    const parsed = JSON.parse(row.participant_ids_json) as unknown;
    if (Array.isArray(parsed)) {
      participantIds = parsed.filter((x): x is string => typeof x === "string");
    }
  } catch {
    participantIds = [];
  }
  return {
    id: row.id,
    conversationId: row.conversation_id,
    sourceMessageId: row.source_message_id ?? undefined,
    mode: row.mode as ChatRoundMode,
    participantIds,
    synthesize: row.synthesize === 1,
    status: row.status as ChatRoundStatus,
    estimatedCalls: row.estimated_calls,
    outputGoal: (row.output_goal as ChatRoundOutputGoal | null) ?? undefined,
    length: (row.length as ChatRoundLength | null) ?? undefined,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
  };
}

/** 确保内置 AI 成员种子写入 ai_profiles */
export function ensureBuiltinAiProfiles(): void {
  const database = getDb();
  const now = new Date().toISOString();
  const insert = database.prepare(
    `INSERT INTO ai_profiles (
      id, name, avatar, description, role_prompt, model_ref,
      default_capability_ids_json, builtin, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      avatar = excluded.avatar,
      description = excluded.description,
      role_prompt = excluded.role_prompt,
      default_capability_ids_json = excluded.default_capability_ids_json,
      builtin = 1,
      updated_at = excluded.updated_at
    WHERE ai_profiles.builtin = 1`,
  );
  const tx = database.transaction(() => {
    for (const p of BUILTIN_AI_PROFILES) {
      insert.run(
        p.id,
        p.name,
        p.avatar ?? null,
        p.description,
        p.rolePrompt,
        p.modelRef,
        JSON.stringify(p.defaultCapabilityIds),
        now,
        now,
      );
    }
  });
  tx();
}

export function listAiProfiles(): AiProfile[] {
  ensureBuiltinAiProfiles();
  return getDb()
    .prepare(
      `SELECT * FROM ai_profiles
       ORDER BY builtin DESC, name ASC`,
    )
    .all()
    .map((r) => rowToProfile(r as AiProfileRow));
}

export function getAiProfileById(id: string): AiProfile | undefined {
  ensureBuiltinAiProfiles();
  const row = getDb()
    .prepare("SELECT * FROM ai_profiles WHERE id = ?")
    .get(id) as AiProfileRow | undefined;
  return row ? rowToProfile(row) : undefined;
}

export function insertAiProfile(input: CreateAiProfileInput): AiProfile {
  ensureBuiltinAiProfiles();
  const now = new Date().toISOString();
  const id = `custom-${nanoid(10)}`;
  const profile: AiProfile = {
    id,
    name: input.name.trim(),
    avatar: input.avatar,
    description: input.description ?? "",
    rolePrompt: input.rolePrompt.trim(),
    modelRef: input.modelRef ?? BUILTIN_AI_PROFILES[0]!.modelRef,
    defaultCapabilityIds: input.defaultCapabilityIds ?? [],
    builtin: false,
  };
  getDb()
    .prepare(
      `INSERT INTO ai_profiles (
        id, name, avatar, description, role_prompt, model_ref,
        default_capability_ids_json, builtin, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(
      profile.id,
      profile.name,
      profile.avatar ?? null,
      profile.description,
      profile.rolePrompt,
      profile.modelRef,
      JSON.stringify(profile.defaultCapabilityIds),
      now,
      now,
    );
  return profile;
}

export function updateAiProfile(
  id: string,
  patch: UpdateAiProfileInput,
): AiProfile | null {
  const existing = getAiProfileById(id);
  if (!existing) return null;
  if (existing.builtin) {
    // 内置允许改 modelRef / 能力默认值，不允许改 id/builtin
  }
  const next: AiProfile = {
    ...existing,
    name: patch.name?.trim() ?? existing.name,
    avatar: patch.avatar !== undefined ? patch.avatar : existing.avatar,
    description: patch.description ?? existing.description,
    rolePrompt: patch.rolePrompt?.trim() ?? existing.rolePrompt,
    modelRef: patch.modelRef ?? existing.modelRef,
    defaultCapabilityIds:
      patch.defaultCapabilityIds ?? existing.defaultCapabilityIds,
  };
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE ai_profiles SET
        name = ?, avatar = ?, description = ?, role_prompt = ?,
        model_ref = ?, default_capability_ids_json = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      next.name,
      next.avatar ?? null,
      next.description,
      next.rolePrompt,
      next.modelRef,
      JSON.stringify(next.defaultCapabilityIds),
      now,
      id,
    );
  return next;
}

export function deleteAiProfile(id: string): boolean {
  const existing = getAiProfileById(id);
  if (!existing || existing.builtin) return false;
  const result = getDb().prepare("DELETE FROM ai_profiles WHERE id = ?").run(id);
  return result.changes > 0;
}

export function listConversationParticipants(
  conversationId: string,
): ConversationParticipant[] {
  return getDb()
    .prepare(
      `SELECT * FROM conversation_participants
       WHERE conversation_id = ?
       ORDER BY sort_order ASC, created_at ASC`,
    )
    .all(conversationId)
    .map((r) => rowToParticipant(r as ParticipantRow));
}

export function getConversationParticipantById(
  id: string,
): ConversationParticipant | undefined {
  const row = getDb()
    .prepare("SELECT * FROM conversation_participants WHERE id = ?")
    .get(id) as ParticipantRow | undefined;
  return row ? rowToParticipant(row) : undefined;
}

export function replaceConversationParticipants(
  conversationId: string,
  participants: ConversationParticipant[],
): ConversationParticipant[] {
  const database = getDb();
  const now = new Date().toISOString();
  const tx = database.transaction(() => {
    database
      .prepare("DELETE FROM conversation_participants WHERE conversation_id = ?")
      .run(conversationId);
    const insert = database.prepare(
      `INSERT INTO conversation_participants (
        id, conversation_id, profile_id, display_name, model_ref,
        enabled, capability_ids_json, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const p of participants) {
      insert.run(
        p.id,
        conversationId,
        p.profileId,
        p.displayName,
        p.modelRef,
        p.enabled ? 1 : 0,
        JSON.stringify(p.capabilityIds),
        p.sortOrder,
        now,
        now,
      );
    }
  });
  tx();
  return listConversationParticipants(conversationId);
}

/** 为圆桌会话播种默认参与者 */
export function seedRoundtableParticipants(
  conversationId: string,
  profileIds: string[],
): ConversationParticipant[] {
  ensureBuiltinAiProfiles();
  const ids =
    profileIds.length > 0
      ? profileIds
      : [ROUNDTABLE_FOREMAN_PROFILE_ID, "product", "architect", "critic"];
  const unique = [...new Set(ids)];
  if (!unique.includes(ROUNDTABLE_FOREMAN_PROFILE_ID)) {
    unique.unshift(ROUNDTABLE_FOREMAN_PROFILE_ID);
  }
  const participants: ConversationParticipant[] = [];
  let order = 0;
  for (const profileId of unique) {
    const profile = getAiProfileById(profileId);
    if (!profile) continue;
    participants.push({
      id: nanoid(),
      conversationId,
      profileId: profile.id,
      displayName: profile.name,
      modelRef: profile.modelRef,
      enabled: true,
      capabilityIds: [...profile.defaultCapabilityIds],
      sortOrder: order++,
    });
  }
  return replaceConversationParticipants(conversationId, participants);
}

export function insertChatRound(round: ChatRound): ChatRound {
  getDb()
    .prepare(
      `INSERT INTO chat_rounds (
        id, conversation_id, source_message_id, mode, participant_ids_json,
        synthesize, status, estimated_calls, output_goal, length,
        created_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      round.id,
      round.conversationId,
      round.sourceMessageId ?? null,
      round.mode,
      JSON.stringify(round.participantIds),
      round.synthesize ? 1 : 0,
      round.status,
      round.estimatedCalls,
      round.outputGoal ?? null,
      round.length ?? null,
      round.createdAt,
      round.completedAt ?? null,
    );
  return round;
}

export function getChatRoundById(id: string): ChatRound | undefined {
  const row = getDb()
    .prepare("SELECT * FROM chat_rounds WHERE id = ?")
    .get(id) as ChatRoundRow | undefined;
  return row ? rowToRound(row) : undefined;
}

export function updateChatRoundStatus(
  id: string,
  status: ChatRoundStatus,
  completedAt?: string,
): void {
  getDb()
    .prepare(
      `UPDATE chat_rounds SET status = ?, completed_at = COALESCE(?, completed_at) WHERE id = ?`,
    )
    .run(status, completedAt ?? null, id);
}

export function purgeRoundtableForConversation(conversationId: string): void {
  const database = getDb();
  database
    .prepare("DELETE FROM conversation_participants WHERE conversation_id = ?")
    .run(conversationId);
  database
    .prepare("DELETE FROM chat_rounds WHERE conversation_id = ?")
    .run(conversationId);
  database
    .prepare("DELETE FROM peer_requests WHERE conversation_id = ?")
    .run(conversationId);
  database
    .prepare("DELETE FROM peer_mention_grants WHERE conversation_id = ?")
    .run(conversationId);
}

type PeerRequestRow = {
  id: string;
  conversation_id: string;
  round_id: string | null;
  from_participant_id: string;
  to_participant_id: string;
  from_display_name: string;
  to_display_name: string;
  question: string;
  status: string;
  message_id: number | null;
  created_at: string;
  resolved_at: string | null;
};

function rowToPeerRequest(row: PeerRequestRow): PeerRequest {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    roundId: row.round_id ?? undefined,
    fromParticipantId: row.from_participant_id,
    toParticipantId: row.to_participant_id,
    fromDisplayName: row.from_display_name,
    toDisplayName: row.to_display_name,
    question: row.question,
    status: row.status as PeerRequestStatus,
    messageId: row.message_id ?? undefined,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? undefined,
  };
}

export function insertPeerRequest(req: PeerRequest): PeerRequest {
  getDb()
    .prepare(
      `INSERT INTO peer_requests (
        id, conversation_id, round_id, from_participant_id, to_participant_id,
        from_display_name, to_display_name, question, status, message_id,
        created_at, resolved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      req.id,
      req.conversationId,
      req.roundId ?? null,
      req.fromParticipantId,
      req.toParticipantId,
      req.fromDisplayName,
      req.toDisplayName,
      req.question,
      req.status,
      req.messageId ?? null,
      req.createdAt,
      req.resolvedAt ?? null,
    );
  return req;
}

export function getPeerRequestById(id: string): PeerRequest | undefined {
  const row = getDb()
    .prepare("SELECT * FROM peer_requests WHERE id = ?")
    .get(id) as PeerRequestRow | undefined;
  return row ? rowToPeerRequest(row) : undefined;
}

export function updatePeerRequest(
  id: string,
  patch: {
    status?: PeerRequestStatus;
    messageId?: number;
    resolvedAt?: string;
  },
): PeerRequest | undefined {
  const cur = getPeerRequestById(id);
  if (!cur) return undefined;
  const next: PeerRequest = {
    ...cur,
    status: patch.status ?? cur.status,
    messageId: patch.messageId ?? cur.messageId,
    resolvedAt: patch.resolvedAt ?? cur.resolvedAt,
  };
  getDb()
    .prepare(
      `UPDATE peer_requests SET status = ?, message_id = ?, resolved_at = ? WHERE id = ?`,
    )
    .run(
      next.status,
      next.messageId ?? null,
      next.resolvedAt ?? null,
      id,
    );
  return next;
}

export function hasPeerMentionGrant(
  conversationId: string,
  fromParticipantId: string,
  toParticipantId: string,
): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 AS ok FROM peer_mention_grants
       WHERE conversation_id = ? AND from_participant_id = ? AND to_participant_id = ?`,
    )
    .get(conversationId, fromParticipantId, toParticipantId) as
    | { ok: number }
    | undefined;
  return Boolean(row);
}

export function upsertPeerMentionGrant(
  grant: PeerMentionGrant,
): PeerMentionGrant {
  getDb()
    .prepare(
      `INSERT INTO peer_mention_grants (
        conversation_id, from_participant_id, to_participant_id, created_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(conversation_id, from_participant_id, to_participant_id)
      DO UPDATE SET created_at = excluded.created_at`,
    )
    .run(
      grant.conversationId,
      grant.fromParticipantId,
      grant.toParticipantId,
      grant.createdAt,
    );
  return grant;
}

export function listRunningChatRounds(conversationId: string): ChatRound[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM chat_rounds WHERE conversation_id = ? AND status = 'running'
       ORDER BY created_at DESC`,
    )
    .all(conversationId) as ChatRoundRow[];
  return rows.map(rowToRound);
}
