import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
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
