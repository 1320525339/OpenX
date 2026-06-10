import { describe, expect, it } from "vitest";
import { buildCliIntegrationGoal, listAvailableCliTemplates } from "./cli-profiles.js";

describe("listAvailableCliTemplates", () => {
  const allIds = ["pi", "acp:codex", "acp:claude", "acp:gemini", "my-agent"];

  it("hides builtin ACP templates when runtime already exists", () => {
    const available = listAvailableCliTemplates(allIds);
    expect(available.map((t) => t.id)).toEqual(["connect-custom"]);
  });

  it("shows ACP templates when runtime not yet available", () => {
    const available = listAvailableCliTemplates(["pi", "my-agent"]);
    expect(available.map((t) => t.id)).toEqual([
      "connect-custom",
      "acp-codex",
      "acp-claude",
      "acp-gemini",
    ]);
  });

  it("always keeps connect-custom template", () => {
    const available = listAvailableCliTemplates(allIds);
    expect(available.some((t) => t.id === "connect-custom")).toBe(true);
  });
});

describe("buildCliIntegrationGoal", () => {
  it("builds ACP integration goal with target executor", () => {
    const goal = buildCliIntegrationGoal({
      cliName: "Claude Code (ACP)",
      tutorialUrl: "https://docs.anthropic.com/en/docs/claude-code",
      kind: "acp",
      targetExecutorId: "acp:claude",
    });
    expect(goal.title).toContain("Claude Code");
    expect(goal.userDraft).toContain("acp:claude");
    expect(goal.acceptance).toContain("acp:claude");
    expect(goal.executionPrompt).toContain("https://docs.anthropic.com");
  });

  it("builds Connect integration goal without manual executorId", () => {
    const goal = buildCliIntegrationGoal({
      cliName: "Connect Agent",
      tutorialUrl: "https://example.com/docs",
      kind: "connect",
      notes: "使用内网代理",
    });
    expect(goal.title).toContain("Connect Agent");
    expect(goal.userDraft).toContain("内网代理");
    expect(goal.executionPrompt).toContain("自行生成 executorId");
    expect(goal.executionPrompt).toContain("/api/cli/profiles");
  });
});
