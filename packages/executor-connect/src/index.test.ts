import { describe, expect, it } from "vitest";
import { registerExecutor, resolveExecutor } from "@openx/executor-core";
import { createConnectExecutor } from "./index.js";
import type { ExecutorAdapter } from "@openx/executor-core";

const stubPi: ExecutorAdapter = {
  id: "pi",
  displayName: "Pi",
  detect: async () => ({ available: true }),
  run: async () => {},
};

const stubAcp: ExecutorAdapter = {
  id: "acp",
  displayName: "ACP",
  matchExecutorId: (id) => id.startsWith("acp:"),
  detect: async () => ({ available: true }),
  run: async () => {},
};

describe("resolveExecutor", () => {
  it("routes pi, acp and connect executor ids", () => {
    registerExecutor(stubPi);
    registerExecutor(stubAcp);
    registerExecutor(
      createConnectExecutor({
        getConnection: () => undefined,
        listConnections: () => [],
      }),
    );

    expect(resolveExecutor("pi")?.id).toBe("pi");
    expect(resolveExecutor("acp:gemini")?.id).toBe("acp");
    expect(resolveExecutor("cursor-worker")?.id).toBe("connect");
    expect(resolveExecutor("auto")).toBeUndefined();
  });
});

describe("connect detectEntries", () => {
  it("lists online agents and offline configured profiles", async () => {
    const adapter = createConnectExecutor({
      getConnection: () => undefined,
      listConnections: () => [
        { executorId: "worker-a", agentName: "Worker A", toolName: "tool-a" },
      ],
      listCliProfiles: () => [
        {
          executorId: "worker-b",
          displayName: "Worker B",
          kind: "connect",
        },
      ],
    });

    const entries = await adapter.detectEntries!({});
    const ids = entries.map((e) => e.id);

    expect(ids).toContain("worker-a");
    expect(ids).toContain("worker-b");
    expect(entries.find((e) => e.id === "worker-a")?.available).toBe(true);
    expect(entries.find((e) => e.id === "worker-b")?.available).toBe(false);
    expect(entries.find((e) => e.id === "worker-b")?.bootstrappable).toBe(true);
  });
});
