import { tool } from "ai";
import { z } from "zod";

export const LIST_ATTENDEES_TOOL = "list_attendees";
export const GET_PEER_REPLIES_TOOL = "get_peer_replies";
export const REQUEST_PEER_REPLY_TOOL = "request_peer_reply";
export const CONCLUDE_DISCUSSION_TOOL = "conclude_discussion";

export const MAX_PARTICIPANT_TOOL_STEPS = 6;

export type RoundtableAttendee = {
  id: string;
  displayName: string;
  profileId: string;
  modelRef?: string;
  description?: string;
  enabled: boolean;
};

export type PeerReplySnippet = {
  speakerId: string;
  displayName: string;
  text: string;
  roundId?: string;
  messageId: number;
};

export type ParticipantToolHandlers = {
  listAttendees: () => RoundtableAttendee[] | Promise<RoundtableAttendee[]>;
  getPeerReplies: (input: {
    speakerIds?: string[];
    roundId?: string;
    limit?: number;
  }) => PeerReplySnippet[] | Promise<PeerReplySnippet[]>;
  requestPeerReply: (input: {
    targetParticipantId?: string;
    targetDisplayName?: string;
    question: string;
  }) =>
    | { ok: boolean; message: string; requestId?: string; autoApproved?: boolean }
    | Promise<{ ok: boolean; message: string; requestId?: string; autoApproved?: boolean }>;
  concludeDiscussion: (input: {
    summary: string;
    goalMet: boolean;
    nextSteps?: string;
  }) =>
    | { ok: boolean; message: string }
    | Promise<{ ok: boolean; message: string }>;
};

export function buildParticipantTools(handlers: ParticipantToolHandlers) {
  return {
    [LIST_ATTENDEES_TOOL]: tool({
      description:
        "列出当前圆桌出席成员（id、显示名、职责简述、是否静音）。需要知道会议有谁时调用。",
      inputSchema: z.object({}),
      execute: async () => handlers.listAttendees(),
    }),
    [GET_PEER_REPLIES_TOOL]: tool({
      description:
        "查询其他成员（或自己）已完成的回答摘要。可按 speakerIds / roundId 过滤。发散并行时同轮未完成的回答可能尚不可见。",
      inputSchema: z.object({
        speakerIds: z.array(z.string()).optional().describe("参与者 id 列表，省略则返回近期完成回复"),
        roundId: z.string().optional(),
        limit: z.number().int().min(1).max(20).optional(),
      }),
      execute: async (input: {
        speakerIds?: string[];
        roundId?: string;
        limit?: number;
      }) => handlers.getPeerReplies(input),
    }),
    [REQUEST_PEER_REPLY_TOOL]: tool({
      description:
        "请求另一位圆桌成员回答某个问题。需要用户确认（或已获本会话授权）。勿臆造对方答案；对方答完后系统会再请你基于其回答做反馈。信息不足时再用本工具追问，勿无限循环。",
      inputSchema: z.object({
        targetParticipantId: z.string().optional().describe("目标成员 id（优先）"),
        targetDisplayName: z.string().optional().describe("目标显示名（与 id 二选一）"),
        question: z.string().min(1).describe("希望对方回答的问题"),
      }),
      execute: async (input: {
        targetParticipantId?: string;
        targetDisplayName?: string;
        question: string;
      }) => handlers.requestPeerReply(input),
    }),
    [CONCLUDE_DISCUSSION_TOOL]: tool({
      description:
        "结束当前追问链并给出总结。当讨论目标已达成、或已有足够信息可收束时必须调用；调用后勿再 request_peer_reply。",
      inputSchema: z.object({
        summary: z.string().min(1).describe("对追问链的总结（共识/结论）"),
        goalMet: z.boolean().describe("本轮讨论目标是否已达成"),
        nextSteps: z.string().optional().describe("可执行的下一步建议"),
      }),
      execute: async (input: {
        summary: string;
        goalMet: boolean;
        nextSteps?: string;
      }) => handlers.concludeDiscussion(input),
    }),
  };
}

export function formatRosterSystemBlock(attendees: RoundtableAttendee[]): string {
  const lines = attendees.map((a) => {
    const mute = a.enabled ? "" : "（静音）";
    const model = a.modelRef ? ` · ${a.modelRef}` : "";
    const desc = a.description ? ` — ${a.description}` : "";
    return `- ${a.displayName}${mute} [id=${a.id}]${model}${desc}`;
  });
  return [
    "当前圆桌出席成员：",
    ...lines,
    "可用工具：list_attendees（名簿）、get_peer_replies（查询已完成回答）、request_peer_reply（请求其他成员回答，需用户确认）、conclude_discussion（目标达成或信息足够时总结并结束追问链）。",
    "不要假装是工头，不要生成任务单。需要他人补充观点时使用 request_peer_reply，不要在正文里假装对方已回答；对方答完后系统会再请你基于其回答做反馈。",
    "信息足够或目标已达成时调用 conclude_discussion 收束；勿无限追问。",
    "名簿中的模型仅供参考；点名请用席位 id 或显示名，不要用模型名。",
  ].join("\n");
}

/**
 * 包装工具 handlers：在调用结果上追加中文摘要，供正文为空时合成可见回复。
 * 不改变工具返回值语义。
 */
export function wrapHandlersWithToolNotes(
  handlers: ParticipantToolHandlers,
  toolNotes: string[],
): ParticipantToolHandlers {
  return {
    listAttendees: async () => {
      const list = await handlers.listAttendees();
      toolNotes.push(`已查询名簿（${list.length} 人）。`);
      return list;
    },
    getPeerReplies: async (input) => {
      const replies = await handlers.getPeerReplies(input);
      toolNotes.push(
        replies.length > 0
          ? `已查询回答摘要（${replies.length} 条）。`
          : "已查询回答摘要（暂无完成回复）。",
      );
      return replies;
    },
    requestPeerReply: async (input) => {
      const result = await handlers.requestPeerReply(input);
      if (result.ok) {
        const whom =
          input.targetDisplayName?.trim() ||
          input.targetParticipantId ||
          "对方";
        toolNotes.push(
          result.autoApproved
            ? `已自动获准：请求「${whom}」回答。`
            : `已向用户发起确认：请求「${whom}」回答。`,
        );
        if (result.message.trim()) toolNotes.push(result.message.trim());
      } else if (result.message.trim()) {
        toolNotes.push(result.message.trim());
      }
      return result;
    },
    concludeDiscussion: async (input) => {
      const result = await handlers.concludeDiscussion(input);
      toolNotes.push(
        result.ok
          ? `已结束追问链并写入总结${input.goalMet ? "（目标已达成）" : ""}。`
          : result.message.trim() || "结束追问链失败。",
      );
      return result;
    },
  };
}

/** 正文为空时，用工具笔记合成用户可见文案 */
export function synthesizeToolNotesText(toolNotes: string[]): string {
  const notes = toolNotes.map((n) => n.trim()).filter(Boolean);
  if (notes.length === 0) return "";
  return notes.join("\n");
}
