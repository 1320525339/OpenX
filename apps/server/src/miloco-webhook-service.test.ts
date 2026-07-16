import { afterEach, describe, expect, it } from "vitest";
import {
  buildGoalDraft,
  ensureMilocoIdempotencyKey,
  extractMilocoEventField,
  isDuplicateInteractive,
  resetMilocoWebhookIdempotencyForTests,
  resolveMilocoIdempotencyKey,
} from "./miloco-webhook-service.js";

describe("miloco-webhook-service interactive", () => {
  afterEach(() => {
    resetMilocoWebhookIdempotencyForTests();
  });

  const interactiveMessage = [
    "[感知引擎]语音提醒：",
    "来源：客厅的小米C700",
    "说话人：用户",
    "语音指令：打开客厅灯",
  ].join("\n");

  const basePayload = {
    message: interactiveMessage,
    sessionKey: "agent:main:miloco",
    lane: "miloco-interactive",
    traceId: "test-trace",
    idempotencyKey: "test-trace",
    timeoutMs: 30_000,
  };

  it("buildGoalDraft uses interactive acceptance and execution prompt", () => {
    const draft = buildGoalDraft(basePayload);
    expect(draft.title).toContain("语音/交互");
    expect(draft.acceptance).toContain("play-text");
    expect(draft.executionPrompt).toContain("【Miloco 语音交互】");
    expect(draft.executionPrompt).toContain("禁止默认 execute-text-directive");
  });

  it("extractMilocoEventField parses vertical key:value lines", () => {
    expect(extractMilocoEventField(interactiveMessage, "来源")).toBe("客厅的小米C700");
    expect(extractMilocoEventField(interactiveMessage, "语音指令")).toBe("打开客厅灯");
  });

  it("deduplicates identical interactive commands within 30s", () => {
    const first = isDuplicateInteractive(basePayload);
    const second = isDuplicateInteractive({ ...basePayload, traceId: "d2" });
    expect(first).toBe(false);
    expect(second).toBe(true);
  });
});

describe("miloco idempotency key", () => {
  it("prefers idempotencyKey over traceId", () => {
    expect(
      resolveMilocoIdempotencyKey({
        idempotencyKey: "idem-1",
        traceId: "trace-1",
      }),
    ).toBe("idem-1");
  });

  it("falls back to traceId when idempotencyKey missing", () => {
    expect(resolveMilocoIdempotencyKey({ traceId: "trace-only" })).toBe("trace-only");
    expect(resolveMilocoIdempotencyKey({ idempotencyKey: "  ", traceId: "trace-2" })).toBe(
      "trace-2",
    );
  });

  it("returns null when both keys are empty (never empty string)", () => {
    expect(resolveMilocoIdempotencyKey({})).toBeNull();
    expect(resolveMilocoIdempotencyKey({ idempotencyKey: "", traceId: "" })).toBeNull();
    expect(resolveMilocoIdempotencyKey({ idempotencyKey: "  ", traceId: "\t" })).toBeNull();
  });

  it("ensureMilocoIdempotencyKey never returns empty and generates unique fallbacks", () => {
    const a = ensureMilocoIdempotencyKey({});
    const b = ensureMilocoIdempotencyKey({ idempotencyKey: "", traceId: "  " });
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
    expect(a.startsWith("server:")).toBe(true);
    expect(ensureMilocoIdempotencyKey({ idempotencyKey: "keep" })).toBe("keep");
  });
});
