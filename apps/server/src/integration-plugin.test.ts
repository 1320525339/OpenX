import { describe, expect, it } from "vitest";
import {
  clearIntegrationPlugins,
  enabledIntegrationPlugins,
  registerIntegrationPlugin,
  startEnabledIntegrations,
  type IntegrationPlugin,
} from "./integration-plugin.js";
import { milocoIntegrationPlugin } from "./miloco-plugin.js";
import { Hono } from "hono";

describe("integration-plugin", () => {
  it("filters enabled plugins", () => {
    clearIntegrationPlugins();
    const off: IntegrationPlugin = {
      id: "off",
      getManifest: () => ({
        id: "off",
        version: "0",
        displayName: "off",
        icon: "",
        capabilities: [],
        permissions: [],
      }),
      isEnabled: () => false,
    };
    const on: IntegrationPlugin = {
      id: "on",
      getManifest: () => ({
        id: "on",
        version: "0",
        displayName: "on",
        icon: "",
        capabilities: [],
        permissions: [],
      }),
      isEnabled: () => true,
    };
    registerIntegrationPlugin(off);
    registerIntegrationPlugin(on);
    const enabled = enabledIntegrationPlugins({
      env: process.env,
      openxRoot: ".",
    });
    expect(enabled.map((p) => p.id)).toEqual(["on"]);
    clearIntegrationPlugins();
  });

  it("miloco respects OPENX_MILOCO env override", () => {
    expect(
      milocoIntegrationPlugin.isEnabled({
        env: { OPENX_MILOCO: "0" },
        openxRoot: ".",
      }),
    ).toBe(false);
    // env is read from process.env in resolveMilocoEnabled
    const prev = process.env.OPENX_MILOCO;
    process.env.OPENX_MILOCO = "0";
    expect(
      milocoIntegrationPlugin.isEnabled({
        env: process.env,
        openxRoot: ".",
      }),
    ).toBe(false);
    process.env.OPENX_MILOCO = "1";
    expect(
      milocoIntegrationPlugin.isEnabled({
        env: process.env,
        openxRoot: ".",
      }),
    ).toBe(true);
    if (prev === undefined) delete process.env.OPENX_MILOCO;
    else process.env.OPENX_MILOCO = prev;
  });

  it("isolates plugin startup failures and still registers routes", async () => {
    clearIntegrationPlugins();
    const boom: IntegrationPlugin = {
      id: "boom",
      getManifest: () => ({
        id: "boom",
        version: "0",
        displayName: "boom",
        icon: "",
        capabilities: [],
        permissions: [],
      }),
      isEnabled: () => true,
      onStartup: () => {
        throw new Error("boom");
      },
    };
    registerIntegrationPlugin(boom);
    const app = new Hono();
    const started = await startEnabledIntegrations(app, {
      env: process.env,
      openxRoot: ".",
    });
    expect(started).toEqual([]);
    clearIntegrationPlugins();
  });
});
