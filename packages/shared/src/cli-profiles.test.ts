import { describe, expect, it } from "vitest";
import {
  buildCliIntegrationGoal,
  buildConnectBootstrapCommand,
  buildConnectClientArgv,
  listAvailableCliTemplates,
} from "./cli-profiles.js";

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

  it("builds Connect integration goal without pre-registered executorId", () => {
    const goal = buildCliIntegrationGoal({
      cliName: "Connect Agent",
      tutorialUrl: "https://example.com/docs",
      kind: "connect",
      notes: "使用内网代理",
    });
    expect(goal.title).toContain("Connect Agent");
    expect(goal.userDraft).toContain("内网代理");
    expect(goal.executionPrompt).toContain("POST /api/cli/profiles");
    expect(goal.executionPrompt).toContain("/bootstrap");
  });

  it("builds Connect integration goal with pre-registered executorId", () => {
    const goal = buildCliIntegrationGoal({
      cliName: "My Worker",
      tutorialUrl: "https://example.com/docs",
      kind: "connect",
      connectExecutorId: "my-worker",
      serverBaseUrl: "http://127.0.0.1:3921",
    });
    expect(goal.executionPrompt).toContain("executorId=my-worker");
    expect(goal.executionPrompt).toContain(
      "POST http://127.0.0.1:3921/api/cli/profiles/my-worker/bootstrap",
    );
    expect(goal.executionPrompt).toContain("禁止根据教程链接安装第三方 CLI");
    expect(goal.executionPrompt).not.toContain("自行生成 executorId");
  });
});

describe("connect bootstrap helpers", () => {
  it("buildConnectClientArgv matches spawn contract", () => {
    const argv = buildConnectClientArgv("/repo/packages/connect-client/dist/cli.js", {
      baseUrl: "http://127.0.0.1:3921",
      executorId: "worker-a",
      displayName: "Worker A",
      toolName: "worker-tool",
    });
    expect(argv).toEqual([
      "/repo/packages/connect-client/dist/cli.js",
      "--base",
      "http://127.0.0.1:3921",
      "--executor-id",
      "worker-a",
      "--agent-name",
      "Worker A",
      "--tool-name",
      "worker-tool",
    ]);
  });

  it("buildConnectBootstrapCommand includes node spawn line when paths provided", () => {
    const cmd = buildConnectBootstrapCommand({
      baseUrl: "http://127.0.0.1:3921",
      executorId: "worker-a",
      displayName: "Worker A",
      nodePath: "/usr/bin/node",
      scriptPath: "/repo/packages/connect-client/dist/cli.js",
    });
    expect(cmd).toContain("/usr/bin/node");
    expect(cmd).toContain("--executor-id worker-a");
    expect(cmd).toContain("pnpm --dir");
    expect(cmd).toContain("connect:demo");
  });
});
