import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildIdeOpenUrl,
  classifyPath,
  resolveOpenPath,
} from "./ide-open.js";

describe("ide-open", () => {
  it("builds cursor url only for files", () => {
    expect(buildIdeOpenUrl("C:\\Users\\foo\\bar.ts", "file")).toBe(
      "cursor://file/C:/Users/foo/bar.ts",
    );
    expect(buildIdeOpenUrl("C:\\Users\\foo\\project", "directory")).toBeNull();
  });

  it("classifies existing file and directory", () => {
    const root = mkdtempSync(join(tmpdir(), "openx-kind-"));
    const file = join(root, "a.txt");
    const dir = join(root, "subdir");
    writeFileSync(file, "x");
    mkdirSync(dir);
    try {
      expect(classifyPath(file)).toBe("file");
      expect(classifyPath(dir)).toBe("directory");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("infers directory when path has no extension", () => {
    expect(classifyPath("C:\\workspace\\Demo\\OpenX\\apps\\server\\Test")).toBe(
      "directory",
    );
  });

  it("resolves relative path against workspace", () => {
    const abs = resolveOpenPath("apps/server/src/index.ts", ".");
    expect(abs.replace(/\\/g, "/")).toMatch(/apps\/server\/src\/index\.ts$/);
  });
});
