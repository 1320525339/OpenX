import {
  getConversationById,
  getProjectById,
  listConversations,
  clearConversationThread,
  reassignGoalsToProjectVault,
  deleteConversationShell,
  isProjectGoalVaultConversationId,
  touchConversation,
  type ClearConversationThreadResult,
} from "./db.js";
import { purgeSseEventsForConversation } from "./db/sse-repo.js";
import {
  isSystemConversationId,
  isSystemProjectId,
} from "./system-workspace.js";
import { cancelActiveRounds } from "./roundtable-service.js";
import { dismissPendingOperatorActionsForConversation } from "./operator-gateway.js";
import { abortCoachStreamsForConversation } from "./coach-stream.js";
import { broadcast } from "./sse.js";

export type ForgetLevel = "clear_thread" | "delete_conversation";

export type ForgetReport = {
  level: ForgetLevel | "forget_project";
  conversationIds: string[];
  messagesDeleted: number;
  checkpointsDeleted: number;
  crewDeleted: number;
  goalsReassigned: number;
  ssePurged: number;
  operatorDismissed: number;
};

export class ConversationForgetError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ConversationForgetError";
    this.status = status;
  }
}

function emptyCounts(): ClearConversationThreadResult {
  return { messagesDeleted: 0, checkpointsDeleted: 0, crewDeleted: 0 };
}

function stopConversationRuntime(conversationId: string): number {
  abortCoachStreamsForConversation(conversationId);
  cancelActiveRounds(conversationId);
  return dismissPendingOperatorActionsForConversation(conversationId);
}

/**
 * 清空或删除单个会话的聊天语境。
 * - clear_thread：系统会话与用户会话均允许
 * - delete_conversation：系统会话禁止；goals 迁入项目任务保管箱后删壳
 */
export function forgetConversation(
  conversationId: string,
  level: ForgetLevel,
): ForgetReport {
  const conv = getConversationById(conversationId);
  if (!conv) {
    throw new ConversationForgetError("对话不存在", 404);
  }

  if (level === "delete_conversation") {
    if (isSystemConversationId(conversationId)) {
      throw new ConversationForgetError("系统会话不可删除，请使用清空对话", 403);
    }
    if (isProjectGoalVaultConversationId(conversationId)) {
      throw new ConversationForgetError(
        "任务保管箱会话不可删除（用于挂靠已保留的任务）",
        403,
      );
    }
  }

  const operatorDismissed = stopConversationRuntime(conversationId);
  const cleared = clearConversationThread(conversationId);
  const ssePurged = purgeSseEventsForConversation(conversationId);

  let goalsReassigned = 0;
  if (level === "delete_conversation") {
    goalsReassigned = reassignGoalsToProjectVault(conversationId);
    const ok = deleteConversationShell(conversationId);
    if (!ok) {
      throw new ConversationForgetError("删除会话失败", 500);
    }
    broadcast({
      type: "conversation.deleted",
      conversationId,
      timestamp: new Date().toISOString(),
    });
  } else {
    touchConversation(conversationId);
    broadcast({
      type: "conversation.cleared",
      conversationId,
      timestamp: new Date().toISOString(),
    });
  }

  return {
    level,
    conversationIds: [conversationId],
    messagesDeleted: cleared.messagesDeleted,
    checkpointsDeleted: cleared.checkpointsDeleted,
    crewDeleted: cleared.crewDeleted,
    goalsReassigned,
    ssePurged,
    operatorDismissed,
  };
}

/**
 * 项目级遗忘会话：
 * - 用户项目：非保管箱会话全部 delete_conversation
 * - 系统项目：仅对系统会话 clear_thread（不删壳）
 */
export function forgetProjectConversations(projectId: string): ForgetReport {
  const project = getProjectById(projectId);
  if (!project) {
    throw new ConversationForgetError("项目不存在", 404);
  }

  const conversations = listConversations(projectId);
  const aggregate: ForgetReport = {
    level: "forget_project",
    conversationIds: [],
    messagesDeleted: 0,
    checkpointsDeleted: 0,
    crewDeleted: 0,
    goalsReassigned: 0,
    ssePurged: 0,
    operatorDismissed: 0,
  };

  if (isSystemProjectId(projectId)) {
    for (const conv of conversations) {
      if (!isSystemConversationId(conv.id)) continue;
      const r = forgetConversation(conv.id, "clear_thread");
      mergeReport(aggregate, r);
    }
    return aggregate;
  }

  for (const conv of conversations) {
    if (isProjectGoalVaultConversationId(conv.id)) {
      // 保管箱：只清空聊天，保留壳挂靠任务
      const r = forgetConversation(conv.id, "clear_thread");
      mergeReport(aggregate, r);
      continue;
    }
    const r = forgetConversation(conv.id, "delete_conversation");
    mergeReport(aggregate, r);
  }

  return aggregate;
}

function mergeReport(into: ForgetReport, from: ForgetReport): void {
  into.conversationIds.push(...from.conversationIds);
  into.messagesDeleted += from.messagesDeleted;
  into.checkpointsDeleted += from.checkpointsDeleted;
  into.crewDeleted += from.crewDeleted;
  into.goalsReassigned += from.goalsReassigned;
  into.ssePurged += from.ssePurged;
  into.operatorDismissed += from.operatorDismissed;
}

/** 测试辅助 */
export function __emptyForgetCountsForTests(): ClearConversationThreadResult {
  return emptyCounts();
}
