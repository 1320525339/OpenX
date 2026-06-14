#!/usr/bin/env node
/**
 * 轻量 Mock ACP Agent，用于 E2E 验证 Run 事件流与工头↔施工队对话。
 * 由 OPENX_ACP_MOCK=1 时 executor-acp 拉起。
 *
 * 行为：
 * - 小游戏任务：crew-question → 工头回复 → 模拟打砖块
 * - ACP 路由任务（cli-full-flow）：crew-question → 工头回复 → 写入 acp-route.txt
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable, Writable } from "node:stream";
import {
  AgentSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
} from "@agentclientprotocol/sdk";

const CREW_QUESTION_BLOCK = [
  "分析任务：需要先确认实现方案。",
  "```crew-question",
  JSON.stringify({
    kind: "question",
    prompt: "请确认是否先读 cli.ts 再写产物文件",
    options: [
      { id: "a", label: "方案A：先读源码" },
      { id: "b", label: "方案B：直接写模板" },
    ],
  }),
  "```",
].join("\n");

const GAME_DONE_TEXT = [
  "已按工头选定的方案B（打砖块）完成实现。",
  "在 e2e-crew-game/index.html 创建了可双击打开的 Canvas 打砖块小游戏：",
  "- 左右方向键移动挡板",
  "- 空格开始/重开",
  "游戏可直接在浏览器中运行，无需构建步骤。",
].join("\n");

const ROUTE_DONE_TEXT = [
  "已按工头确认的方案完成 ACP 路由解析任务。",
  "写入 scripts/e2e-artifacts/cli-full-flow/acp-route.txt：",
  "METHOD=PUT",
  "PATH=/api/cli/acp-config/:executorId",
  "【返工完成】",
].join("\n");

function isRouteTask(promptText: string): boolean {
  return /acp-route\.txt|cli-full-flow/.test(promptText);
}

function writeRouteArtifact(cwd: string) {
  const rel = join("scripts", "e2e-artifacts", "cli-full-flow", "acp-route.txt");
  const abs = join(cwd, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, "METHOD=PUT\nPATH=/api/cli/acp-config/:executorId\n", "utf8");
}

class MockAcpAgent {
  private cwd = process.cwd();
  private routeTask = false;

  constructor(private connection: { sessionUpdate: (params: unknown) => Promise<void> }) {}

  async initialize() {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { loadSession: true },
    };
  }

  async newSession(params?: { cwd?: string }) {
    if (params?.cwd) this.cwd = params.cwd;
    return { sessionId: "mock-session-1" };
  }

  async loadSession(params?: { cwd?: string }) {
    if (params?.cwd) this.cwd = params.cwd;
    return {};
  }

  async authenticate() {
    return {};
  }

  async setSessionMode() {
    return {};
  }

  async cancel() {}

  async prompt(params: { sessionId: string; prompt?: { type: string; text?: string }[] }) {
    const { sessionId } = params;
    const promptText = (params.prompt ?? [])
      .map((p) => (p.type === "text" ? p.text ?? "" : ""))
      .join("\n");
    const isForemanFollowUp = /(?:^|\n)【工头】\n/.test(promptText);
    if (!isForemanFollowUp) {
      this.routeTask = isRouteTask(promptText);
    }
    const routeTask = this.routeTask;
    const isRework = /【返工完成】/.test(promptText) || /返工/.test(promptText);

    await this.push(sessionId, {
      sessionUpdate: "agent_thought_chunk",
      content: {
        type: "text",
        text: isForemanFollowUp
          ? routeTask
            ? "收到工头指令，开始解析 ACP 路由…"
            : "收到工头指令，开始实现打砖块…"
          : "Mock agent 分析任务需求…",
      },
    });

    if (isForemanFollowUp || (routeTask && isRework)) {
      const toolId = routeTask ? "mock-write-route" : "mock-write-game";
      const title = routeTask
        ? "write scripts/e2e-artifacts/cli-full-flow/acp-route.txt"
        : "write e2e-crew-game/index.html";
      await this.push(sessionId, {
        sessionUpdate: "tool_call",
        toolCallId: toolId,
        title,
        kind: "edit",
        status: "pending",
      });
      if (routeTask) writeRouteArtifact(this.cwd);
      await this.push(sessionId, {
        sessionUpdate: "tool_call_update",
        toolCallId: toolId,
        status: "completed",
      });
      const doneText =
        routeTask && isRework
          ? ROUTE_DONE_TEXT
          : routeTask
            ? ROUTE_DONE_TEXT.replace("\n【返工完成】", "")
            : GAME_DONE_TEXT;
      await this.push(sessionId, {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: doneText },
      });
    } else {
      await this.push(sessionId, {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: CREW_QUESTION_BLOCK },
      });
    }

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
