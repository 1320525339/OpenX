/**
 * SSE /api/events 游标与 connected 握手回归
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendSseEvent, resetDb } from "./db.js";
import { app } from "./routes.js";

async function readSseUntil(
  res: Response,
  predicate: (chunk: string) => boolean,
  timeoutMs = 3000,
): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("missing body");
  const decoder = new TextDecoder();
  let buf = "";
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (value) buf += decoder.decode(value, { stream: true });
      if (predicate(buf) || done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return buf;
}

describe("/api/events SSE cursor", () => {
  beforeEach(() => {
    process.env.OPENX_DB_PATH = ":memory:";
    resetDb();
  });

  afterEach(() => {
    resetDb();
    delete process.env.OPENX_DB_PATH;
  });

  it("connected 事件不携带 SSE id", async () => {
    const ac = new AbortController();
    const res = await app.request("/api/events", { signal: ac.signal });
    expect(res.status).toBe(200);
    const text = await readSseUntil(res, (t) => t.includes("event: connected"));
    ac.abort();

    expect(text).toMatch(/event:\s*connected/);
    // 握手行附近不应出现 id: 0 / id:0
    const connectedBlock = text.slice(Math.max(0, text.indexOf("event: connected") - 40));
    expect(connectedBlock).not.toMatch(/^id:\s*0\s*$/m);
    expect(connectedBlock).not.toMatch(/\nid:\s*0\n/);
  });

  it("Last-Event-ID: 0 不触发 gap，走首次连接", async () => {
    appendSseEvent({
      type: "narration.append",
      message: "hello",
      timestamp: new Date().toISOString(),
    });

    const ac = new AbortController();
    const res = await app.request("/api/events", {
      headers: { "Last-Event-ID": "0" },
      signal: ac.signal,
    });
    const text = await readSseUntil(res, (t) => t.includes("event: connected"));
    ac.abort();

    expect(text).not.toContain("event: gap");
    expect(text).toMatch(/event:\s*connected/);
    expect(text).toContain("narration.append");
  });

  it("无效正整数 Last-Event-ID 发送 gap 且不发送 connected", async () => {
    const ac = new AbortController();
    const res = await app.request("/api/events", {
      headers: { "Last-Event-ID": "999999" },
      signal: ac.signal,
    });
    const text = await readSseUntil(
      res,
      (t) => t.includes("event: gap") || t.includes("event: connected"),
    );
    ac.abort();

    expect(text).toContain("event: gap");
    expect(text).toContain("invalid_last_event_id");
    expect(text).not.toContain("event: connected");
  });

  it("有效 Last-Event-ID 可 catchup 后续事件", async () => {
    const first = appendSseEvent({
      type: "narration.append",
      message: "a",
      timestamp: new Date().toISOString(),
    });
    appendSseEvent({
      type: "narration.append",
      message: "b",
      timestamp: new Date().toISOString(),
    });

    const ac = new AbortController();
    const res = await app.request("/api/events", {
      headers: { "Last-Event-ID": String(first.id) },
      signal: ac.signal,
    });
    const text = await readSseUntil(res, (t) => t.includes("event: connected"));
    ac.abort();

    expect(text).not.toContain("event: gap");
    expect(text).toContain('"message":"b"');
  });
});
