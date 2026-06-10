import { describe, expect, it } from "vitest";
import { summarizePiRun } from "./summary.js";

describe("summarizePiRun", () => {
  it("extracts assistant text from agent_end messages", () => {
    const summary = summarizePiRun(
      {
        type: "agent_end",
        messages: [
          {
            role: "assistant",
            content: [{ type: "text", text: "已完成登录 API 接入。" }],
          },
        ],
      },
      "",
      "接入登录",
    );
    expect(summary).toContain("已完成登录 API");
    expect(summary).toContain("接入登录");
  });

  it("falls back to streamed text", () => {
    const summary = summarizePiRun(undefined, "流式输出内容", "任务A");
    expect(summary).toContain("流式输出内容");
  });
});
