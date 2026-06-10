import { describe, expect, it } from "vitest";
import {
  buildAgentSystemPrompt,
  buildChatUserPrompt,
  buildWorkspaceInspectRefined,
  isWorkspaceInspectIntent,
} from "./prompts.js";
import { coachChatReply } from "./service.js";
import {
  SettingsSchema,
  upgradeToModelConfig,
  upsertProvider,
  providerConfigFromTemplate,
} from "@openx/shared";

describe("isWorkspaceInspectIntent", () => {
  it("detects list directory requests", () => {
    expect(isWorkspaceInspectIntent("帮我看一下当前目录下有哪些文件")).toBe(true);
    expect(isWorkspaceInspectIntent("列出工作目录的文件")).toBe(true);
  });

  it("ignores unrelated chat", () => {
    expect(isWorkspaceInspectIntent("你好")).toBe(false);
    expect(isWorkspaceInspectIntent("最近任务进展怎么样")).toBe(false);
  });
});

describe("buildWorkspaceInspectRefined", () => {
  it("embeds workspace path and user message", () => {
    const refined = buildWorkspaceInspectRefined(
      "看看文件夹里有什么",
      "C:\\Projects\\demo",
    );
    expect(refined.title).toContain("工作目录");
    expect(refined.executionPrompt).toContain("C:\\Projects\\demo");
    expect(refined.executionPrompt).toContain("看看文件夹里有什么");
    expect(refined.constraints.length).toBeGreaterThan(0);
  });
});

describe("buildChatUserPrompt", () => {
  it("includes prior turns before current message", () => {
    const prompt = buildChatUserPrompt("继续刚才那个", [
      { role: "user", text: "帮我整理登录 API" },
      { role: "coach", text: "好的，我先看一下任务情况。" },
    ]);
    expect(prompt).toContain("对话历史");
    expect(prompt).toContain("帮我整理登录 API");
    expect(prompt).toContain("继续刚才那个");
    expect(prompt.indexOf("帮我整理登录 API")).toBeLessThan(prompt.indexOf("继续刚才那个"));
  });
});

describe("buildAgentSystemPrompt", () => {
  it("includes orchestrator sections and north star", () => {
    const sys = buildAgentSystemPrompt({
      workspaceRoot: "/tmp/openx",
      northStar: {
        id: "g1",
        title: "搭建登录模块",
        status: "进行中",
        progress: 40,
        executorId: "pi",
        acceptance: "用户可登录并拿到 token",
      },
      subGoals: [
        {
          id: "g2",
          title: "API 接口",
          status: "待确认",
          progress: 100,
          executorId: "pi",
          resultSummary: "POST /login 已实现",
        },
      ],
    });
    expect(sys).toContain("OpenX 工头");
    expect(sys).toContain("North Star");
    expect(sys).toContain("搭建登录模块");
    expect(sys).toContain("API 接口");
    expect(sys).toContain("/tmp/openx");
    expect(sys).toContain("调度协议");
    expect(sys).toContain("subGoals");
  });
});

describe("coachChatReply workspace fallback", () => {
  it("returns refined without LLM for directory inspect", async () => {
    const base = upgradeToModelConfig(SettingsSchema.parse({}));
    const openai = upsertProvider(
      base,
      "no-key-openai",
      providerConfigFromTemplate("openai"),
    );
    const settings = {
      ...openai,
      model: {
        coach: "no-key-openai/gpt-4o-mini",
        pi: "zen/big-pickle",
        default: "zen/big-pickle",
      },
    };
    const result = await coachChatReply(
      "列出当前目录的文件",
      { workspaceRoot: "C:\\work" },
      settings,
      [],
      { apiKey: "", baseUrl: "", model: "" },
    );
    expect(result.refined).toBeDefined();
    expect(result.refined?.executionPrompt).toContain("C:\\work");
    expect(result.message).toContain("创建并执行");
  });
});
