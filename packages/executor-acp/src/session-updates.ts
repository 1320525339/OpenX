import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { ACP_RUNTIMES, type AcpRuntimeId } from "@openx/shared";
import type { RunEventEmitter, ExecutorContext } from "@openx/executor-core";
import {
  extractDeliverableFromTool,
  extractPathFromToolArgs,
  mergeDeliverable,
  readWorkspaceFileBaseline,
  toolFileDiffFromDeliverable,
} from "@openx/executor-core";
import type { GoalDeliverable } from "@openx/shared";

export type AcpPendingTool = {
  tool: string;
  path?: string;
  previousContent?: string;
  args: unknown;
};

export type AcpSessionState = {
  assistantText: string;
  toolCount: number;
  toolNames: Map<string, string>;
  pendingTools: Map<string, AcpPendingTool>;
  /** ACP 文件变更交付物积累（从 tool_call 事件提取） */
  deliverables: GoalDeliverable[];
};

function extractToolUpdateText(update: SessionUpdate & { sessionUpdate: "tool_call_update" }): string | undefined {
  const raw = update as {
    content?: { type?: string; text?: string }[];
    rawOutput?: unknown;
  };
  if (Array.isArray(raw.content)) {
    const text = raw.content
      .map((c) => (c.type === "text" ? c.text ?? "" : ""))
      .join("")
      .trim();
    if (text) return text;
  }
  if (raw.rawOutput != null) {
    const serialized = JSON.stringify(raw.rawOutput);
    if (serialized && serialized !== "{}") return serialized.slice(0, 200);
  }
  return undefined;
}

function extractRawOutput(update: SessionUpdate & { sessionUpdate: "tool_call_update" }): unknown {
  return (update as { rawOutput?: unknown }).rawOutput;
}

export async function handleAcpSessionUpdate(
  runtimeId: AcpRuntimeId,
  update: SessionUpdate,
  ctx: {
    callbacks: ExecutorContext["callbacks"];
    state: AcpSessionState;
    run: RunEventEmitter | null;
    workspaceRoot?: string;
  },
): Promise<void> {
  const { callbacks, state, run, workspaceRoot } = ctx;
  const config = ACP_RUNTIMES[runtimeId];

  switch (update.sessionUpdate) {
    case "agent_message_chunk":
      if (update.content.type === "text") {
        state.assistantText += update.content.text;
        await run?.textDelta(update.content.text);
        await callbacks.onProgress(
          Math.min(88, 20 + Math.floor(state.assistantText.length / 100)),
          `${config.label} 生成中…`,
        );
      }
      break;
    case "agent_thought_chunk":
      if (update.content.type === "text" && update.content.text.trim()) {
        await run?.thinkingDelta(update.content.text);
        const snippet = update.content.text.trim().slice(0, 120);
        await callbacks.onLog("debug", `[${runtimeId}] 思考 › ${snippet}`);
      }
      break;
    case "plan": {
      const entries = update.entries ?? [];
      const first = entries[0]?.content?.trim().slice(0, 80) ?? "";
      const suffix = first ? `: ${first}` : "";
      await run?.status(`计划 › ${entries.length} 步${suffix}`);
      break;
    }
    case "tool_call": {
      state.toolCount += 1;
      const tool = update.title ?? update.kind ?? "tool";
      state.toolNames.set(update.toolCallId, tool);
      const argsPreview = update.rawInput
        ? JSON.stringify(update.rawInput).slice(0, 120)
        : undefined;
      const path = extractPathFromToolArgs(update.rawInput);
      const previousContent =
        path && workspaceRoot
          ? readWorkspaceFileBaseline(workspaceRoot, path)
          : undefined;
      state.pendingTools.set(update.toolCallId, {
        tool,
        path,
        previousContent,
        args: update.rawInput,
      });
      await run?.toolStart(tool, argsPreview, update.toolCallId);
      await callbacks.onLog(
        "info",
        `[${runtimeId}] 工具 #${state.toolCount}：${tool}`,
      );
      await callbacks.onProgress(
        Math.min(92, 75 + state.toolCount * 2),
        `执行 ${tool}…`,
      );
      const deliv = extractDeliverableFromTool(tool, update.rawInput, undefined, false, {
        previousContent,
      });
      if (deliv) {
        mergeDeliverable(state.deliverables, deliv);
      }
      break;
    }
    case "tool_call_update": {
      const tool = state.toolNames.get(update.toolCallId) ?? update.title ?? "tool";
      const pending = state.pendingTools.get(update.toolCallId);
      if (update.status === "completed") {
        const rawOutput = extractRawOutput(update);
        const resultPreview = extractToolUpdateText(update)?.slice(0, 160);
        const item = extractDeliverableFromTool(
          tool,
          pending?.args ?? (pending?.path ? { path: pending.path } : undefined),
          rawOutput,
          false,
          { previousContent: pending?.previousContent },
        );
        if (item) mergeDeliverable(state.deliverables, item);
        const fileDiff = toolFileDiffFromDeliverable(item);
        state.pendingTools.delete(update.toolCallId);
        await run?.toolEnd(tool, false, update.toolCallId, resultPreview, fileDiff);
      } else if (update.status === "failed") {
        state.pendingTools.delete(update.toolCallId);
        await run?.toolEnd(tool, true, update.toolCallId);
      } else {
        const text = extractToolUpdateText(update);
        if (text) {
          await run?.toolUpdate(tool, update.toolCallId, text.slice(-200));
        }
      }
      break;
    }
    default:
      break;
  }
}
