import { describe, expect, it, vi } from "vitest";
import { resolveForemanDirectiveAuto, isCrewDirective } from "@openx/shared";
import type { RequestPermissionRequest } from "@agentclientprotocol/sdk";
import type { ExecutorContext } from "@openx/executor-core";
import { parseStoredAcpSessionId, pickPermissionOptionFromForemanReply, resolvePermissionViaForeman } from "./acp-crew.js";

describe("parseStoredAcpSessionId", () => {
  it("extracts session id from stored acp:runtime:session form", () => {
    expect(parseStoredAcpSessionId("acp:claude:sess-42", "acp:claude")).toBe("sess-42");
  });

  it("returns undefined for mismatched runtime prefix", () => {
    expect(parseStoredAcpSessionId("acp:codex:sess-1", "acp:claude")).toBeUndefined();
  });

  it("accepts legacy bare session id", () => {
    expect(parseStoredAcpSessionId("sess-legacy", "acp:claude")).toBe("sess-legacy");
  });
});

describe("resolvePermissionViaForeman", () => {
  const goal = {
    id: "g1",
    title: "t",
    conversationId: "c1",
    foremanThreadId: "c1",
    acceptance: "ok",
    executionPrompt: "run",
    constraints: [] as string[],
  };

  it("maps foreman natural language to allow option", async () => {
    const params = {
      options: [
        { optionId: "deny", kind: "reject_once", name: "拒绝" },
        { optionId: "allow_once", kind: "allow_once", name: "允许一次" },
      ],
      toolCall: { title: "写入 package.json" },
    } as unknown as RequestPermissionRequest;

    const callbacks = {
      onCrewQuestion: vi.fn(async () => ({
        kind: "directive" as const,
        message: "可以，允许写入 package.json",
        source: "foreman_llm" as const,
      })),
    } as unknown as ExecutorContext["callbacks"];

    const outcome = await resolvePermissionViaForeman(params, callbacks);
    expect(outcome).toEqual({ outcome: "selected", optionId: "allow_once" });
  });

  it("pickPermissionOptionFromForemanReply matches label in message", () => {
    const pick = pickPermissionOptionFromForemanReply(
      { kind: "directive", message: "拒绝这次写入", source: "foreman_llm" },
      [
        { optionId: "deny", kind: "reject_once", name: "拒绝" },
        { optionId: "allow_once", kind: "allow_once", name: "允许一次" },
      ] as RequestPermissionRequest["options"],
    );
    expect(pick?.optionId).toBe("deny");
  });

  it("maps foreman directive to ACP permission option id", async () => {
    const params = {
      options: [
        { optionId: "deny", kind: "reject_once", name: "拒绝" },
        { optionId: "allow_once", kind: "allow_once", name: "允许一次" },
      ],
      toolCall: { title: "写入 package.json" },
    } as unknown as RequestPermissionRequest;

    const callbacks = {
      onCrewQuestion: vi.fn(async (question) => {
        const outcome = resolveForemanDirectiveAuto({ goal, question });
        if (!isCrewDirective(outcome)) throw new Error("expected directive");
        return { ...outcome, selectedOptionId: "allow_once" };
      }),
    } as unknown as ExecutorContext["callbacks"];

    const outcome = await resolvePermissionViaForeman(params, callbacks);
    expect(outcome).toEqual({ outcome: "selected", optionId: "allow_once" });
    expect(callbacks.onCrewQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "写入 package.json" }),
    );
  });

  it("auto-approves when onCrewQuestion is missing", async () => {
    const params = {
      options: [{ optionId: "allow_once", kind: "allow_once", name: "允许" }],
    } as unknown as RequestPermissionRequest;
    const outcome = await resolvePermissionViaForeman(params, {
      onLog: vi.fn(),
    } as unknown as ExecutorContext["callbacks"]);
    expect(outcome).toEqual({ outcome: "selected", optionId: "allow_once" });
  });
});
