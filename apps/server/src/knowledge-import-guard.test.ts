import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assertKnowledgeImportPathAllowed,
  assertKnowledgeImportUrlAllowed,
  KnowledgeImportGuardError,
} from "./knowledge-import-guard.js";

describe("knowledge-import-guard", () => {
  it("rejects loopback and private URLs", () => {
    const blocked = [
      "http://127.0.0.1/docs",
      "http://localhost/secret",
      "https://192.168.1.10/api",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/",
    ];
    for (const url of blocked) {
      expect(() => assertKnowledgeImportUrlAllowed(url)).toThrow(KnowledgeImportGuardError);
    }
  });

  it("allows public https URLs", () => {
    expect(() => assertKnowledgeImportUrlAllowed("https://example.com/docs")).not.toThrow();
  });

  it("rejects project paths outside workspace", () => {
    const workspace = mkdtempSync(join(tmpdir(), "openx-guard-ws-"));
    const outside = mkdtempSync(join(tmpdir(), "openx-guard-out-"));
    expect(() =>
      assertKnowledgeImportPathAllowed(outside, { scope: "user", workspaceRoot: workspace }),
    ).toThrow(/工作区/);
  });

  it("rejects sensitive credential paths", () => {
    expect(() =>
      assertKnowledgeImportPathAllowed("C:\\Users\\me\\.ssh\\id_rsa", { scope: "global" }),
    ).toThrow(/敏感/);
    expect(() =>
      assertKnowledgeImportPathAllowed("/home/me/.env", { scope: "global" }),
    ).toThrow(/敏感/);
  });
});
