import type { RunDeltaEvent } from "@openx/shared";
import type { ExecutorContext } from "./index.js";

const ts = () => new Date().toISOString();
const TOOL_UPDATE_THROTTLE_MS = 500;

export class RunEventEmitter {
  private textBuffer = "";
  private thinkingBuffer = "";
  private toolUpdateAt = new Map<string, number>();

  constructor(private emit: (event: RunDeltaEvent) => Promise<void>) {}

  async status(message: string) {
    await this.emit({ type: "status", message, timestamp: ts() });
  }

  async flushText() {
    if (!this.textBuffer) return;
    const delta = this.textBuffer;
    this.textBuffer = "";
    await this.emit({ type: "text.delta", delta, timestamp: ts() });
  }

  async flushThinking() {
    if (!this.thinkingBuffer) return;
    const delta = this.thinkingBuffer;
    this.thinkingBuffer = "";
    await this.emit({ type: "thinking.delta", delta, timestamp: ts() });
  }

  async textDelta(delta: string) {
    this.textBuffer += delta;
    if (this.textBuffer.length >= 48) {
      await this.flushText();
    }
  }

  async thinkingDelta(delta: string) {
    this.thinkingBuffer += delta;
    if (this.thinkingBuffer.length >= 64) {
      await this.flushThinking();
    }
  }

  async toolStart(tool: string, argsPreview?: string, toolCallId?: string) {
    await this.flushText();
    await this.flushThinking();
    await this.emit({
      type: "tool.start",
      tool,
      argsPreview,
      toolCallId,
      timestamp: ts(),
    });
  }

  async toolUpdate(tool: string, toolCallId: string | undefined, outputPreview: string) {
    const key = toolCallId ?? tool;
    const now = Date.now();
    const last = this.toolUpdateAt.get(key) ?? 0;
    if (now - last < TOOL_UPDATE_THROTTLE_MS) return;
    this.toolUpdateAt.set(key, now);
    await this.emit({
      type: "tool.update",
      tool,
      toolCallId,
      outputPreview,
      timestamp: ts(),
    });
  }

  async toolEnd(
    tool: string,
    isError?: boolean,
    toolCallId?: string,
    resultPreview?: string,
    fileDiff?: import("@openx/shared").ToolFileDiff,
  ) {
    await this.flushText();
    await this.flushThinking();
    await this.emit({
      type: "tool.end",
      tool,
      isError,
      toolCallId,
      resultPreview,
      fileDiff,
      timestamp: ts(),
    });
  }

  async finish() {
    await this.flushText();
    await this.flushThinking();
  }
}

export function createRunEmitter(ctx: ExecutorContext): RunEventEmitter | null {
  if (!ctx.callbacks.onRunEvent) return null;
  return new RunEventEmitter((event) => ctx.callbacks.onRunEvent!(event));
}
