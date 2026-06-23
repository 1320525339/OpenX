import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ChatThreadItem } from "../lib/chat-thread";
import { ChatThreadViewport } from "./ChatThreadViewport";

function userMsg(key: string, text: string): ChatThreadItem {
  return {
    kind: "message",
    key,
    message: { role: "user", text, timestamp: "2026-01-01T00:00:00.000Z" },
  };
}

describe("ChatThreadViewport", () => {
  it("renders hot zone items", () => {
    const items: ChatThreadItem[] = [];
    for (let i = 0; i < 22; i += 1) {
      items.push(userMsg(`u${i}`, `question ${i}`));
    }
    render(
      <ChatThreadViewport
        items={items}
        renderItem={(item) =>
          item.kind === "message" ? <p>{item.message.text}</p> : null
        }
      />,
    );
    expect(screen.getByText("question 21")).toBeInTheDocument();
  });

  it("hides load-more after expanding cold pages", () => {
    const items: ChatThreadItem[] = [];
    for (let i = 0; i < 40; i += 1) {
      items.push(userMsg(`u${i}`, `q${i}`));
    }
    render(
      <ChatThreadViewport
        items={items}
        renderItem={(item) =>
          item.kind === "message" ? <span>{item.message.text}</span> : null
        }
      />,
    );
    const btn = screen.getByRole("button", { name: /加载更早对话/ });
    fireEvent.click(btn);
    expect(screen.queryByRole("button", { name: /加载更早对话/ })).not.toBeInTheDocument();
  });
});
