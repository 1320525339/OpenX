import { broadcast } from "./sse.js";

/** 每会话当前工头生成世代 */
const epochs = new Map<string, number>();
const controllers = new Map<string, AbortController>();

/** 开始新一轮工头生成：中止上一轮并返回 signal / epoch */
export function beginCoachGeneration(conversationId: string): {
  signal: AbortSignal;
  epoch: number;
} {
  controllers.get(conversationId)?.abort();
  const controller = new AbortController();
  controllers.set(conversationId, controller);
  const epoch = (epochs.get(conversationId) ?? 0) + 1;
  epochs.set(conversationId, epoch);
  return { signal: controller.signal, epoch };
}

/** 遗忘/清空时中止该会话进行中的工头流，并作废 epoch */
export function abortCoachStreamsForConversation(conversationId: string): void {
  controllers.get(conversationId)?.abort();
  controllers.delete(conversationId);
  epochs.set(conversationId, (epochs.get(conversationId) ?? 0) + 1);
}

export function isCoachGenerationCurrent(
  conversationId: string,
  epoch: number,
): boolean {
  return epochs.get(conversationId) === epoch;
}

/** SSE 流式 Coach 回复：节流广播 delta；绑定会话 epoch，abort 后停止写 SSE */
export function createCoachStreamBroadcaster(conversationId: string) {
  const { signal, epoch } = beginCoachGeneration(conversationId);
  const streamId = crypto.randomUUID();
  let deltaBuf = "";
  let lastDeltaEmit = 0;
  let streamed = false;

  const isLive = () =>
    !signal.aborted && isCoachGenerationCurrent(conversationId, epoch);

  const flush = () => {
    if (!isLive() || !deltaBuf) return;
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
    if (!isLive()) return;
    streamed = true;
    deltaBuf += delta;
    const now = Date.now();
    if (deltaBuf.length >= 12 || now - lastDeltaEmit >= 50) {
      flush();
    }
  };

  /** 刷出剩余 delta；stream.end 由调用方在 coach.reply 之后发送 */
  const flushPending = () => {
    if (!isLive()) return false;
    if (streamed) flush();
    return streamed;
  };

  const end = () => {
    if (!isLive() || !streamed) return;
    broadcast({
      type: "coach.stream.end",
      conversationId,
      streamId,
      timestamp: new Date().toISOString(),
    });
  };

  /** 路由 catch：结束本流 SSE，不 bump 全局 epoch */
  const abort = () => {
    deltaBuf = "";
    if (streamed && isCoachGenerationCurrent(conversationId, epoch)) {
      broadcast({
        type: "coach.stream.end",
        conversationId,
        streamId,
        timestamp: new Date().toISOString(),
      });
    }
  };

  return {
    streamId,
    signal,
    epoch,
    isLive,
    onDelta,
    flushPending,
    end,
    abort,
    get streamed() {
      return streamed;
    },
  };
}
