import { describe, expect, it } from "vitest";
import {
  isLoopbackHost,
  resolveRuntimeMode,
  validateRuntimeBind,
} from "./runtime-mode.js";

describe("runtime-mode", () => {
  it("detects loopback hosts", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(isLoopbackHost("192.168.1.10")).toBe(false);
  });

  it("defaults to desktop-local on loopback HOST", () => {
    expect(resolveRuntimeMode({ HOST: "127.0.0.1" })).toBe("desktop-local");
    expect(resolveRuntimeMode({ HOST: "0.0.0.0" })).toBe("remote");
  });

  it("rejects desktop-local bind on LAN address", () => {
    const result = validateRuntimeBind({
      OPENX_RUNTIME_MODE: "desktop-local",
      HOST: "0.0.0.0",
    });
    expect(result.ok).toBe(false);
  });

  it("requires API token for remote mode", () => {
    const missing = validateRuntimeBind({
      OPENX_RUNTIME_MODE: "remote",
      HOST: "0.0.0.0",
    });
    expect(missing.ok).toBe(false);

    const ok = validateRuntimeBind({
      OPENX_RUNTIME_MODE: "remote",
      HOST: "0.0.0.0",
      OPENX_API_TOKEN: "secret-token",
    });
    expect(ok.ok).toBe(true);
  });
});
