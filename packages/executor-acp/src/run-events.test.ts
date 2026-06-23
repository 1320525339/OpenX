import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RunEventEmitter } from "@openx/executor-core";
import { handleAcpSessionUpdate } from "./session-updates.js";

function mockCtx() {
  const runEvents: Array<{ type: string; [key: string]: unknown }> = [];
  const run = new RunEventEmitter(async (event) => {
    runEvents.push(event);
  });
  const state = {
    assistantText: "",
    toolCount: 0,
    toolNames: new Map<string, string>(),
    pendingTools: new Map(),
    deliverables: [],
  };
  const callbacks = {
    onProgress: vi.fn(async () => {}),
    onLog: vi.fn(async () => {}),
    onComplete: vi.fn(async () => {}),
    onFail: vi.fn(async () => {}),
  };
  return { run, runEvents, state, callbacks };
}

describe("handleAcpSessionUpdate run events", () => {
  it("maps agent_message_chunk to text.delta", async () => {
    const { run, runEvents, state, callbacks } = mockCtx();
    await handleAcpSessionUpdate(
      "acp:codex",
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "hello" },
      },
      { callbacks, state, run },
    );
    await run.finish();
    expect(state.assistantText).toBe("hello");
    expect(runEvents.some((e) => e.type === "text.delta")).toBe(true);
  });

  it("maps agent_thought_chunk to thinking.delta", async () => {
    const { run, runEvents, state, callbacks } = mockCtx();
    await handleAcpSessionUpdate(
      "acp:codex",
      {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "planning next step" },
      },
      { callbacks, state, run },
    );
    await run.finish();
    expect(runEvents.some((e) => e.type === "thinking.delta")).toBe(true);
    expect(runEvents.some((e) => e.type === "status" && String(e.message).startsWith("思考 ›"))).toBe(
      false,
    );
  });

  it("maps plan to status", async () => {
    const { run, runEvents, state, callbacks } = mockCtx();
    await handleAcpSessionUpdate(
      "acp:codex",
      {
        sessionUpdate: "plan",
        entries: [{ content: "read README", priority: "medium", status: "pending" }],
      },
      { callbacks, state, run },
    );
    const status = runEvents.find((e) => e.type === "status");
    expect(status?.message).toMatch(/^计划 ›/);
  });

  it("maps tool_call lifecycle to tool.start / tool.end", async () => {
    const { run, runEvents, state, callbacks } = mockCtx();
    await handleAcpSessionUpdate(
      "acp:codex",
      {
        sessionUpdate: "tool_call",
        toolCallId: "tc1",
        title: "read_file",
        kind: "read",
      },
      { callbacks, state, run },
    );
    await handleAcpSessionUpdate(
      "acp:codex",
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tc1",
        status: "completed",
      },
      { callbacks, state, run },
    );
    expect(runEvents.some((e) => e.type === "tool.start" && e.tool === "read_file")).toBe(true);
    expect(runEvents.some((e) => e.type === "tool.end" && e.tool === "read_file")).toBe(true);
  });

  it("attaches fileDiff when file tool completes with baseline", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "openx-acp-diff-"));
    writeFileSync(join(workspaceRoot, "a.ts"), "alpha\n");
    const { run, runEvents, state, callbacks } = mockCtx();
    await handleAcpSessionUpdate(
      "acp:codex",
      {
        sessionUpdate: "tool_call",
        toolCallId: "tc-edit",
        title: "edit_file",
        kind: "edit",
        rawInput: { path: "a.ts" },
      },
      { callbacks, state, run, workspaceRoot },
    );
    await handleAcpSessionUpdate(
      "acp:codex",
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tc-edit",
        status: "completed",
        rawOutput: { content: "beta\n" },
      } as never,
      { callbacks, state, run, workspaceRoot },
    );
    const end = runEvents.find((e) => e.type === "tool.end" && e.toolCallId === "tc-edit");
    const fileDiff = end?.fileDiff as
      | { path?: string; added?: number; removed?: number }
      | undefined;
    expect(fileDiff?.path).toBe("a.ts");
    expect(fileDiff?.added).toBeGreaterThan(0);
    expect(fileDiff?.removed).toBeGreaterThan(0);
  });
});
