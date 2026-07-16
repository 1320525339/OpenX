import type {
  CoachClarifyMessage,
  CoachClarifyStatus,
  CoachDispatchPermissionMessage,
  CoachExecutionMeta,
  CoachExecutionMessage,
  CoachMessageRecord,
  CoachRefinedMessage,
  CoachRoundSynthesisMessage,
  CoachTextMessage,
  CoachToolResultMessage,
  CoachToolResultPayload,
  Conversation,
  ConversationMode,
  CrewExchangeDirection,
  CrewExchangeRecord,
  GenerationMeta,
  GenerationStatus,
  Project,
  RoundSynthesisPayload,
  RunStreamEvent,
  SpeakerType,
  PeerRequest,
  CoachPeerRequestMessage,
} from "@openx/shared";
import {
  CoachClarifyPayloadSchema,
  CoachDispatchPermissionPayloadSchema,
  CoachExecutionMetaSchema,
  CoachToolResultPayloadSchema,
  CLARIFY_TOOL_NAME,
  DISPATCH_PERMISSION_TOOL_NAME,
  GenerationMetaSchema,
  RefinedGoalSchema,
  RoundSynthesisPayloadSchema,
  PeerRequestPayloadSchema,
  WORK_ORDER_TOOL_NAME,
  OPERATOR_ACTION_TOOL_NAME,
  OperatorActionMetaSchema,
  findPendingClarifyRecordIds,
  CrewExchangeDirectionSchema,
  legacyRoleToSpeakerType,
  speakerTypeToLegacyRole,
} from "@openx/shared";
import { getDb } from "./db/connection.js";
import { purgeRoundtableForConversation } from "./db/roundtable-repo.js";
import {
  allocateWorkOrderNo,
  listGoalsPage,
  countGoalsByDisplay,
  listLogsPage,
  listGoals,
  getGoalById,
  listChildGoals,
  areDependenciesMet,
  listRunnableDraftGoals,
  insertGoal,
  updateGoalCrewBinding,
  GoalRevisionConflictError,
  runGoalDbTransaction,
  casUpdateGoal,
  updateGoal,
  claimConnectPoolGoal,
  transitionGoalStatus,
  deleteGoals,
  appendLog,
  listLogs,
  type ListGoalsFilter,
  type GoalsPageQuery,
  type GoalsPageResult,
  type GoalDisplayCounts,
  type LogPageRow,
  type LogsPageResult,
} from "./db/goals-repo.js";
import {
  MAX_SSE_CATCHUP,
  MAX_SSE_EVENTS_STORED,
  SSE_RETENTION_MS,
  appendSseEvent,
  pruneSseEvents,
  getSseEventById,
  countSseEventsAfter,
  listSseEventsAfter,
  listRecentSseEvents,
  type StoredSseEvent,
} from "./db/sse-repo.js";

export {
  getDb,
  resetDb,
  getDbIntegrityStatus,
  vacuumDb,
} from "./db/connection.js";
export {
  insertDispatchReceipt,
  getLatestDispatchReceipt,
  getDispatchReceipt,
  ackDispatchReceipt,
  type DispatchReceipt,
} from "./db/dispatch-receipts-repo.js";
export {
  insertTokenUsageEvent,
  listTokenUsageByGoal,
  sumTokenUsageByGoal,
  type TokenUsageEvent,
} from "./db/token-usage-repo.js";
export {
  allocateWorkOrderNo,
  listGoalsPage,
  countGoalsByDisplay,
  listLogsPage,
  listGoals,
  getGoalById,
  listChildGoals,
  areDependenciesMet,
  listRunnableDraftGoals,
  insertGoal,
  updateGoalCrewBinding,
  GoalRevisionConflictError,
  runGoalDbTransaction,
  casUpdateGoal,
  updateGoal,
  claimConnectPoolGoal,
  transitionGoalStatus,
  deleteGoals,
  appendLog,
  listLogs,
  type ListGoalsFilter,
  type GoalsPageQuery,
  type GoalsPageResult,
  type GoalDisplayCounts,
  type LogPageRow,
  type LogsPageResult,
};
export {
  MAX_SSE_CATCHUP,
  MAX_SSE_EVENTS_STORED,
  SSE_RETENTION_MS,
  appendSseEvent,
  pruneSseEvents,
  getSseEventById,
  countSseEventsAfter,
  listSseEventsAfter,
  listRecentSseEvents,
  type StoredSseEvent,
};


type ProjectRow = {
  id: string;
  name: string;
  workspace_dir: string;
  created_at: string;
  llm_context_json: string | null;
};

type ConversationRow = {
  id: string;
  project_id: string;
  title: string;
  mode?: string | null;
  created_at: string;
  updated_at: string;
};


type CoachMessageRow = {
  id: number;
  conversationId: string;
  goal_id: string | null;
  role: string;
  text: string;
  timestamp: string;
  kind: string;
  meta_json: string | null;
  speaker_type?: string | null;
  speaker_id?: string | null;
  reply_to_message_id?: number | null;
  round_id?: string | null;
  generation_status?: string | null;
  generation_meta_json?: string | null;
};

