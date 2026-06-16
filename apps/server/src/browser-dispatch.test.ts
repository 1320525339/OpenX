import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dispatchBrowserAction } from "./browser-session.js";
import { closeAllBrowserSessions } from "./browser-session.js";

describe("dispatchBrowserAction (mock)", () => {
  beforeEach(() => {
    process.env.OPENX_BROWSER_MOCK = "1";
  });

  afterEach(async () => {
    await closeAllBrowserSessions();
    delete process.env.OPENX_BROWSER_MOCK;
  });

  it("handles navigate and scroll without error", async () => {
    await dispatchBrowserAction("mock-dispatch", { type: "navigate", url: "https://example.com" });
    await dispatchBrowserAction("mock-dispatch", {
      type: "scroll",
      x: 100,
      y: 100,
      deltaX: 0,
      deltaY: 120,
    });
    expect(true).toBe(true);
  });
});
