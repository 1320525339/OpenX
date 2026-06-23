import { describe, expect, it } from "vitest";
import {
  CreateKnowledgeSourceSchema,
  formatKnowledgeEntryFile,
  inferKnowledgeSourceKind,
  parseKnowledgeEntryFile,
} from "./knowledge.js";

describe("inferKnowledgeSourceKind", () => {
  it("treats http(s) as url", () => {
    expect(inferKnowledgeSourceKind("https://react.dev/learn")).toBe("url");
    expect(inferKnowledgeSourceKind("http://example.com")).toBe("url");
  });

  it("treats filesystem paths as path", () => {
    expect(inferKnowledgeSourceKind("D:\\docs\\react")).toBe("path");
    expect(inferKnowledgeSourceKind("/srv/notes")).toBe("path");
  });
});

describe("CreateKnowledgeSourceSchema", () => {
  it("infers kind from uri when omitted", () => {
    const parsed = CreateKnowledgeSourceSchema.parse({
      uri: "https://example.com/docs",
    });
    expect(parsed.kind).toBe("url");
  });
});

describe("knowledge entry file", () => {
  it("round-trips frontmatter and body", () => {
    const raw = formatKnowledgeEntryFile({
      id: "abc",
      title: "技术栈约定",
      content: "使用 pnpm 与 vitest。",
      category: "constraint",
      tags: ["pnpm", "vitest"],
      source: "imported",
      scope: "user",
      projectId: "proj-1",
      sourceRefId: "src-1",
      sourceUri: "D:\\docs\\guide.md",
      createdAt: "2025-06-21T00:00:00.000Z",
      updatedAt: "2025-06-21T00:00:00.000Z",
    });
    const parsed = parseKnowledgeEntryFile("abc", "user", raw, "proj-1");
    expect(parsed?.sourceRefId).toBe("src-1");
    expect(parsed?.sourceUri).toContain("guide.md");
  });
});
