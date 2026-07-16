import { describe, expect, it } from "vitest";
import { resolveMilocoEnabled } from "./miloco-integration-settings.js";
import type { Settings } from "@openx/shared";

function settingsWithMiloco(enabled: boolean): Settings {
  return {
    revision: 0,
    integrations: {
      miloco: { enabled, migrationCompleted: true },
    },
  } as Settings;
}

describe("resolveMilocoEnabled", () => {
  it("does not enable from watchdog env alone", () => {
    const prevMiloco = process.env.OPENX_MILOCO;
    const prevPresence = process.env.OPENX_MILOCO_PRESENCE_WATCH;
    const prevCron = process.env.OPENX_MILOCO_HOME_CRON_WATCH;
    try {
      delete process.env.OPENX_MILOCO;
      process.env.OPENX_MILOCO_PRESENCE_WATCH = "1";
      process.env.OPENX_MILOCO_HOME_CRON_WATCH = "1";
      const result = resolveMilocoEnabled(settingsWithMiloco(false));
      expect(result.enabled).toBe(false);
      expect(result.envLocked).toBe(false);
    } finally {
      if (prevMiloco === undefined) delete process.env.OPENX_MILOCO;
      else process.env.OPENX_MILOCO = prevMiloco;
      if (prevPresence === undefined) delete process.env.OPENX_MILOCO_PRESENCE_WATCH;
      else process.env.OPENX_MILOCO_PRESENCE_WATCH = prevPresence;
      if (prevCron === undefined) delete process.env.OPENX_MILOCO_HOME_CRON_WATCH;
      else process.env.OPENX_MILOCO_HOME_CRON_WATCH = prevCron;
    }
  });

  it("OPENX_MILOCO=1 forces enable", () => {
    const prev = process.env.OPENX_MILOCO;
    try {
      process.env.OPENX_MILOCO = "1";
      const result = resolveMilocoEnabled(settingsWithMiloco(false));
      expect(result.enabled).toBe(true);
      expect(result.envLocked).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.OPENX_MILOCO;
      else process.env.OPENX_MILOCO = prev;
    }
  });

  it("respects settings.enabled when env unset", () => {
    const prev = process.env.OPENX_MILOCO;
    try {
      delete process.env.OPENX_MILOCO;
      expect(resolveMilocoEnabled(settingsWithMiloco(true)).enabled).toBe(true);
      expect(resolveMilocoEnabled(settingsWithMiloco(false)).enabled).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.OPENX_MILOCO;
      else process.env.OPENX_MILOCO = prev;
    }
  });
});
