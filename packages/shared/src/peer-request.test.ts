import { describe, expect, it } from "vitest";
import {
  PeerRequestSchema,
  PeerMentionGrantSchema,
  PeerRequestStatusSchema,
} from "./roundtable.js";

describe("peer request schemas", () => {
  it("解析 PeerRequest", () => {
    const req = PeerRequestSchema.parse({
      id: "r1",
      conversationId: "c1",
      fromParticipantId: "a",
      toParticipantId: "b",
      fromDisplayName: "产品",
      toDisplayName: "架构",
      question: "边界是什么？",
      status: "pending",
      createdAt: new Date().toISOString(),
    });
    expect(req.status).toBe("pending");
    expect(PeerRequestStatusSchema.options).toContain("auto_approved");
  });

  it("解析 PeerMentionGrant", () => {
    const g = PeerMentionGrantSchema.parse({
      conversationId: "c1",
      fromParticipantId: "a",
      toParticipantId: "b",
      createdAt: new Date().toISOString(),
    });
    expect(g.fromParticipantId).toBe("a");
  });
});
