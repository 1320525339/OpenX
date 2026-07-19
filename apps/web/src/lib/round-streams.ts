export type RoundReplyStreamState = {
  conversationId: string;
  roundId: string;
  messageId: number;
  speakerId: string;
  streamId: string;
  text: string;
  status: "streaming" | "completed" | "failed";
  error?: string;
};

export type RoundStreamsMap = Record<number, RoundReplyStreamState>;

export function applyChatReplyStarted(
  streams: RoundStreamsMap,
  event: {
    messageId: number;
    conversationId: string;
    roundId: string;
    speakerId: string;
    streamId: string;
  },
): RoundStreamsMap {
  return {
    ...streams,
    [event.messageId]: {
      conversationId: event.conversationId,
      roundId: event.roundId,
      messageId: event.messageId,
      speakerId: event.speakerId,
      streamId: event.streamId,
      text: "",
      status: "streaming",
    },
  };
}

export function applyChatReplyDelta(
  streams: RoundStreamsMap,
  event: {
    messageId: number;
    conversationId: string;
    roundId: string;
    speakerId: string;
    streamId: string;
    delta: string;
  },
): RoundStreamsMap {
  const prev = streams[event.messageId];
  if (prev && prev.streamId !== event.streamId) return streams;
  const base: RoundReplyStreamState = prev ?? {
    conversationId: event.conversationId,
    roundId: event.roundId,
    messageId: event.messageId,
    speakerId: event.speakerId,
    streamId: event.streamId,
    text: "",
    status: "streaming",
  };
  return {
    ...streams,
    [event.messageId]: {
      ...base,
      text: base.text + event.delta,
      status: "streaming",
    },
  };
}

export function applyChatReplyCompleted(
  streams: RoundStreamsMap,
  event: {
    messageId: number;
    conversationId?: string;
    roundId?: string;
    speakerId?: string;
    streamId?: string;
    text?: string;
  },
): RoundStreamsMap {
  const prev = streams[event.messageId];
  const base: RoundReplyStreamState = prev ?? {
    conversationId: event.conversationId ?? "",
    roundId: event.roundId ?? "",
    messageId: event.messageId,
    speakerId: event.speakerId ?? "",
    streamId: event.streamId ?? "",
    text: "",
    status: "streaming",
  };
  return {
    ...streams,
    [event.messageId]: {
      ...base,
      text: event.text || base.text,
      status: "completed",
      streamId: event.streamId || base.streamId,
    },
  };
}

export function applyChatReplyFailed(
  streams: RoundStreamsMap,
  event: {
    messageId: number;
    conversationId?: string;
    roundId?: string;
    speakerId?: string;
    streamId?: string;
    error?: string;
  },
): RoundStreamsMap {
  const prev = streams[event.messageId];
  const base: RoundReplyStreamState = prev ?? {
    conversationId: event.conversationId ?? "",
    roundId: event.roundId ?? "",
    messageId: event.messageId,
    speakerId: event.speakerId ?? "",
    streamId: event.streamId ?? "",
    text: "",
    status: "streaming",
  };
  return {
    ...streams,
    [event.messageId]: {
      ...base,
      status: "failed",
      error: event.error,
      streamId: event.streamId || base.streamId,
    },
  };
}

/** 清空某会话的流，或清空全部 */
export function clearRoundStreamsForConversation(
  streams: RoundStreamsMap,
  conversationId?: string | null,
): RoundStreamsMap {
  if (!conversationId) return {};
  const next: RoundStreamsMap = {};
  for (const [k, v] of Object.entries(streams)) {
    if (v.conversationId !== conversationId) next[Number(k)] = v;
  }
  return next;
}
