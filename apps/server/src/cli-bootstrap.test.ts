import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  formatBootstrapFailureHint,
  getConnectBootstrapStatus,
  listConnectBootstrapStatuses,
  resetBootstrapProcesses,
  syncBootstrapOnlineStatus,
} from "./cli-bootstrap.js";
import { registerConnection, resetConnections } from "./connect-store.js";

describe("connect bootstrap status", () => {
  beforeEach(() => {
    resetBootstrapProcesses();
    resetConnections();
  });

  afterEach(() => {
    resetBootstrapProcesses();
    resetConnections();
  });

  it("returns undefined when no record and offline", () => {
    expect(getConnectBootstrapStatus("missing")).toBeUndefined();
  });

  it("reports online when connection registered without bootstrap record", () => {
    registerConnection({
      executorId: "test-worker",
      agentName: "Test",
      toolName: "test",
    });
    const status = getConnectBootstrapStatus("test-worker");
    expect(status?.online).toBe(true);
    expect(status?.phase).toBe("online");
  });

  it("formatBootstrapFailureHint describes exited bootstrap", () => {
    const hint = formatBootstrapFailureHint({
      command: "node cli.js",
      status: {
        executorId: "worker",
        phase: "exited",
        online: false,
        exitCode: 1,
      },
      online: false,
    });
    expect(hint).toContain("退出");
    expect(hint).toContain("1");
  });

  it("formatBootstrapFailureHint prefers explicit error", () => {
    const hint = formatBootstrapFailureHint({
      command: "",
      error: "未找到 connect-client",
      status: { executorId: "w", phase: "exited", online: false },
      online: false,
    });
    expect(hint).toBe("未找到 connect-client");
  });

  it("syncBootstrapOnlineStatus reflects connect registration", () => {
    expect(listConnectBootstrapStatuses()).toEqual([]);

    registerConnection({
      executorId: "worker-b",
      agentName: "Worker B",
      toolName: "worker-b",
    });
    const synced = syncBootstrapOnlineStatus("worker-b");
    expect(synced.online).toBe(true);
    expect(synced.phase).toBe("online");
  });
});
