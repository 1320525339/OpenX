import { describe, expect, it } from "vitest";
import { shouldRunPiInWorker, hasParkedPiChild } from "./pi-isolated-run.js";

describe("pi-isolated-run worker flags", () => {
  it("shouldRunPiInWorker requires OPENX_PI_WORKER=1 and not mock", () => {
    const prevWorker = process.env.OPENX_PI_WORKER;
    const prevMock = process.env.OPENX_MOCK_PI;
    try {
      process.env.OPENX_PI_WORKER = "1";
      delete process.env.OPENX_MOCK_PI;
      expect(shouldRunPiInWorker()).toBe(true);
      process.env.OPENX_MOCK_PI = "1";
      expect(shouldRunPiInWorker()).toBe(false);
    } finally {
      if (prevWorker === undefined) delete process.env.OPENX_PI_WORKER;
      else process.env.OPENX_PI_WORKER = prevWorker;
      if (prevMock === undefined) delete process.env.OPENX_MOCK_PI;
      else process.env.OPENX_MOCK_PI = prevMock;
    }
  });

  it("hasParkedPiChild is false for unknown goals", () => {
    expect(hasParkedPiChild("nonexistent-goal")).toBe(false);
  });
});