function parseGenerationMeta(raw: string | null | undefined): GenerationMeta | undefined {
  if (!raw) return undefined;
  try {
    return GenerationMetaSchema.parse(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

function rowToCoachMessage(row: CoachMessageRow): CoachMessageRecord {
  if (row.kind === "execution" && row.meta_json) {
    const execution = CoachExecutionMetaSchema.parse(JSON.parse(row.meta_json));
    return {
      id: row.id,
      conversationId: row.conversationId,
      kind: "execution",
      timestamp: row.timestamp,
      execution,
    };
  }
  if (row.kind === "refined" && row.meta_json) {
    const refined = RefinedGoalSchema.parse(JSON.parse(row.meta_json));
    const linkedClarifyMessageId =
      row.text && /^\d+$/.test(row.text) ? Number(row.text) : undefined;
    return {
      id: row.id,
      conversationId: row.conversationId,
      kind: "refined",
      timestamp: row.timestamp,
      refined,
      linkedGoalId: row.goal_id ?? undefined,
      linkedClarifyMessageId,
    };
  }
  if (row.kind === "clarify" && row.meta_json) {
    const clarify = CoachClarifyPayloadSchema.parse(JSON.parse(row.meta_json));
    const linkedRefinedMessageId =
      row.text && /^\d+$/.test(row.text) ? Number(row.text) : undefined;
    return {
      id: row.id,
      conversationId: row.conversationId,
      kind: "clarify",
      timestamp: row.timestamp,
      clarify,
      linkedRefinedMessageId,
    };
  }
  if (row.kind === "tool_result" && row.meta_json) {
    const toolResult = CoachToolResultPayloadSchema.parse(JSON.parse(row.meta_json));
    return {
      id: row.id,
      conversationId: row.conversationId,
      kind: "tool_result",
      timestamp: row.timestamp,
      toolResult,
    };
  }
  if (row.kind === "operator_action" && row.meta_json) {
    const operatorAction = OperatorActionMetaSchema.parse(JSON.parse(row.meta_json));
    return {
      id: row.id,
      conversationId: row.conversationId,
      kind: "operator_action",
      timestamp: row.timestamp,
      operatorAction,
    };
  }
  if (row.kind === "dispatch_permission" && row.meta_json) {
    const dispatchPermission = CoachDispatchPermissionPayloadSchema.parse(
      JSON.parse(row.meta_json),
    );
    return {
      id: row.id,
      conversationId: row.conversationId,
      kind: "dispatch_permission",
      timestamp: row.timestamp,
      dispatchPermission,
    };
  }
  if (row.kind === "round_synthesis" && row.meta_json) {
    const synthesis = RoundSynthesisPayloadSchema.parse(JSON.parse(row.meta_json));
    return {
      id: row.id,
      conversationId: row.conversationId,
      kind: "round_synthesis",
      timestamp: row.timestamp,
      synthesis,
      speakerType: "foreman",
      speakerId: "foreman",
      roundId: row.round_id ?? synthesis.roundId,
      generationStatus: (row.generation_status as GenerationStatus | null) ?? "completed",
    };
  }
  if (row.kind === "peer_request" && row.meta_json) {
    const peerRequest = PeerRequestPayloadSchema.parse(JSON.parse(row.meta_json));
    return {
      id: row.id,
      conversationId: row.conversationId,
      kind: "peer_request",
      timestamp: row.timestamp,
      peerRequest,
      roundId: row.round_id ?? peerRequest.roundId,
    };
  }
  const speakerType =
    (row.speaker_type as SpeakerType | null) ?? legacyRoleToSpeakerType(row.role);
  const speakerId =
    row.speaker_id ??
    (speakerType === "user" ? "user" : speakerType === "foreman" ? "foreman" : "unknown");
  return {
    id: row.id,
    conversationId: row.conversationId,
    kind: "text",
    role: speakerTypeToLegacyRole(speakerType),
    text: row.text,
    timestamp: row.timestamp,
    linkedGoalId: row.goal_id ?? undefined,
    speakerType,
    speakerId,
    replyToMessageId: row.reply_to_message_id ?? undefined,
    roundId: row.round_id ?? undefined,
    generationStatus: (row.generation_status as GenerationStatus | null) ?? undefined,
    generationMeta: parseGenerationMeta(row.generation_meta_json),
  };
}

export function saveCoachMessage(
  conversationId: string,
  role: "user" | "coach",
  text: string,
  goalId?: string | null,
): CoachTextMessage {
  const speakerType: SpeakerType = role === "user" ? "user" : "foreman";
  return saveRoundtableTextMessage({
    conversationId,
    speakerType,
    speakerId: speakerType === "user" ? "user" : "foreman",
    text,
    goalId,
  });
}

export function saveRoundtableTextMessage(input: {
  conversationId: string;
  speakerType: SpeakerType;
  speakerId: string;
  text: string;
  goalId?: string | null;
  replyToMessageId?: number;
  roundId?: string;
  generationStatus?: GenerationStatus;
  generationMeta?: GenerationMeta;
}): CoachTextMessage {
  const timestamp = new Date().toISOString();
  const role = speakerTypeToLegacyRole(input.speakerType);
  const result = getDb()
    .prepare(
      `INSERT INTO coach_messages (
        conversation_id, goal_id, role, text, kind, meta_json, created_at,
        speaker_type, speaker_id, reply_to_message_id, round_id,
        generation_status, generation_meta_json
      ) VALUES (?, ?, ?, ?, 'text', NULL, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.conversationId,
      input.goalId ?? null,
      role,
      input.text,
      timestamp,
      input.speakerType,
      input.speakerId,
      input.replyToMessageId ?? null,
      input.roundId ?? null,
      input.generationStatus ?? null,
      input.generationMeta ? JSON.stringify(input.generationMeta) : null,
    );
  touchConversation(input.conversationId);
  return {
    id: Number(result.lastInsertRowid),
    conversationId: input.conversationId,
    kind: "text",
    role,
    text: input.text,
    timestamp,
    linkedGoalId: input.goalId ?? undefined,
    speakerType: input.speakerType,
    speakerId: input.speakerId,
    replyToMessageId: input.replyToMessageId,
    roundId: input.roundId,
    generationStatus: input.generationStatus,
    generationMeta: input.generationMeta,
  };
}

export function updateCoachMessageGeneration(
  messageId: number,
  patch: {
    text?: string;
    generationStatus?: GenerationStatus;
    generationMeta?: GenerationMeta;
  },
): void {
  const row = getDb()
    .prepare("SELECT text, generation_meta_json FROM coach_messages WHERE id = ?")
    .get(messageId) as
    | { text: string; generation_meta_json: string | null }
    | undefined;
  if (!row) return;
  const meta =
    patch.generationMeta !== undefined
      ? JSON.stringify(patch.generationMeta)
      : row.generation_meta_json;
  getDb()
    .prepare(
      `UPDATE coach_messages SET
        text = COALESCE(?, text),
        generation_status = COALESCE(?, generation_status),
        generation_meta_json = ?
       WHERE id = ?`,
    )
    .run(
      patch.text ?? null,
      patch.generationStatus ?? null,
      meta,
      messageId,
    );
}

export function saveRoundSynthesisMessage(
  conversationId: string,
  synthesis: RoundSynthesisPayload,
): CoachRoundSynthesisMessage {
  const timestamp = new Date().toISOString();
  const result = getDb()
    .prepare(
      `INSERT INTO coach_messages (
        conversation_id, goal_id, role, text, kind, meta_json, created_at,
        speaker_type, speaker_id, round_id, generation_status
      ) VALUES (?, NULL, 'coach', ?, 'round_synthesis', ?, ?, 'foreman', 'foreman', ?, 'completed')`,
    )
    .run(
      conversationId,
      synthesis.recommendation,
      JSON.stringify(synthesis),
      timestamp,
      synthesis.roundId,
    );
  touchConversation(conversationId);
  return {
    id: Number(result.lastInsertRowid),
    conversationId,
    kind: "round_synthesis",
    timestamp,
    synthesis,
    speakerType: "foreman",
    speakerId: "foreman",
    roundId: synthesis.roundId,
    generationStatus: "completed",
  };
}

export function savePeerRequestMessage(
  conversationId: string,
  peerRequest: PeerRequest,
): CoachPeerRequestMessage {
  const timestamp = new Date().toISOString();
  const result = getDb()
    .prepare(
      `INSERT INTO coach_messages (
        conversation_id, goal_id, role, text, kind, meta_json, created_at,
        speaker_type, speaker_id, round_id
      ) VALUES (?, NULL, 'coach', ?, 'peer_request', ?, ?, 'foreman', 'foreman', ?)`,
    )
    .run(
      conversationId,
      `${peerRequest.fromDisplayName} 请求 ${peerRequest.toDisplayName} 回答`,
      JSON.stringify(peerRequest),
      timestamp,
      peerRequest.roundId ?? null,
    );
  touchConversation(conversationId);
  return {
    id: Number(result.lastInsertRowid),
    conversationId,
    kind: "peer_request",
    timestamp,
    peerRequest: { ...peerRequest, messageId: Number(result.lastInsertRowid) },
    roundId: peerRequest.roundId,
  };
}

export function updatePeerRequestMessage(
  messageId: number,
  peerRequest: PeerRequest,
): CoachPeerRequestMessage | null {
  const row = getDb()
    .prepare("SELECT conversation_id FROM coach_messages WHERE id = ? AND kind = 'peer_request'")
    .get(messageId) as { conversation_id: string } | undefined;
  if (!row) return null;
  getDb()
    .prepare(
      `UPDATE coach_messages SET text = ?, meta_json = ? WHERE id = ?`,
    )
    .run(
      `${peerRequest.fromDisplayName} 请求 ${peerRequest.toDisplayName} 回答（${peerRequest.status}）`,
      JSON.stringify(peerRequest),
      messageId,
    );
  touchConversation(row.conversation_id);
  return {
    id: messageId,
    conversationId: row.conversation_id,
    kind: "peer_request",
    timestamp: new Date().toISOString(),
    peerRequest,
    roundId: peerRequest.roundId,
  };
}

export function hasCoachExecutionMessage(
  conversationId: string,
  goalId: string,
  runId: string,
): boolean {
  const row = getDb()
    .prepare(
      `SELECT id FROM coach_messages
       WHERE conversation_id = ? AND kind = 'execution'
         AND json_extract(meta_json, '$.goalId') = ?
         AND json_extract(meta_json, '$.runId') = ?
       LIMIT 1`,
    )
    .get(conversationId, goalId, runId) as { id: number } | undefined;
  return Boolean(row);
}

export function linkCoachRefinedMessage(messageId: number, goalId: string): void {
  getDb()
    .prepare(
      `UPDATE coach_messages SET goal_id = ? WHERE id = ? AND kind = 'refined'`,
    )
    .run(goalId, messageId);
}

export function getCoachMessageById(
  messageId: number,
): CoachMessageRecord | null {
  const row = getDb()
    .prepare(
      `SELECT id, conversation_id as conversationId, goal_id, role, text, kind, meta_json,
              created_at as timestamp,
              speaker_type, speaker_id, reply_to_message_id, round_id,
              generation_status, generation_meta_json
       FROM coach_messages WHERE id = ?`,
    )
    .get(messageId) as CoachMessageRow | undefined;
  return row ? rowToCoachMessage(row) : null;
}

export function hasWorkOrderToolResult(
  conversationId: string,
  refinedMessageId: number,
): boolean {
  const row = getDb()
    .prepare(
      `SELECT id FROM coach_messages
       WHERE conversation_id = ? AND kind = 'tool_result'
         AND json_extract(meta_json, '$.toolName') = ?
         AND json_extract(meta_json, '$.refinedMessageId') = ?
       LIMIT 1`,
    )
    .get(conversationId, WORK_ORDER_TOOL_NAME, refinedMessageId) as
    | { id: number }
    | undefined;
  return Boolean(row);
}

export function hasClarifyToolResult(
  conversationId: string,
  clarifyMessageId: number,
): boolean {
  const row = getDb()
    .prepare(
      `SELECT id FROM coach_messages
       WHERE conversation_id = ? AND kind = 'tool_result'
         AND json_extract(meta_json, '$.toolName') = ?
         AND json_extract(meta_json, '$.clarifyMessageId') = ?
       LIMIT 1`,
    )
    .get(conversationId, CLARIFY_TOOL_NAME, clarifyMessageId) as
    | { id: number }
    | undefined;
  return Boolean(row);
}

export function hasOperatorActionToolResult(
  conversationId: string,
  operatorMessageId: number,
): boolean {
  const row = getDb()
    .prepare(
      `SELECT id FROM coach_messages
       WHERE conversation_id = ? AND kind = 'tool_result'
         AND json_extract(meta_json, '$.toolName') = ?
         AND json_extract(meta_json, '$.operatorMessageId') = ?
       LIMIT 1`,
    )
    .get(conversationId, OPERATOR_ACTION_TOOL_NAME, operatorMessageId) as
    | { id: number }
    | undefined;
  return Boolean(row);
}

export function saveCoachOperatorToolTrace(
  conversationId: string,
  toolCalls: Array<{ name: string; args: unknown; result: unknown }>,
): void {
  for (const tc of toolCalls) {
    const pending =
      tc.name === "openx_call_api" ||
      tc.name === "request_admin_access" ||
      tc.name === "propose_dispatch_permission"
        ? (tc.result as { kind?: string })?.kind === "pending" ||
          (tc.result as { kind?: string })?.kind === "proposal"
        : false;
    if (pending) continue;
    const payload = JSON.stringify({ args: tc.args, result: tc.result });
    const text = `[工具调用 ${tc.name}] ${payload.length > 4000 ? `${payload.slice(0, 4000)}…` : payload}`;
    saveCoachMessage(conversationId, "coach", text);
  }
}

export function saveCoachToolResultMessage(
  conversationId: string,
  toolResult: CoachToolResultPayload,
): CoachToolResultMessage {
  const timestamp = new Date().toISOString();
  const dismissed = toolResult.outcome === "dismissed";
  const metaJson = JSON.stringify({
    ...toolResult,
    dismissed,
  });
  const goalId =
    toolResult.toolName === WORK_ORDER_TOOL_NAME
      ? (toolResult.goalId ?? null)
      : null;
  const result = getDb()
    .prepare(
      `INSERT INTO coach_messages (conversation_id, goal_id, role, text, kind, meta_json, created_at)
       VALUES (?, ?, 'coach', '', 'tool_result', ?, ?)`,
    )
    .run(
      conversationId,
      goalId,
      metaJson,
      timestamp,
    );
  touchConversation(conversationId);
  return {
    id: Number(result.lastInsertRowid),
    conversationId,
    kind: "tool_result",
    timestamp,
    toolResult,
  };
}

export function saveCoachClarifyMessage(
  conversationId: string,
  clarify: CoachClarifyMessage["clarify"],
): CoachClarifyMessage {
  const timestamp = new Date().toISOString();
  const metaJson = JSON.stringify(clarify);
  const result = getDb()
    .prepare(
      `INSERT INTO coach_messages (conversation_id, goal_id, role, text, kind, meta_json, created_at)
       VALUES (?, NULL, 'coach', '', 'clarify', ?, ?)`,
    )
    .run(conversationId, metaJson, timestamp);
  touchConversation(conversationId);
  return {
    id: Number(result.lastInsertRowid),
    conversationId,
    kind: "clarify",
    timestamp,
    clarify,
  };
}

export function saveCoachDispatchPermissionMessage(
  conversationId: string,
  dispatchPermission: CoachDispatchPermissionMessage["dispatchPermission"],
): CoachDispatchPermissionMessage {
  const timestamp = new Date().toISOString();
  const metaJson = JSON.stringify(dispatchPermission);
  const result = getDb()
    .prepare(
      `INSERT INTO coach_messages (conversation_id, goal_id, role, text, kind, meta_json, created_at)
       VALUES (?, NULL, 'coach', '', 'dispatch_permission', ?, ?)`,
    )
    .run(conversationId, metaJson, timestamp);
  touchConversation(conversationId);
  return {
    id: Number(result.lastInsertRowid),
    conversationId,
    kind: "dispatch_permission",
    timestamp,
    dispatchPermission,
  };
}

export function updateCoachDispatchPermissionStatus(
  messageId: number,
  status: "confirmed" | "dismissed",
): void {
  const row = getDb()
    .prepare(`SELECT meta_json FROM coach_messages WHERE id = ? AND kind = 'dispatch_permission'`)
    .get(messageId) as { meta_json: string } | undefined;
  if (!row?.meta_json) return;
  const payload = CoachDispatchPermissionPayloadSchema.parse(JSON.parse(row.meta_json));
  const metaJson = JSON.stringify({ ...payload, status });
  getDb()
    .prepare(`UPDATE coach_messages SET meta_json = ? WHERE id = ?`)
    .run(metaJson, messageId);
}

export function hasDispatchPermissionToolResult(
  conversationId: string,
  dispatchPermissionMessageId: number,
): boolean {
  const row = getDb()
    .prepare(
      `SELECT id FROM coach_messages
       WHERE conversation_id = ? AND kind = 'tool_result'
         AND json_extract(meta_json, '$.toolName') = ?
         AND json_extract(meta_json, '$.dispatchPermissionMessageId') = ?
       LIMIT 1`,
    )
    .get(conversationId, DISPATCH_PERMISSION_TOOL_NAME, dispatchPermissionMessageId) as
    | { id: number }
    | undefined;
  return Boolean(row);
}

export function updateCoachClarifyStatus(
  messageId: number,
  status: CoachClarifyStatus,
): void {
  const row = getDb()
    .prepare(`SELECT meta_json FROM coach_messages WHERE id = ? AND kind = 'clarify'`)
    .get(messageId) as { meta_json: string } | undefined;
  if (!row?.meta_json) return;
  const clarify = CoachClarifyPayloadSchema.parse(JSON.parse(row.meta_json));
  const metaJson = JSON.stringify({ ...clarify, status });
  getDb()
    .prepare(`UPDATE coach_messages SET meta_json = ? WHERE id = ?`)
    .run(metaJson, messageId);
}

/** 澄清回答后关联生成的工单消息（存于 text 列，仅 clarify kind） */
export function linkCoachClarifyToRefined(
  clarifyMessageId: number,
  refinedMessageId: number,
): void {
  getDb()
    .prepare(
      `UPDATE coach_messages SET text = ? WHERE id = ? AND kind = 'clarify'`,
    )
    .run(String(refinedMessageId), clarifyMessageId);
}

export function saveCoachRefinedMessage(
  conversationId: string,
  refined: CoachRefinedMessage["refined"],
  opts?: { linkedClarifyMessageId?: number },
): CoachRefinedMessage {
  const timestamp = new Date().toISOString();
  const metaJson = JSON.stringify(refined);
  const linkText =
    opts?.linkedClarifyMessageId != null
      ? String(opts.linkedClarifyMessageId)
      : "";
  const result = getDb()
    .prepare(
      `INSERT INTO coach_messages (conversation_id, goal_id, role, text, kind, meta_json, created_at)
       VALUES (?, NULL, 'coach', ?, 'refined', ?, ?)`,
    )
    .run(conversationId, linkText, metaJson, timestamp);
  touchConversation(conversationId);
  return {
    id: Number(result.lastInsertRowid),
    conversationId,
    kind: "refined",
    timestamp,
    refined,
    linkedClarifyMessageId: opts?.linkedClarifyMessageId,
  };
}

export function saveCoachExecutionMessage(
  conversationId: string,
  execution: CoachExecutionMeta,
): CoachExecutionMessage {
  const timestamp = new Date().toISOString();
  const metaJson = JSON.stringify(execution);
  const result = getDb()
    .prepare(
      `INSERT INTO coach_messages (conversation_id, goal_id, role, text, kind, meta_json, created_at)
       VALUES (?, ?, 'coach', '', 'execution', ?, ?)`,
    )
    .run(conversationId, execution.goalId, metaJson, timestamp);
  touchConversation(conversationId);
  return {
    id: Number(result.lastInsertRowid),
    conversationId,
    kind: "execution",
    timestamp,
    execution,
  };
}

export function listCoachMessages(
  conversationId: string,
  limit = 80,
): CoachMessageRecord[] {
  return (
    getDb()
      .prepare(
        `SELECT id, conversation_id as conversationId, goal_id, role, text, kind, meta_json,
                created_at as timestamp,
                speaker_type, speaker_id, reply_to_message_id, round_id,
                generation_status, generation_meta_json
         FROM coach_messages WHERE conversation_id = ?
         ORDER BY id DESC LIMIT ?`,
      )
      .all(conversationId, limit)
      .reverse() as CoachMessageRow[]
  ).map(rowToCoachMessage);
}

export function listPendingClarifyIdsForConversation(
  conversationId: string,
): number[] {
  const records = listCoachMessages(conversationId, 200);
  return findPendingClarifyRecordIds(records);
}

export function hasLatestReviewPass(goalId: string): boolean {
  const entries = listReviewRoundEntries(goalId, 5);
  const latest = entries[entries.length - 1];
  return latest?.verdict === "pass";
}

export type CoachThreadCheckpoint = {
  id: number;
  conversationId: string;
  upToMessageId: number;
  summaryText: string;
  createdAt: string;
};

export function getLatestCoachThreadCheckpoint(
  conversationId: string,
): CoachThreadCheckpoint | undefined {
  const row = getDb()
    .prepare(
      `SELECT id, conversation_id as conversationId, up_to_message_id as upToMessageId,
              summary_text as summaryText, created_at as createdAt
       FROM coach_thread_checkpoints
       WHERE conversation_id = ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(conversationId) as CoachThreadCheckpoint | undefined;
  return row;
}

export function saveCoachThreadCheckpoint(input: {
  conversationId: string;
  upToMessageId: number;
  summaryText: string;
}): CoachThreadCheckpoint {
  const createdAt = new Date().toISOString();
  const result = getDb()
    .prepare(
      `INSERT INTO coach_thread_checkpoints
       (conversation_id, up_to_message_id, summary_text, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(
      input.conversationId,
      input.upToMessageId,
      input.summaryText,
      createdAt,
    );
  return {
    id: Number(result.lastInsertRowid),
    conversationId: input.conversationId,
    upToMessageId: input.upToMessageId,
    summaryText: input.summaryText,
    createdAt,
  };
}

export type MemorySearchHit = {
  projectId: string;
  scope: string;
  content: string;
  rank: number;
};

export function indexMemoryChunk(
  projectId: string,
  scope: string,
  content: string,
): void {
  getDb()
    .prepare(
      `INSERT INTO memory_fts (project_id, scope, content) VALUES (?, ?, ?)`,
    )
    .run(projectId, scope, content);
}

export function clearMemoryIndex(projectId: string, scope?: string): void {
  if (scope) {
    getDb()
      .prepare(`DELETE FROM memory_fts WHERE project_id = ? AND scope = ?`)
      .run(projectId, scope);
    return;
  }
  getDb()
    .prepare(`DELETE FROM memory_fts WHERE project_id = ?`)
    .run(projectId);
}

export function searchMemoryFts(
  projectId: string,
  query: string,
  limit = 5,
  scope?: string,
): MemorySearchHit[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const terms = trimmed
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"`)
    .join(" OR ");
  if (!terms) return [];
  if (scope) {
    return getDb()
      .prepare(
        `SELECT project_id as projectId, scope, content,
                bm25(memory_fts) as rank
         FROM memory_fts
         WHERE project_id = ? AND scope = ? AND memory_fts MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(projectId, scope, terms, limit) as MemorySearchHit[];
  }
  return getDb()
    .prepare(
      `SELECT project_id as projectId, scope, content,
              bm25(memory_fts) as rank
       FROM memory_fts
       WHERE project_id = ? AND memory_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
    )
    .all(projectId, terms, limit) as MemorySearchHit[];
}

function rowToProject(row: ProjectRow): Project {
  let llmContext: Project["llmContext"];
  if (row.llm_context_json) {
    try {
      llmContext = JSON.parse(row.llm_context_json) as Project["llmContext"];
    } catch {
      llmContext = undefined;
    }
  }
  return {
    id: row.id,
    name: row.name,
    workspaceDir: row.workspace_dir,
    createdAt: row.created_at,
    llmContext,
  };
}

function rowToConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    mode: (row.mode as ConversationMode | null) === "roundtable" ? "roundtable" : "foreman",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listProjects(): Project[] {
  return getDb()
    .prepare("SELECT * FROM projects ORDER BY created_at ASC")
    .all()
    .map((r) => rowToProject(r as ProjectRow));
}

export function getProjectById(id: string): Project | undefined {
  const row = getDb().prepare("SELECT * FROM projects WHERE id = ?").get(id) as
    | ProjectRow
    | undefined;
  return row ? rowToProject(row) : undefined;
}

export function insertProject(project: Project): Project {
  getDb()
    .prepare(
      "INSERT INTO projects (id, name, workspace_dir, created_at, llm_context_json) VALUES (?, ?, ?, ?, ?)",
    )
    .run(
      project.id,
      project.name,
      project.workspaceDir,
      project.createdAt,
      project.llmContext ? JSON.stringify(project.llmContext) : null,
    );
  return project;
}

export function updateProject(project: Project): Project {
  getDb()
    .prepare(
      "UPDATE projects SET name = ?, workspace_dir = ?, llm_context_json = ? WHERE id = ?",
    )
    .run(
      project.name,
      project.workspaceDir,
      project.llmContext ? JSON.stringify(project.llmContext) : null,
      project.id,
    );
  return project;
}

/** 删除项目：先整批强制清理下属任务，再清理对话与记忆索引 */
export function deleteProject(id: string): boolean {
  const database = getDb();
  const existing = database.prepare("SELECT id FROM projects WHERE id = ?").get(id);
  if (!existing) return false;

  const run = database.transaction(() => {
    // 按项目收集全部 Goal，force 删除以避免跨对话 dependsOn 留下孤儿
    const projectGoals = listGoals({ projectId: id });
    if (projectGoals.length > 0) {
      deleteGoals(
        projectGoals.map((g) => g.id),
        { force: true },
      );
    }

    const convIds = database
      .prepare("SELECT id FROM conversations WHERE project_id = ?")
      .all(id) as { id: string }[];
    for (const { id: convId } of convIds) {
      purgeConversationRecords(convId);
    }

    clearMemoryIndex(id);
    database.prepare("DELETE FROM projects WHERE id = ?").run(id);
  });
  run();
  return true;
}

export function listConversations(projectId?: string): Conversation[] {
  const database = getDb();
  if (projectId) {
    return database
      .prepare(
        "SELECT * FROM conversations WHERE project_id = ? ORDER BY updated_at DESC",
      )
      .all(projectId)
      .map((r) => rowToConversation(r as ConversationRow));
  }
  return database
    .prepare("SELECT * FROM conversations ORDER BY updated_at DESC")
    .all()
    .map((r) => rowToConversation(r as ConversationRow));
}

export function getConversationById(id: string): Conversation | undefined {
  const row = getDb()
    .prepare("SELECT * FROM conversations WHERE id = ?")
    .get(id) as ConversationRow | undefined;
  return row ? rowToConversation(row) : undefined;
}

export function insertConversation(conversation: Conversation): Conversation {
  getDb()
    .prepare(
      "INSERT INTO conversations (id, project_id, title, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(
      conversation.id,
      conversation.projectId,
      conversation.title,
      conversation.mode ?? "foreman",
      conversation.createdAt,
      conversation.updatedAt,
    );
  return { ...conversation, mode: conversation.mode ?? "foreman" };
}

export function updateConversation(conversation: Conversation): Conversation {
  getDb()
    .prepare("UPDATE conversations SET title = ?, mode = ?, updated_at = ? WHERE id = ?")
    .run(
      conversation.title,
      conversation.mode ?? "foreman",
      conversation.updatedAt,
      conversation.id,
    );
  return conversation;
}

export function touchConversation(id: string): void {
  const now = new Date().toISOString();
  getDb()
    .prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
    .run(now, id);
}

/** 清理对话附属数据与行（假定 Goal 已处理或在此强制清理） */
function purgeConversationRecords(id: string): boolean {
  const database = getDb();
  const run = database.transaction(() => {
    const goalIds = database
      .prepare("SELECT id FROM goals WHERE conversation_id = ?")
      .all(id) as { id: string }[];
    if (goalIds.length > 0) {
      deleteGoals(
        goalIds.map((g) => g.id),
        { force: true },
      );
    }
    database.prepare("DELETE FROM coach_messages WHERE conversation_id = ?").run(id);
    database
      .prepare("DELETE FROM coach_thread_checkpoints WHERE conversation_id = ?")
      .run(id);
    database.prepare("DELETE FROM crew_messages WHERE conversation_id = ?").run(id);
    purgeRoundtableForConversation(id);
    const result = database
      .prepare("DELETE FROM conversations WHERE id = ?")
      .run(id);
    return result.changes > 0;
  });
  return run();
}

export function deleteConversation(id: string): boolean {
  return purgeConversationRecords(id);
}

export function getProjectForConversation(
  conversationId: string,
): Project | undefined {
  const conv = getConversationById(conversationId);
  if (!conv) return undefined;
  return getProjectById(conv.projectId);
}

export function getWorkspaceDirForConversation(
  conversationId: string,
): string | undefined {
  return getProjectForConversation(conversationId)?.workspaceDir;
}

export function saveExecutionSummary(
  goalId: string,
  summary: string,
  executorId: string,
): void {
  const timestamp = new Date().toISOString();
  getDb()
    .prepare(
      "INSERT INTO execution_summaries (goal_id, summary, executor_id, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(goalId, summary, executorId, timestamp);
}

export function listExecutionSummaries(goalId: string, limit = 5): string[] {
  return getDb()
    .prepare(
      "SELECT summary FROM execution_summaries WHERE goal_id = ? ORDER BY id DESC LIMIT ?",
    )
    .all(goalId, limit)
    .map((r) => (r as { summary: string }).summary)
    .reverse();
}

export const REVIEW_ROUND_LOG_PREFIX = "【审查记录】";

export type ReviewVerifySnapshot = {
  command: string;
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  stdout?: string;
  stderr?: string;
};

export type ReviewRoundEntry = {
  round: number;
  roundLabel: string;
  verdict: "pass" | "fail";
  reason: string;
  reworkInstruction?: string;
  reworkTargets?: Array<{ childTitle: string; instruction: string }>;
  verifyResults?: ReviewVerifySnapshot[];
  timestamp: string;
};

export function listReviewRoundEntries(
  goalId: string,
  limit = 30,
): ReviewRoundEntry[] {
  const rows = listLogs(goalId, 400)
    .filter((l) => l.message.startsWith(REVIEW_ROUND_LOG_PREFIX))
    .map((l) => {
      try {
        const data = JSON.parse(
          l.message.slice(REVIEW_ROUND_LOG_PREFIX.length),
        ) as {
          round?: number;
          verdict?: "pass" | "fail";
          reason?: string;
          reworkInstruction?: string;
          reworkTargets?: Array<{ childTitle: string; instruction: string }>;
          verifyResults?: ReviewVerifySnapshot[];
        };
        const round = data.round ?? 0;
        const entry: ReviewRoundEntry = {
          round,
          roundLabel: `第 ${round + 1} 轮`,
          verdict: data.verdict ?? "fail",
          reason: data.reason ?? "",
          timestamp: l.timestamp,
        };
        if (data.reworkInstruction !== undefined) {
          entry.reworkInstruction = data.reworkInstruction;
        }
        if (data.reworkTargets !== undefined) {
          entry.reworkTargets = data.reworkTargets;
        }
        if (data.verifyResults !== undefined) {
          entry.verifyResults = data.verifyResults;
        }
        return entry;
      } catch {
        return null;
      }
    })
    .filter((e): e is ReviewRoundEntry => e !== null);
  return rows.slice(-limit);
}

export function listReviewRounds(goalId: string, limit = 10): string[] {
  return listReviewRoundEntries(goalId, limit).map((entry) => {
    const targets =
      entry.reworkTargets?.length
        ? `\n打回子任务：${entry.reworkTargets.map((t) => `「${t.childTitle}」→ ${t.instruction}`).join("；")}`
        : "";
    const rework = entry.reworkInstruction
      ? `\n修改清单：${entry.reworkInstruction}`
      : "";
    const tests =
      entry.verifyResults?.length
        ? `\n验证：${entry.verifyResults.map((v) => `${v.command} → ${v.ok ? "通过" : "失败"}`).join("；")}`
        : "";
    return `${entry.roundLabel} ${entry.verdict}：${entry.reason}${rework}${targets}${tests}`;
  });
}

export function buildGoalFeedback(goalId: string) {
  const goal = getGoalById(goalId);
  if (!goal) return undefined;
  const recentLogs = listLogs(goalId, 20).map((l) => ({
    level: l.level,
    message: l.message,
  }));
  const priorReviewRounds = listReviewRounds(goalId, 10);
  return {
    reworkReason: goal.reworkReason,
    resultSummary: goal.resultSummary,
    recentLogs,
    priorSummaries: listExecutionSummaries(goalId, 10),
    priorReviewRounds:
      priorReviewRounds.length > 0 ? priorReviewRounds : undefined,
  };
}


const MAX_RUN_EVENTS_PER_GOAL = 400;

export function clearRunEvents(goalId: string): void {
  getDb().prepare("DELETE FROM run_events WHERE goal_id = ?").run(goalId);
}

export function appendRunEventRecord(
  goalId: string,
  runId: string,
  event: RunStreamEvent,
): void {
  const timestamp = new Date().toISOString();
  getDb()
    .prepare(
      "INSERT INTO run_events (goal_id, run_id, payload_json, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(goalId, runId, JSON.stringify(event), timestamp);
  const row = getDb()
    .prepare("SELECT COUNT(*) as count FROM run_events WHERE goal_id = ?")
    .get(goalId) as { count: number };
  if (row.count > MAX_RUN_EVENTS_PER_GOAL) {
    getDb()
      .prepare(
        `DELETE FROM run_events WHERE goal_id = ? AND id NOT IN (
          SELECT id FROM run_events WHERE goal_id = ? ORDER BY id DESC LIMIT ?
        )`,
      )
      .run(goalId, goalId, MAX_RUN_EVENTS_PER_GOAL);
  }
}

export function listRunEventRecords(goalId: string, limit = 200): RunStreamEvent[] {
  return getDb()
    .prepare(
      `SELECT payload_json as payloadJson FROM run_events
       WHERE goal_id = ? ORDER BY id ASC LIMIT ?`,
    )
    .all(goalId, limit)
    .map((row) => JSON.parse((row as { payloadJson: string }).payloadJson) as RunStreamEvent);
}

const MAX_ISLAND_SEEN = 500;
const MAX_ISLAND_ID_LEN = 128;
const ISLAND_SEEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function pruneIslandSeen(maxCount: number): void {
  const cutoff = new Date(Date.now() - ISLAND_SEEN_TTL_MS).toISOString();
  getDb().prepare("DELETE FROM island_seen WHERE seen_at < ?").run(cutoff);
  getDb()
    .prepare(
      `DELETE FROM island_seen WHERE island_id NOT IN (
        SELECT island_id FROM island_seen ORDER BY seen_at DESC LIMIT ?
      )`,
    )
    .run(maxCount);
}

export function listIslandSeenIds(limit = MAX_ISLAND_SEEN, scopeKey = "global"): string[] {
  pruneIslandSeen(MAX_ISLAND_SEEN);
  const capped = Math.max(1, Math.min(limit, MAX_ISLAND_SEEN));
  return getDb()
    .prepare(
      `SELECT island_id as islandId FROM island_seen
       WHERE scope_key = ?
       ORDER BY seen_at DESC LIMIT ?`,
    )
    .all(scopeKey, capped)
    .map((row) => (row as { islandId: string }).islandId);
}

export function isIslandSeenInDb(islandId: string, scopeKey = "global"): boolean {
  const row = getDb()
    .prepare("SELECT 1 as ok FROM island_seen WHERE island_id = ? AND scope_key = ?")
    .get(islandId, scopeKey) as { ok: number } | undefined;
  return row != null;
}

export function bulkMarkIslandSeen(ids: string[], scopeKey = "global"): number {
  const unique = [
    ...new Set(
      ids.filter((id) => typeof id === "string" && id.length > 0 && id.length <= MAX_ISLAND_ID_LEN),
    ),
  ];
  if (unique.length === 0) return 0;

  const now = new Date().toISOString();
  const insert = getDb().prepare(
    "INSERT OR IGNORE INTO island_seen (island_id, seen_at, scope_key) VALUES (?, ?, ?)",
  );
  const mark = getDb().transaction((idList: string[]) => {
    let marked = 0;
    for (const id of idList) {
      const info = insert.run(id, now, scopeKey);
      if (info.changes > 0) marked += 1;
    }
    pruneIslandSeen(MAX_ISLAND_SEEN);
    return marked;
  });

  return mark(unique);
}

type CrewMessageRow = {
  id: number;
  goal_id: string;
  conversation_id: string;
  direction: string;
  summary: string;
  payload_json: string | null;
  created_at: string;
};

function rowToCrewExchange(row: CrewMessageRow): CrewExchangeRecord {
  let payload: unknown;
  if (row.payload_json?.trim()) {
    try {
      payload = JSON.parse(row.payload_json);
    } catch {
      payload = undefined;
    }
  }
  const direction = CrewExchangeDirectionSchema.parse(row.direction);
  return {
    id: row.id,
    goalId: row.goal_id,
    conversationId: row.conversation_id,
    direction,
    summary: row.summary,
    payload,
    createdAt: row.created_at,
  };
}

export function appendCrewExchange(input: {
  goalId: string;
  conversationId: string;
  direction: CrewExchangeDirection;
  summary: string;
  payload?: unknown;
}): CrewExchangeRecord {
  const createdAt = new Date().toISOString();
  const result = getDb()
    .prepare(
      `INSERT INTO crew_messages (goal_id, conversation_id, direction, summary, payload_json, created_at)
       VALUES (@goalId, @conversationId, @direction, @summary, @payloadJson, @createdAt)`,
    )
    .run({
      goalId: input.goalId,
      conversationId: input.conversationId,
      direction: input.direction,
      summary: input.summary,
      payloadJson: input.payload != null ? JSON.stringify(input.payload) : null,
      createdAt,
    });
  return rowToCrewExchange({
    id: Number(result.lastInsertRowid),
    goal_id: input.goalId,
    conversation_id: input.conversationId,
    direction: input.direction,
    summary: input.summary,
    payload_json: input.payload != null ? JSON.stringify(input.payload) : null,
    created_at: createdAt,
  });
}

export function listCrewExchanges(goalId: string, limit = 40): CrewExchangeRecord[] {
  return getDb()
    .prepare(
      `SELECT * FROM crew_messages WHERE goal_id = ? ORDER BY id DESC LIMIT ?`,
    )
    .all(goalId, limit)
    .map((row) => rowToCrewExchange(row as CrewMessageRow))
    .reverse();
}

