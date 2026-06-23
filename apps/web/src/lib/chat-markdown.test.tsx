import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ChatMarkdown, normalizeMarkdownBullets } from "./chat-markdown";

describe("ChatMarkdown diff fence", () => {
  it("renders ```diff blocks with Hermes chat-diff seam", () => {
    const text = ["```diff", "-old line", "+new line", "```"].join("\n");
    render(<ChatMarkdown text={text} />);
    expect(document.querySelector(".chat-md-diff .chat-diff-remove")).toBeTruthy();
    expect(document.querySelector(".chat-md-diff .chat-diff-add")).toBeTruthy();
  });

  it("keeps normal code fences as pre", () => {
    render(<ChatMarkdown text={"```ts\nconst x = 1;\n```"} />);
    expect(document.querySelector(".chat-md-pre")).toBeTruthy();
    expect(document.querySelector(".chat-md-diff")).toBeFalsy();
  });

  it("converts middle-dot lines to markdown lists", () => {
    const text = "我可以：\n\n· 第一项\n· 第二项";
    expect(normalizeMarkdownBullets(text)).toBe("我可以：\n\n- 第一项\n- 第二项");
    render(<ChatMarkdown text={text} />);
    expect(document.querySelector(".chat-markdown ul li")).toBeTruthy();
    expect(document.querySelectorAll(".chat-markdown ul li")).toHaveLength(2);
  });
});
