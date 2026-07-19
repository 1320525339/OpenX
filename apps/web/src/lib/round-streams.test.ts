import { describe, expect, it } from "vitest";
import {
  applyChatReplyCompleted,
  applyChatReplyDelta,
  applyChatReplyFailed,
  applyChatReplyStarted,
  clearRoundStreamsForConversation,
} from "./round-streams";

describe("round-streams reducer helpers", () => {
  it("多路 started + delta 互不干扰", () => {
    let streams = applyChatReplyStarted(
      {},
      {
        messageId: 1,
        conversationId: "c1",
        roundId: "r1",
        speakerId: "a",
        streamId: "s1",
      },
    );
    streams = applyChatReplyStarted(streams, {
      messageId: 2,
      conversationId: "c1",
      roundId: "r1",
      speakerId: "b",
      streamId: "s2",
    });
    streams = applyChatReplyDelta(streams, {
      messageId: 1,
      conversationId: "c1",
      roundId: "r1",
      speakerId: "a",
      streamId: "s1",
      delta: "你好",
    });
    streams = applyChatReplyDelta(streams, {
      messageId: 2,
      conversationId: "c1",
      roundId: "r1",
      speakerId: "b",
      streamId: "s2",
      delta: "世界",
    });
    expect(streams[1].text).toBe("你好");
    expect(streams[2].text).toBe("世界");
  });

  it("忽略错误 streamId 的 delta", () => {
    let streams = applyChatReplyStarted(
      {},
      {
        messageId: 1,
        conversationId: "c1",
        roundId: "r1",
        speakerId: "a",
        streamId: "s1",
      },
    );
    streams = applyChatReplyDelta(streams, {
      messageId: 1,
      conversationId: "c1",
      roundId: "r1",
      speakerId: "a",
      streamId: "wrong",
      delta: "x",
    });
    expect(streams[1].text).toBe("");
  });

  it("completed / failed / clear", () => {
    let streams = applyChatReplyStarted(
      {},
      {
        messageId: 1,
        conversationId: "c1",
        roundId: "r1",
        speakerId: "a",
        streamId: "s1",
      },
    );
    streams = applyChatReplyCompleted(streams, { messageId: 1, text: "完" });
    expect(streams[1].status).toBe("completed");
    expect(streams[1].text).toBe("完");

    streams = applyChatReplyFailed(streams, { messageId: 1, error: "boom" });
    expect(streams[1].status).toBe("failed");

    streams = applyChatReplyStarted(streams, {
      messageId: 2,
      conversationId: "c2",
      roundId: "r2",
      speakerId: "b",
      streamId: "s2",
    });
    streams = clearRoundStreamsForConversation(streams, "c1");
    expect(streams[1]).toBeUndefined();
    expect(streams[2]).toBeDefined();
  });

  it("completed 空串不覆盖已有 text", () => {
    let streams = applyChatReplyStarted(
      {},
      {
        messageId: 1,
        conversationId: "c1",
        roundId: "r1",
        speakerId: "a",
        streamId: "s1",
      },
    );
    streams = applyChatReplyDelta(streams, {
      messageId: 1,
      conversationId: "c1",
      roundId: "r1",
      speakerId: "a",
      streamId: "s1",
      delta: "已有",
    });
    streams = applyChatReplyCompleted(streams, { messageId: 1, text: "" });
    expect(streams[1].text).toBe("已有");
    expect(streams[1].status).toBe("completed");
  });

  it("orphan completed 也能落库流文本", () => {
    const streams = applyChatReplyCompleted(
      {},
      {
        messageId: 3,
        conversationId: "c1",
        streamId: "s3",
        text: "迟到完成",
      },
    );
    expect(streams[3].status).toBe("completed");
    expect(streams[3].text).toBe("迟到完成");
  });
});
