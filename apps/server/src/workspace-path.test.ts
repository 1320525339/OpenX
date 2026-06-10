import { describe, expect, it } from "vitest";
import {
  normalizeWorkspaceRootForStorage,
  resolveWorkspaceRoot,
} from "./workspace-path.js";

describe("resolveWorkspaceRoot", () => {
  it("resolves dot to process cwd", () => {
    expect(resolveWorkspaceRoot(".")).toBe(process.cwd());
  });

  it("normalizes absolute paths", () => {
    const abs = resolveWorkspaceRoot(process.cwd());
    expect(normalizeWorkspaceRootForStorage(abs)).toBe(abs);
  });

  it("resolves relative paths against cwd", () => {
    const rel = normalizeWorkspaceRootForStorage("Demo");
    expect(rel).toBe(resolveWorkspaceRoot("Demo"));
  });
});
