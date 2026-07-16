import { describe, expect, it, vi } from "vitest";
import { resolveForemanDirectiveAuto, isCrewDirective } from "@openx/shared";
import type { RequestPermissionRequest } from "@agentclientprotocol/sdk";
import type { ExecutorContext } from "@openx/executor-core";
import {
  parseStoredAcpSessionId,
  pickPermissionOptionFromForemanReply,
  resolvePermissionViaForeman,
} from "./acp-crew.js";

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

  const permissionParams = {
    options: [
      { optionId: "deny", kind: "reject_once", name: "拒绝" },
      { optionId: "allow_once", kind: "allow_once", name: "允许一次" },
    ],
    toolCall: { title: "写入 package.json" },
  } as unknown as RequestPermissionRequest;

  it("rejects ambiguous natural language without selectedOptionId", async () => {
    const callbacks = {
      onCrewQuestion: vi.fn(async () => ({
        kind: "directive" as const,
        message: "可以，批准一下写入 package.json",
        source: "foreman_llm" as const,
      })),
    } as unknown as ExecutorContext["callbacks"];

    const outcome = await resolvePermissionViaForeman(permissionParams, callbacks, {
      permissionMode: "full",
    });
    expect(outcome).toEqual({ outcome: "selected", optionId: "deny" });
  });

  it("pickPermissionOptionFromForemanReply only accepts selectedOptionId", () => {
    const byNl = pickPermissionOptionFromForemanReply(
      { kind: "directive", message: "拒绝这次写入", source: "foreman_llm" },
      permissionParams.options,
    );
    expect(byNl).toBeUndefined();

    const byId = pickPermissionOptionFromForemanReply(
      {
        kind: "directive",
        message: "ok",
        selectedOptionId: "allow_once",
        source: "foreman_llm",
      },
      permissionParams.options,
    );
    expect(byId?.optionId).toBe("allow_once");
  });

  it("maps foreman selectedOptionId to ACP permission option", async () => {
    const callbacks = {
      onCrewQuestion: vi.fn(async (question) => {
        const outcome = resolveForemanDirectiveAuto({ goal, question });
        if (!isCrewDirective(outcome)) throw new Error("expected directive");
        return { ...outcome, selectedOptionId: "allow_once" };
      }),
    } as unknown as ExecutorContext["callbacks"];

    const outcome = await resolvePermissionViaForeman(permissionParams, callbacks, {
      permissionMode: "full",
    });
    expect(outcome).toEqual({ outcome: "selected", optionId: "allow_once" });
    expect(callbacks.onCrewQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "写入 package.json",
        requestId: expect.any(String),
        permissionKind: "write",
      }),
    );
  });

  it("rejects when onCrewQuestion is missing (default ask_write)", async () => {
    const outcome = await resolvePermissionViaForeman(permissionParams, {
      onLog: vi.fn(),
    } as unknown as ExecutorContext["callbacks"]);
    expect(outcome).toEqual({ outcome: "selected", optionId: "deny" });
  });

  it("full mode still rejects when selectedOptionId missing", async () => {
    const callbacks = {
      onCrewQuestion: vi.fn(async () => ({
        kind: "directive" as const,
        message: "继续",
        source: "foreman_llm" as const,
      })),
    } as unknown as ExecutorContext["callbacks"];
    const outcome = await resolvePermissionViaForeman(permissionParams, callbacks, {
      permissionMode: "full",
    });
    expect(outcome).toEqual({ outcome: "selected", optionId: "deny" });
  });

  it("unattended auto-approves without asking foreman", async () => {
    const onCrewQuestion = vi.fn();
    const outcome = await resolvePermissionViaForeman(
      permissionParams,
      { onCrewQuestion } as unknown as ExecutorContext["callbacks"],
      { permissionMode: "unattended" },
    );
    expect(outcome).toEqual({ outcome: "selected", optionId: "allow_once" });
    expect(onCrewQuestion).not.toHaveBeenCalled();
  });

  it("read_only rejects write permission without asking foreman", async () => {
    const onCrewQuestion = vi.fn();
    const outcome = await resolvePermissionViaForeman(
      permissionParams,
      { onCrewQuestion } as unknown as ExecutorContext["callbacks"],
      { permissionMode: "read_only" },
    );
    expect(outcome).toEqual({ outcome: "selected", optionId: "deny" });
    expect(onCrewQuestion).not.toHaveBeenCalled();
  });

  it("ask_write rejects when foreman channel is missing", async () => {
    const outcome = await resolvePermissionViaForeman(
      permissionParams,
      { onLog: vi.fn() } as unknown as ExecutorContext["callbacks"],
      { permissionMode: "ask_write" },
    );
    expect(outcome).toEqual({ outcome: "selected", optionId: "deny" });
  });

  it("passes sessionId on CrewQuestion when provided", async () => {
    const onCrewQuestion = vi.fn(async () => ({
      kind: "directive" as const,
      message: "拒绝",
      selectedOptionId: "deny",
      source: "foreman_rule" as const,
      replyTo: "x",
    }));
    await resolvePermissionViaForeman(
      permissionParams,
      { onCrewQuestion } as unknown as ExecutorContext["callbacks"],
      { permissionMode: "ask_write", sessionId: "sess-9" },
    );
    expect(onCrewQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "sess-9" }),
    );
  });
});
