import { describe, expect, it } from "vitest";
import { registerExecutor, resolveExecutor } from "@openx/executor-core";
import { createConnectExecutor } from "@openx/executor-connect";
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
