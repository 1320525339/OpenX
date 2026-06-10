#!/usr/bin/env node
/**
 * 轻量 Mock ACP Agent，用于 E2E 验证 Run 事件流（无 TTY 环境）。
 * 由 OPENX_ACP_MOCK=1 时 executor-acp 拉起。
 */
import { Readable, Writable } from "node:stream";
import {
  AgentSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
} from "@agentclientprotocol/sdk";

class MockAcpAgent {
  constructor(private connection: { sessionUpdate: (params: unknown) => Promise<void> }) {}

  async initialize() {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { loadSession: true },
    };
  }

  async newSession() {
    return { sessionId: "mock-session-1" };
  }

  async loadSession() {
    return {};
  }

  async authenticate() {
    return {};
  }

  async setSessionMode() {
    return {};
  }

  async cancel() {}

  async prompt(params: { sessionId: string }) {
    const { sessionId } = params;
    await this.push(sessionId, {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "Mock agent 正在组织回复…" },
    });
    await this.push(sessionId, {
      sessionUpdate: "tool_call",
      toolCallId: "mock-tool-1",
      title: "read_context",
      kind: "read",
      status: "pending",
    });
    await this.push(sessionId, {
      sessionUpdate: "tool_call_update",
      toolCallId: "mock-tool-1",
      status: "completed",
    });
    await this.push(sessionId, {
      sessionUpdate: "agent_message_chunk",
      content: {
        type: "text",
        text: "OpenX 是工头派单 + 多执行器（Pi/ACP/Connect）协同的任务调度与验收平台。",
      },
    });
    return { stopReason: "end_turn" };
  }

  private async push(sessionId: string, update: Record<string, unknown>) {
    await this.connection.sessionUpdate({ sessionId, update } as never);
  }
}

const input = Writable.toWeb(process.stdout);
const output = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
const stream = ndJsonStream(input, output);
new AgentSideConnection((conn) => new MockAcpAgent(conn), stream);
