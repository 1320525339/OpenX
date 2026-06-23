import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  DOCK_TO_SCENE,
  resolveConsoleDock,
  SCENE_DEFAULTS,
} from "./use-desktop-layout.js";

const SCENE_KEY = "openx.desktopScene";
const DOCK_KEY = "openx.desktopDock";

describe("use-desktop-layout sync", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("maps each dock mode to a desktop scene", () => {
    expect(DOCK_TO_SCENE.chat).toBe("planning");
    expect(DOCK_TO_SCENE.tasks).toBe("dispatch");
    expect(DOCK_TO_SCENE.artifacts).toBe("execution");
    expect(DOCK_TO_SCENE.fleet).toBe("dispatch");
  });

  it("uses scene default dock when stored dock belongs to another scene", () => {
    localStorage.setItem(SCENE_KEY, "dispatch");
    localStorage.setItem(DOCK_KEY, "chat");
    expect(resolveConsoleDock("dispatch")).toBe("tasks");
  });

  it("keeps stored dock when it matches the scene", () => {
    localStorage.setItem(SCENE_KEY, "dispatch");
    localStorage.setItem(DOCK_KEY, "fleet");
    expect(resolveConsoleDock("dispatch")).toBe("fleet");
  });

  it("defaults dispatch scene to tasks dock", () => {
    expect(SCENE_DEFAULTS.dispatch.dockMode).toBe("tasks");
    expect(resolveConsoleDock("dispatch")).toBe("tasks");
  });
});
