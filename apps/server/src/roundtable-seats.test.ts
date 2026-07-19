import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ROUNDTABLE_FOREMAN_PROFILE_ID,
  DEFAULT_MODEL_REF,
} from "@openx/shared";
import { resetDb } from "./db.js";
import {
  ensureBuiltinAiProfiles,
  hasPeerMentionGrant,
  listConversationParticipants,
  seedRoundtableParticipants,
  upsertPeerMentionGrant,
  replaceConversationParticipants,
} from "./db/roundtable-repo.js";
import { app } from "./routes.js";
import {
  seedTestProjectAndConversation,
  TEST_CONVERSATION_ID,
} from "./test-helpers.js";
import { loadSettings, mergeAndSaveSettings } from "./settings-store.js";

const jsonHeaders = { "Content-Type": "application/json" };

describe("roundtable seat Agent×模型双向配置", () => {
  beforeEach(() => {
    resetDb();
    seedTestProjectAndConversation();
    ensureBuiltinAiProfiles();
  });

  afterEach(() => {
    resetDb();
  });

  it("seed 支持 participantSeats 多 modelRef", () => {
    const parts = seedRoundtableParticipants(TEST_CONVERSATION_ID, {
      seats: [
        { profileId: ROUNDTABLE_FOREMAN_PROFILE_ID, modelRef: "zen/coach-a" },
        { profileId: "product", modelRef: "zen/product-b" },
        { profileId: "architect", modelRef: "zen/arch-c" },
      ],
    });
    expect(parts).toHaveLength(3);
    expect(parts.map((p) => p.modelRef)).toEqual([
      "zen/coach-a",
      "zen/product-b",
      "zen/arch-c",
    ]);
    expect(parts.map((p) => p.profileId)).toEqual([
      ROUNDTABLE_FOREMAN_PROFILE_ID,
      "product",
      "architect",
    ]);
  });

  it("默认 seed 工头跟 coach 模型", () => {
    const settings = loadSettings();
    const coach = "custom/coach-model";
    mergeAndSaveSettings({
      ...settings,
      model: {
        ...settings.model!,
        coach,
        default: settings.model?.default ?? DEFAULT_MODEL_REF,
        pi: settings.model?.pi ?? DEFAULT_MODEL_REF,
      },
    });
    const parts = seedRoundtableParticipants(TEST_CONVERSATION_ID, []);
    const foreman = parts.find((p) => p.profileId === ROUNDTABLE_FOREMAN_PROFILE_ID);
    expect(foreman?.modelRef).toBe(coach);
  });

  it("PUT 只改 model 不丢 profile；只换 profile 可保留 model", async () => {
    seedRoundtableParticipants(TEST_CONVERSATION_ID, {
      seats: [
        { profileId: ROUNDTABLE_FOREMAN_PROFILE_ID, modelRef: "zen/coach" },
        { profileId: "product", modelRef: "zen/keep-me" },
      ],
    });
    const before = listConversationParticipants(TEST_CONVERSATION_ID);
    const product = before.find((p) => p.profileId === "product")!;

    // 只改模型
    let res = await app.request(
      `/api/roundtable/conversations/${TEST_CONVERSATION_ID}/participants`,
      {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({
          participants: before.map((p) =>
            p.id === product.id
              ? {
                  id: p.id,
                  profileId: p.profileId,
                  displayName: p.displayName,
                  modelRef: "zen/new-model",
                  enabled: p.enabled,
                  sortOrder: p.sortOrder,
                }
              : {
                  id: p.id,
                  profileId: p.profileId,
                  displayName: p.displayName,
                  modelRef: p.modelRef,
                  enabled: p.enabled,
                  sortOrder: p.sortOrder,
                },
          ),
        }),
      },
    );
    expect(res.status).toBe(200);
    let after = listConversationParticipants(TEST_CONVERSATION_ID);
    let updated = after.find((p) => p.id === product.id)!;
    expect(updated.profileId).toBe("product");
    expect(updated.modelRef).toBe("zen/new-model");

    // 只换 profile，不传 modelRef → 保留
    res = await app.request(
      `/api/roundtable/conversations/${TEST_CONVERSATION_ID}/participants`,
      {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({
          participants: after.map((p) =>
            p.id === product.id
              ? {
                  id: p.id,
                  profileId: "architect",
                  displayName: "技术架构师",
                  enabled: p.enabled,
                  sortOrder: p.sortOrder,
                }
              : {
                  id: p.id,
                  profileId: p.profileId,
                  displayName: p.displayName,
                  modelRef: p.modelRef,
                  enabled: p.enabled,
                  sortOrder: p.sortOrder,
                },
          ),
        }),
      },
    );
    expect(res.status).toBe(200);
    after = listConversationParticipants(TEST_CONVERSATION_ID);
    updated = after.find((p) => p.id === product.id)!;
    expect(updated.profileId).toBe("architect");
    expect(updated.modelRef).toBe("zen/new-model");
  });

  it("移出席位后 peer_mention_grants 失效", () => {
    const parts = seedRoundtableParticipants(TEST_CONVERSATION_ID, {
      seats: [
        { profileId: ROUNDTABLE_FOREMAN_PROFILE_ID },
        { profileId: "product" },
        { profileId: "architect" },
      ],
    });
    const product = parts.find((p) => p.profileId === "product")!;
    const architect = parts.find((p) => p.profileId === "architect")!;
    upsertPeerMentionGrant({
      conversationId: TEST_CONVERSATION_ID,
      fromParticipantId: product.id,
      toParticipantId: architect.id,
      createdAt: new Date().toISOString(),
    });
    expect(
      hasPeerMentionGrant(TEST_CONVERSATION_ID, product.id, architect.id),
    ).toBe(true);

    replaceConversationParticipants(
      TEST_CONVERSATION_ID,
      parts.filter((p) => p.id !== architect.id),
    );
    expect(
      hasPeerMentionGrant(TEST_CONVERSATION_ID, product.id, architect.id),
    ).toBe(false);
  });

  it("enable 接受 participantSeats", async () => {
    const res = await app.request(
      `/api/roundtable/conversations/${TEST_CONVERSATION_ID}/enable`,
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          participantSeats: [
            { profileId: "product", modelRef: "zen/p1" },
            { profileId: "critic", modelRef: "zen/c1" },
          ],
        }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      participants: { profileId: string; modelRef: string }[];
    };
    const byProfile = Object.fromEntries(
      body.participants.map((p) => [p.profileId, p.modelRef]),
    );
    expect(byProfile[ROUNDTABLE_FOREMAN_PROFILE_ID]).toBeTruthy();
    expect(byProfile.product).toBe("zen/p1");
    expect(byProfile.critic).toBe("zen/c1");
  });
});
