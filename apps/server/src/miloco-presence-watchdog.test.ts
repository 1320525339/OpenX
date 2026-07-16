import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  computePresenceDiff,
  parseDeviceListOutput,
  resetMilocoPresenceWatchdogForTests,
  resolveMilocoPresenceIntervalMs,
  splitDeviceListField,
} from "./miloco-presence-watchdog.js";

const handleMilocoAgentTurnMock = vi.fn();

vi.mock("./miloco-webhook-service.js", () => ({
  handleMilocoAgentTurn: (...args: unknown[]) => handleMilocoAgentTurnMock(...args),
}));

describe("miloco-presence-watchdog", () => {
  let tempDir = "";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "openx-miloco-presence-"));
    handleMilocoAgentTurnMock.mockReset();
    resetMilocoPresenceWatchdogForTests();
    delete process.env.OPENX_MILOCO_PRESENCE_INTERVAL_MS;
    delete process.env.OPENX_MILOCO_PRESENCE_WATCH;
  });

  afterEach(() => {
    resetMilocoPresenceWatchdogForTests();
    delete process.env.OPENX_MILOCO_PRESENCE_INTERVAL_MS;
    delete process.env.OPENX_MILOCO_PRESENCE_WATCH;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("uses default interval when env invalid", () => {
    process.env.OPENX_MILOCO_PRESENCE_INTERVAL_MS = "abc";
    expect(resolveMilocoPresenceIntervalMs()).toBe(300_000);
  });

  it("parses device list TSV with escaped pipes", () => {
    expect(splitDeviceListField("a\\|b|c")).toEqual(["a|b", "c"]);
    const stdout = [
      "# home=仙女的城堡",
      "# did|device_name|room|category|online",
      "993802700|循环扇|卧室|fan|online",
      "461044985|床头灯|卧室|light|offline",
      "miwifi.abc|路由器|客厅|router|online",
    ].join("\n");
    const rows = parseDeviceListOutput(stdout);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ did: "993802700", online: true, name: "循环扇" });
    expect(rows[1]).toMatchObject({ did: "461044985", online: false });
  });

  it("computes diff only for watched devices after baseline", () => {
    const config = {
      homeId: "645001069854",
      watchDids: ["993802700", "461044985"],
      notifyOn: ["online", "offline"] as const,
    };
    const previous = {
      baselineReady: true,
      devices: {
        "993802700": { online: true, name: "循环扇" },
        "461044985": { online: true, name: "床头灯" },
      },
    };
    const current = parseDeviceListOutput(
      "993802700|循环扇|卧室|fan|offline\n461044985|床头灯|卧室|light|online",
    );
    const changes = computePresenceDiff(previous, current, config);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      did: "993802700",
      from: true,
      to: false,
      name: "循环扇",
    });
  });

  it("ignores unwatched devices in diff", () => {
    const config = {
      watchDids: ["993802700"],
      notifyOn: ["offline"] as const,
    };
    const previous = {
      baselineReady: true,
      devices: {
        "993802700": { online: true, name: "循环扇" },
        "999": { online: true, name: "其他" },
      },
    };
    const current = parseDeviceListOutput(
      "993802700|循环扇|卧室|fan|online\n999|其他|客厅|other|offline",
    );
    expect(computePresenceDiff(previous, current, config)).toHaveLength(0);
  });
});
