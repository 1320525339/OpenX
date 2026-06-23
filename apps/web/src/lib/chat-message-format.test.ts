import { describe, expect, it } from "vitest";
import {
  isChatPathSegment,
  prepareCoachMessageDisplay,
  splitCoachMessageParts,
} from "./chat-message-format";

describe("isChatPathSegment", () => {
  it("accepts absolute Windows paths", () => {
    expect(isChatPathSegment(String.raw`C:\Users\demo\OpenX\apps\server`)).toBe(true);
  });

  it("rejects relative dotted paths like .openx/skills", () => {
    expect(isChatPathSegment(".openx/skills")).toBe(false);
  });

  it("rejects bare relative paths like apps/server", () => {
    expect(isChatPathSegment("apps/server")).toBe(false);
  });
});

describe("splitCoachMessageParts", () => {
  it("splits prose and propose_work_order tool payload", () => {
    const raw =
      '好的，我这就整理任务。\n\n<propose_work_order> { "action": "refined", "refined": { "executionPrompt": "test" } } </propose_work_order>\n\n请确认。';
    const parts = splitCoachMessageParts(raw);
    expect(parts.some((p) => p.kind === "text" && p.text.includes("好的"))).toBe(true);
    expect(parts.some((p) => p.kind === "tool" && p.toolName === "propose_work_order")).toBe(true);
    expect(parts.some((p) => p.kind === "text" && p.text.includes("请确认"))).toBe(true);
  });

  it("keeps unclosed propose_work_order during streaming", () => {
    const raw = "说明如下\n<propose_work_order> { \"action\": \"refined\"";
    const parts = splitCoachMessageParts(raw);
    const tool = parts.find((p) => p.kind === "tool");
    expect(tool?.kind).toBe("tool");
    if (tool?.kind === "tool") {
      expect(tool.incomplete).toBe(true);
    }
  });
});

describe("ChatCoachToolBlock summary", () => {
  it("is covered via summarizeCoachTool for work order headline", async () => {
    const { summarizeCoachTool } = await import("./coach-tool-present");
    const s = summarizeCoachTool(
      "propose_work_order",
      JSON.stringify({ refined: { title: "我的任务", acceptance: "ok", executionPrompt: "run" } }),
    );
    expect(s.headline).toBe("我的任务");
  });
});

describe("prepareCoachMessageDisplay", () => {
  it("returns prose only without tool payload", () => {
    const raw =
      '好的，我这就整理任务。\n\n<propose_work_order> { "action": "refined" } </propose_work_order>';
    expect(prepareCoachMessageDisplay(raw)).toBe("好的，我这就整理任务。");
  });
});
