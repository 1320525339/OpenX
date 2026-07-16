import { tool } from "ai";
import { z } from "zod";

export const LIST_ATTENDEES_TOOL = "list_attendees";
export const GET_PEER_REPLIES_TOOL = "get_peer_replies";
export const REQUEST_PEER_REPLY_TOOL = "request_peer_reply";

export const MAX_PARTICIPANT_TOOL_STEPS = 6;

export type RoundtableAttendee = {
  id: string;
  displayName: string;
  profileId: string;
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
        "请求另一位圆桌成员回答某个问题。需要用户确认（或已获本会话授权）。勿臆造对方答案；提交后继续自己的发言即可。",
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
  };
}

export function formatRosterSystemBlock(attendees: RoundtableAttendee[]): string {
  const lines = attendees.map((a) => {
    const mute = a.enabled ? "" : "（静音）";
    const desc = a.description ? ` — ${a.description}` : "";
    return `- ${a.displayName}${mute} [id=${a.id}]${desc}`;
  });
  return [
    "当前圆桌出席成员：",
    ...lines,
    "可用工具：list_attendees（名簿）、get_peer_replies（查询已完成回答）、request_peer_reply（请求其他成员回答，需用户确认）。",
    "不要假装是工头，不要生成任务单。需要他人补充观点时使用 request_peer_reply，不要在正文里假装对方已回答。",
  ].join("\n");
}
