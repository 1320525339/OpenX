import { describe, expect, it } from "vitest";
import {
  LIST_ATTENDEES_TOOL,
  GET_PEER_REPLIES_TOOL,
  REQUEST_PEER_REPLY_TOOL,
  CONCLUDE_DISCUSSION_TOOL,
  buildParticipantTools,
  formatRosterSystemBlock,
} from "./participant-tools.js";

describe("participant-tools", () => {
  it("名簿文案含成员与工具说明", () => {
    const text = formatRosterSystemBlock([
      {
        id: "1",
        displayName: "工头助手",
        profileId: "foreman",
        modelRef: "zen/coach",
        enabled: true,
        description: "主持",
      },
      {
        id: "2",
        displayName: "产品",
        profileId: "product",
        modelRef: "zen/product",
        enabled: false,
      },
    ]);
    expect(text).toContain("工头助手");
    expect(text).toContain("（静音）");
    expect(text).toContain("zen/coach");
    expect(text).toContain("zen/product");
    expect(text).toContain("· zen/coach");
    expect(text).toContain(LIST_ATTENDEES_TOOL);
    expect(text).toContain(REQUEST_PEER_REPLY_TOOL);
    expect(text).toContain(CONCLUDE_DISCUSSION_TOOL);
    expect(text).toContain("不要用模型名");
    expect(text).toContain("基于其回答做反馈");
    expect(text).toContain("conclude_discussion");
  });

  it("buildParticipantTools 暴露四工具", () => {
    const tools = buildParticipantTools({
      listAttendees: () => [],
      getPeerReplies: () => [],
      requestPeerReply: async () => ({ ok: true, message: "ok" }),
      concludeDiscussion: async () => ({ ok: true, message: "done" }),
    });
    expect(tools[LIST_ATTENDEES_TOOL]).toBeDefined();
    expect(tools[GET_PEER_REPLIES_TOOL]).toBeDefined();
    expect(tools[REQUEST_PEER_REPLY_TOOL]).toBeDefined();
    expect(tools[CONCLUDE_DISCUSSION_TOOL]).toBeDefined();
  });
});
