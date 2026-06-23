import { describe, expect, it } from "vitest";
import {
  clearHighlightCacheForTests,
  highlightLangFromPath,
  highlightToHtml,
  resolveHighlightLang,
} from "./code-highlight";

describe("resolveHighlightLang", () => {
  it("maps tsx alias to typescript", () => {
    expect(resolveHighlightLang("tsx")).toBe("typescript");
  });

  it("returns empty for unknown language", () => {
    expect(resolveHighlightLang("unknownlang")).toBe("");
  });
});

describe("highlightLangFromPath", () => {
  it("derives typescript from .ts path", () => {
    expect(highlightLangFromPath("src/app.ts")).toBe("typescript");
  });
});

describe("highlightToHtml", () => {
  it("wraps keywords in hljs spans", () => {
    const html = highlightToHtml('const x = "hi";', "typescript");
    expect(html).toContain("hljs-keyword");
    expect(html).toContain("hljs-string");
  });

  it("escapes plain text when language unknown", () => {
    expect(highlightToHtml("<tag>", "nope")).toBe("&lt;tag&gt;");
  });

  it("uses LRU cache for repeated lines", () => {
    clearHighlightCacheForTests();
    const sample = 'const value = "cached";';
    const first = highlightToHtml(sample, "typescript");
    const second = highlightToHtml(sample, "typescript");
    expect(second).toBe(first);
  });
});
