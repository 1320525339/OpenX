import { describe, expect, it } from "vitest";
import {
  defaultSkillCatalog,
  formatSkillsSystemAppend,
  mergeSkillBindings,
  parseSkillFrontmatter,
  resolveSkillsForExecutor,
} from "./skills.js";

describe("parseSkillFrontmatter", () => {
  it("reads name and description", () => {
    const md = `---
name: obscura-fetch
description: Fetch a URL with Obscura headless browser.
---

# Obscura Fetch
`;
    expect(parseSkillFrontmatter(md)).toEqual({
      name: "obscura-fetch",
      description: "Fetch a URL with Obscura headless browser.",
    });
  });
});

describe("defaultSkillCatalog", () => {
  it("includes core and github skills", () => {
    const catalog = defaultSkillCatalog();
    expect(catalog.some((s) => s.id === "filesystem")).toBe(true);
    expect(catalog.some((s) => s.id === "obscura-fetch")).toBe(true);
  });
});

describe("resolveSkillsForExecutor", () => {
  it("filters by binding cliIds", () => {
    const catalog = defaultSkillCatalog();
    const bindings = mergeSkillBindings(
      {
        shell: { enabled: true, cliIds: ["demo-cli"] },
      },
      catalog,
      ["pi", "demo-cli"],
    );
    const piSkills = resolveSkillsForExecutor("pi", bindings, catalog);
    const demoSkills = resolveSkillsForExecutor("demo-cli", bindings, catalog);
    expect(piSkills.hints.some((s) => s.id === "shell")).toBe(false);
    expect(demoSkills.hints.some((s) => s.id === "shell")).toBe(true);
  });

  it("defaults defaultEnabled skills to pi", () => {
    const catalog = defaultSkillCatalog();
    const bindings = mergeSkillBindings({}, catalog, ["pi", "demo-cli"]);
    const piSkills = resolveSkillsForExecutor("pi", bindings, catalog);
    expect(piSkills.hints.some((s) => s.id === "filesystem")).toBe(true);
    const demoSkills = resolveSkillsForExecutor("demo-cli", bindings, catalog);
    expect(demoSkills.hints.some((s) => s.id === "filesystem")).toBe(false);
  });
});

describe("formatSkillsSystemAppend", () => {
  it("includes github skill bodies", () => {
    const hints = [
      {
        id: "obscura-fetch",
        name: "obscura-fetch",
        desc: "fetch",
        kind: "github" as const,
      },
    ];
    const out = formatSkillsSystemAppend(hints, {
      "obscura-fetch": "---\nname: obscura-fetch\n---\n\nUse obscura CLI.",
    });
    expect(out).toContain("obscura-fetch");
    expect(out).toContain("Use obscura CLI");
  });
});
