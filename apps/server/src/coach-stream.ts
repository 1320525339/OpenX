import { broadcast } from "./sse.js";

/** SSE 流式 Coach 回复：节流广播 delta（对齐 connect-client streamText 模式） */
export function createCoachStreamBroadcaster(conversationId: string) {
  const streamId = crypto.randomUUID();
  let deltaBuf = "";
  let lastDeltaEmit = 0;
  let streamed = false;

  const flush = () => {
    if (!deltaBuf) return;
    broadcast({
      type: "coach.delta",
      conversationId,
      streamId,
      delta: deltaBuf,
      timestamp: new Date().toISOString(),
    });
    deltaBuf = "";
    lastDeltaEmit = Date.now();
  };

  const onDelta = async (delta: string) => {
    streamed = true;
    deltaBuf += delta;
    const now = Date.now();
    if (deltaBuf.length >= 12 || now - lastDeltaEmit >= 50) {
      flush();
    }
  };

  /** 刷出剩余 delta；stream.end 由调用方在 coach.reply 之后发送 */
  const flushPending = () => {
    if (streamed) flush();
    return streamed;
  };

  const end = () => {
    if (!streamed) return;
    broadcast({
      type: "coach.stream.end",
      conversationId,
      streamId,
      timestamp: new Date().toISOString(),
    });
  };

  const abort = () => {
    end();
  };

  return {
    streamId,
    onDelta,
    flushPending,
    end,
    abort,
    get streamed() {
      return streamed;
    },
  };
}
