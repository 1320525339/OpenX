import { describe, expect, it } from "vitest";
import {
  classifyToolRisk,
  permissionAllowsTool,
  piToolSessionPolicy,
  resolveEffectivePermissionMode,
  shouldElevateAskWriteOnResume,
} from "./dispatch-permission-policy.js";

describe("dispatch-permission-policy", () => {
  it("defaults missing mode to ask_write", () => {
    expect(resolveEffectivePermissionMode(undefined)).toBe("ask_write");
    expect(resolveEffectivePermissionMode(null)).toBe("ask_write");
  });

  it("classifies common tools", () => {
    expect(classifyToolRisk("read")).toBe("read");
    expect(classifyToolRisk("grep")).toBe("read");
    expect(classifyToolRisk("write")).toBe("write");
    expect(classifyToolRisk("edit")).toBe("write");
    expect(classifyToolRisk("bash")).toBe("shell");
  });

  it("read_only and ask_write only allow read tools", () => {
    expect(permissionAllowsTool("read_only", "read")).toBe(true);
    expect(permissionAllowsTool("read_only", "write")).toBe(false);
    expect(permissionAllowsTool("read_only", "bash")).toBe(false);
    expect(permissionAllowsTool("ask_write", "edit")).toBe(false);
    expect(permissionAllowsTool("full", "write")).toBe(true);
    expect(permissionAllowsTool("full", "bash")).toBe(true);
  });

  it("builds pi session policy per mode", () => {
    expect(piToolSessionPolicy("read_only").createTools).toEqual([
      "read",
      "grep",
      "find",
      "ls",
    ]);
    expect(piToolSessionPolicy("ask_write").initialActiveTools).toEqual(["read"]);
    expect(piToolSessionPolicy("ask_write").elevatedActiveTools).toContain("write");
    expect(piToolSessionPolicy("full")).toEqual({});
  });

  it("elevates ask_write unless user denies writes", () => {
    expect(shouldElevateAskWriteOnResume("确认，可以写入")).toBe(true);
    expect(shouldElevateAskWriteOnResume("拒绝写入")).toBe(false);
    expect(shouldElevateAskWriteOnResume("")).toBe(false);
  });
});
