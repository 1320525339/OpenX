import type { OperatorActionProposal } from "@openx/coach";
import type { CoachOperatorActionMessage } from "@openx/shared";
import { getDb, touchConversation } from "./db.js";
import { broadcast } from "./sse.js";

export function saveCoachOperatorActionMessage(
  conversationId: string,
  action: OperatorActionProposal,
): CoachOperatorActionMessage {
  const timestamp = new Date().toISOString();
  const meta = JSON.stringify({
    pendingActionId: action.pendingActionId,
    method: action.method,
    path: action.path,
    summary: action.summary,
    reason: action.reason,
    status: "pending",
  });
  const result = getDb()
    .prepare(
      `INSERT INTO coach_messages (conversation_id, goal_id, role, text, kind, meta_json, created_at)
       VALUES (?, NULL, 'coach', ?, 'operator_action', ?, ?)`,
    )
    .run(conversationId, action.summary, meta, timestamp);
  touchConversation(conversationId);
  const msg: CoachOperatorActionMessage = {
    id: Number(result.lastInsertRowid),
    conversationId,
    kind: "operator_action",
    timestamp,
    operatorAction: {
      pendingActionId: action.pendingActionId,
      method: action.method,
      path: action.path,
      summary: action.summary,
      reason: action.reason,
      status: "pending",
    },
  };
  broadcast({
    type: "coach.message",
    conversationId,
    message: msg,
  });
  return msg;
}

export function updateCoachOperatorActionStatus(
  messageId: number,
  status: "confirmed" | "dismissed",
): void {
  const row = getDb()
    .prepare(`SELECT meta_json FROM coach_messages WHERE id = ? AND kind = 'operator_action'`)
    .get(messageId) as { meta_json: string } | undefined;
  if (!row?.meta_json) return;
  const meta = JSON.parse(row.meta_json) as Record<string, unknown>;
  meta.status = status;
  getDb()
    .prepare(`UPDATE coach_messages SET meta_json = ? WHERE id = ?`)
    .run(JSON.stringify(meta), messageId);
}
