import type { RunDeltaEvent } from "@openx/shared";
import type { ExecutorContext } from "./index.js";

const ts = () => new Date().toISOString();

export class RunEventEmitter {
  private buffer = "";

  constructor(private emit: (event: RunDeltaEvent) => Promise<void>) {}

  async status(message: string) {
    await this.emit({ type: "status", message, timestamp: ts() });
  }

  async flushText() {
    if (!this.buffer) return;
    const delta = this.buffer;
    this.buffer = "";
    await this.emit({ type: "text.delta", delta, timestamp: ts() });
  }

  async textDelta(delta: string) {
    this.buffer += delta;
    if (this.buffer.length >= 48) {
      await this.flushText();
    }
  }

  async toolStart(tool: string, argsPreview?: string) {
    await this.flushText();
    await this.emit({
      type: "tool.start",
      tool,
      argsPreview,
      timestamp: ts(),
    });
  }

  async toolEnd(tool: string, isError?: boolean) {
    await this.flushText();
    await this.emit({
      type: "tool.end",
      tool,
      isError,
      timestamp: ts(),
    });
  }

  async finish() {
    await this.flushText();
  }
}

export function createRunEmitter(ctx: ExecutorContext): RunEventEmitter | null {
  if (!ctx.callbacks.onRunEvent) return null;
  return new RunEventEmitter((event) => ctx.callbacks.onRunEvent!(event));
}
