import { beforeEach, describe, expect, it, vi } from "vitest";

const generateTextMock = vi.fn();
const streamTextMock = vi.fn();

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: (...args: unknown[]) => generateTextMock(...args),
    streamText: (...args: unknown[]) => streamTextMock(...args),
  };
});

vi.mock("@openx/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openx/shared")>();
  return {
    ...actual,
    resolveModelCredentials: vi.fn(() => ({
      baseUrl: "http://localhost",
      apiKey: "k",
      model: "m",
    })),
  };
});

vi.mock("../llm.js", () => ({
  createModel: vi.fn(() => ({})),
  generateCoachText: vi.fn(async () => "兜底正文"),
}));

import { generateParticipantReply, formatRoundtableComposerContextBlock } from "./diverge.js";
import {
  synthesizeToolNotesText,
  wrapHandlersWithToolNotes,
} from "./participant-tools.js";

const baseSettings = {
  providers: [],
  model: { default: "test/m", coach: "test/m", pi: "test/m" },
} as unknown as Parameters<typeof generateParticipantReply>[0]["settings"];

describe("synthesizeToolNotesText / wrapHandlersWithToolNotes", () => {
  it("合成非空笔记", () => {
    expect(synthesizeToolNotesText([" a ", "", "b"])).toBe("a\nb");
    expect(synthesizeToolNotesText([])).toBe("");
  });

  it("request_peer_reply 成功写入笔记", async () => {
    const notes: string[] = [];
    const wrapped = wrapHandlersWithToolNotes(
      {
        listAttendees: async () => [],
        getPeerReplies: async () => [],
        requestPeerReply: async () => ({
          ok: true,
          message: "已自动获准：产品 正在回答。",
          autoApproved: true,
        }),
        concludeDiscussion: async () => ({ ok: true, message: "ok" }),
      },
      notes,
    );
    await wrapped.requestPeerReply({
      targetDisplayName: "产品",
      question: "Q",
    });
    expect(notes.some((n) => n.includes("产品"))).toBe(true);
    expect(notes.some((n) => n.includes("自动获准"))).toBe(true);
  });
});

describe("generateParticipantReply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("有 tools 且 text 空时用工具笔记合成，并一次性 onDelta", async () => {
    generateTextMock.mockImplementation(async (opts: {
      tools?: Record<string, { execute?: (input: unknown) => Promise<unknown> }>;
    }) => {
      const tool = opts.tools?.request_peer_reply;
      if (tool?.execute) {
        await tool.execute({
          targetDisplayName: "研发",
          question: "请评估",
        });
      }
      return { text: "" };
    });

    const deltas: string[] = [];
    const result = await generateParticipantReply({
      settings: baseSettings,
      modelRef: "test/m",
      rolePrompt: "你是成员",
      displayName: "工头助手",
      userMessage: "讨论一下",
      tools: {
        listAttendees: async () => [],
        getPeerReplies: async () => [],
        requestPeerReply: async () => ({
          ok: true,
          autoApproved: true,
          message: "已自动获准",
        }),
        concludeDiscussion: async () => ({ ok: true, message: "ok" }),
      },
      onDelta: (d) => {
        deltas.push(d);
      },
    });

    expect(generateTextMock).toHaveBeenCalled();
    expect(streamTextMock).not.toHaveBeenCalled();
    expect(result.text).toMatch(/研发|自动获准/);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toBe(result.text);
  });

  it("无 tools 只消费 textStream，不读 result.text", async () => {
    const textPromise = Promise.reject(
      new Error("No output generated. Check the stream for errors."),
    );
    // 防止未处理 rejection（我们刻意不 await result.text）
    textPromise.catch(() => undefined);

    streamTextMock.mockReturnValue({
      textStream: (async function* () {
        yield "流式";
        yield "片段";
      })(),
      text: textPromise,
    });

    const deltas: string[] = [];
    const result = await generateParticipantReply({
      settings: baseSettings,
      modelRef: "test/m",
      rolePrompt: "你是成员",
      displayName: "产品",
      userMessage: "你好",
      onDelta: (d) => {
        deltas.push(d);
      },
    });

    expect(streamTextMock).toHaveBeenCalled();
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(result.text).toBe("流式片段");
    expect(deltas.join("")).toBe("流式片段");
  });
});

describe("formatRoundtableComposerContextBlock", () => {
  it("空输入返回空串", () => {
    expect(formatRoundtableComposerContextBlock()).toBe("");
    expect(formatRoundtableComposerContextBlock({})).toBe("");
  });

  it("含 Skills/MCP/知识/权限时输出中文块", () => {
    const block = formatRoundtableComposerContextBlock({
      enabledSkills: [{ id: "shell", name: "Shell", desc: "执行命令" }],
      enabledMcps: [{ id: "openx", name: "OpenX API" }],
      knowledgeSummary: "项目约定：用 pnpm",
      permissionMode: "read_only",
    });
    expect(block).toContain("Shell");
    expect(block).toContain("openx");
    expect(block).toContain("项目约定：用 pnpm");
    expect(block).toContain("只读");
    expect(block).toContain("read_only");
  });
});
