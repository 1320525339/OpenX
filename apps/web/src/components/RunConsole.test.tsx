import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { GoalRunState } from "@openx/shared";
import { RunConsole } from "./RunConsole";

vi.mock("../lib/chat-markdown", () => ({
  ChatMarkdown: ({ text }: { text: string }) => <div data-testid="markdown">{text}</div>,
}));

const ts = "2026-06-08T00:00:00.000Z";

function baseRun(overrides: Partial<GoalRunState> = {}): GoalRunState {
  return {
    goalId: "g1",
    runId: "r1",
    active: true,
    executorId: "pi",
    events: [],
    liveText: "",
    thinkingText: "",
    ...overrides,
  };
}

describe("RunConsole", () => {
  it("shows tool subject and summary on completed grep", () => {
    render(
      <RunConsole
        run={baseRun({
          active: false,
          events: [
            {
              type: "tool.start",
              tool: "grep",
              toolCallId: "a",
              argsPreview: '{"pattern":"TODO"}',
              timestamp: ts,
            },
            {
              type: "tool.end",
              tool: "grep",
              toolCallId: "a",
              resultPreview: "x\ny",
              timestamp: ts,
            },
          ],
        })}
      />,
    );
    expect(screen.getByText("TODO")).toBeInTheDocument();
    expect(screen.getByText("2 匹配")).toBeInTheDocument();
  });

  it("batches consecutive read-only tools", () => {
    render(
      <RunConsole
        compact
        run={baseRun({
          active: false,
          events: [
            {
              type: "tool.start",
              tool: "grep",
              toolCallId: "1",
              argsPreview: '{"pattern":"a"}',
              timestamp: ts,
            },
            { type: "tool.end", tool: "grep", toolCallId: "1", resultPreview: "1", timestamp: ts },
            {
              type: "tool.start",
              tool: "read_file",
              toolCallId: "2",
              argsPreview: '{"path":"b.ts"}',
              timestamp: ts,
            },
            {
              type: "tool.end",
              tool: "read_file",
              toolCallId: "2",
              resultPreview: "line",
              timestamp: ts,
            },
          ],
        })}
      />,
    );
    expect(screen.getByText(/grep · read_file（2）/)).toBeInTheDocument();
  });

  it("uses thinking summary label while active", () => {
    render(
      <RunConsole
        run={baseRun({
          thinkingText: "step one\nstep two",
        })}
      />,
    );
    expect(screen.getByText("思考中…")).toBeInTheDocument();
  });

  it("shows file diff when tool.end includes fileDiff", async () => {
    render(
      <RunConsole
        run={baseRun({
          active: false,
          events: [
            {
              type: "tool.start",
              tool: "edit_file",
              toolCallId: "d1",
              argsPreview: '{"path":"src/a.ts"}',
              timestamp: ts,
            },
            {
              type: "tool.end",
              tool: "edit_file",
              toolCallId: "d1",
              fileDiff: {
                path: "src/a.ts",
                added: 1,
                removed: 1,
                diff: "--- a/src/a.ts\n-old\n+new",
              },
              timestamp: ts,
            },
          ],
        })}
      />,
    );
    await waitFor(() => {
      expect(screen.getAllByText("src/a.ts").length).toBeGreaterThan(0);
      expect(screen.getAllByText("+1").length).toBeGreaterThan(0);
      expect(screen.getAllByText("−1").length).toBeGreaterThan(0);
    });
  });

  it("expands shell output preview", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line-${i}`).join("\n");
    render(
      <RunConsole
        run={baseRun({
          active: false,
          events: [
            {
              type: "tool.start",
              tool: "bash",
              toolCallId: "s",
              argsPreview: '{"command":"npm test"}',
              timestamp: ts,
            },
            {
              type: "tool.update",
              tool: "bash",
              toolCallId: "s",
              outputPreview: lines,
              timestamp: ts,
            },
            { type: "tool.end", tool: "bash", toolCallId: "s", timestamp: ts },
          ],
        })}
      />,
    );
    expect(screen.getByText("npm test")).toBeInTheDocument();
    const pre = () => document.querySelector(".run-tool-shell-pre");
    expect(pre()?.textContent).not.toContain("line-9");
    expect(screen.getByRole("button", { name: /显示全部/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /显示全部/ }));
    expect(pre()?.textContent).toContain("line-9");
  });
});
