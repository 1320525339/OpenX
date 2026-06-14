import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ChatClarifyCard } from "./ChatClarifyCard";
import { CLARIFY_FREEFORM_ANSWER_ID, type CoachClarifyPayload } from "@openx/shared";

vi.mock("../lib/use-match-media", () => ({
  useMatchMedia: () => false,
}));

vi.mock("./ClarifyMermaidPreview", () => ({
  ClarifyMermaidPreview: () => <div data-testid="mermaid-preview" />,
}));

const baseClarify: CoachClarifyPayload = {
  title: "确认范围",
  questions: [
    {
      id: "scope",
      prompt: "这次希望做到哪一步？",
      options: [
        { id: "mvp", label: "最小可用版本", recommended: true },
        { id: "full", label: "完整功能" },
      ],
    },
    {
      id: "notes",
      prompt: "还有其他约束吗？",
      allowFreeform: true,
      options: [{ id: "none", label: "没有补充" }],
    },
  ],
  status: "pending",
};

function renderCard(
  props: Partial<ComponentProps<typeof ChatClarifyCard>> = {},
) {
  const onSubmit = vi.fn();
  const onDismiss = vi.fn();
  const view = render(
    <ChatClarifyCard
      clarify={baseClarify}
      onSubmit={onSubmit}
      onDismiss={onDismiss}
      {...props}
    />,
  );
  const root = view.getByRole("article", { name: "澄清问题" });
  return { ...view, root, onSubmit, onDismiss };
}

describe("ChatClarifyCard", () => {
  it("renders title and disables submit until required answers", () => {
    const { root } = renderCard();

    expect(screen.getByText("确认范围")).toBeInTheDocument();
    expect(
      within(root).getByRole("button", { name: "确认并继续" }),
    ).toBeDisabled();
  });

  it("submits selected answers", () => {
    const { root, onSubmit } = renderCard();

    fireEvent.click(within(root).getByRole("radio", { name: /最小可用版本/ }));
    fireEvent.click(within(root).getByRole("tab", { name: /还有其他约束/ }));
    fireEvent.click(within(root).getByRole("radio", { name: /没有补充/ }));
    fireEvent.click(within(root).getByRole("button", { name: "确认并继续" }));

    expect(onSubmit).toHaveBeenCalledWith(
      { scope: "mvp", notes: "none" },
      undefined,
    );
  });

  it("calls onDismiss when skip is clicked", () => {
    const { root, onDismiss } = renderCard();
    fireEvent.click(within(root).getByRole("button", { name: "跳过" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("hides dependent question until parent option matches", () => {
    const clarify: CoachClarifyPayload = {
      questions: [
        {
          id: "arch",
          prompt: "架构？",
          options: [
            { id: "mono", label: "单体" },
            { id: "micro", label: "微服务" },
          ],
        },
        {
          id: "svc",
          prompt: "拆哪些服务？",
          dependsOnIndex: 0,
          dependsOnOptionIds: ["micro"],
          options: [{ id: "auth", label: "认证" }],
        },
      ],
      status: "pending",
    };

    const view = render(
      <ChatClarifyCard clarify={clarify} onSubmit={vi.fn()} onDismiss={vi.fn()} />,
    );
    const root = view.getByRole("article", { name: "澄清问题" });

    expect(within(root).queryByRole("tab", { name: /拆哪些服务/ })).not.toBeInTheDocument();
    fireEvent.click(within(root).getByRole("radio", { name: /微服务/ }));
    expect(within(root).getByRole("tab", { name: /拆哪些服务/ })).toBeInTheDocument();
  });

  it("accepts freeform note for note-only question", () => {
    const clarify: CoachClarifyPayload = {
      questions: [{ id: "detail", prompt: "请说明你的偏好" }],
      status: "pending",
    };
    const onSubmit = vi.fn();
    const view = render(
      <ChatClarifyCard clarify={clarify} onSubmit={onSubmit} onDismiss={vi.fn()} />,
    );
    const root = view.getByRole("article", { name: "澄清问题" });

    fireEvent.change(
      within(root).getByPlaceholderText("自由补充你的偏好或约束…"),
      { target: { value: "只要后端 API" } },
    );
    fireEvent.click(within(root).getByRole("button", { name: "确认并继续" }));

    expect(onSubmit).toHaveBeenCalledWith(
      { detail: CLARIFY_FREEFORM_ANSWER_ID },
      { detail: { notes: "只要后端 API" } },
    );
  });
});
