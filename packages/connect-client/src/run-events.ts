import type { RunDeltaEvent } from "@openx/shared";

const ts = () => new Date().toISOString();

/** 节流 text.delta，减少 internal run-event 请求频率 */
export class RunEventPoster {
  private buffer = "";

  constructor(private post: (event: RunDeltaEvent) => Promise<void>) {}

  async status(message: string) {
    await this.post({ type: "status", message, timestamp: ts() });
  }

  async flushText() {
    if (!this.buffer) return;
    const delta = this.buffer;
    this.buffer = "";
    await this.post({ type: "text.delta", delta, timestamp: ts() });
  }

  async textDelta(delta: string) {
    this.buffer += delta;
    if (this.buffer.length >= 48) {
      await this.flushText();
    }
  }

  async finish() {
    await this.flushText();
  }
}
