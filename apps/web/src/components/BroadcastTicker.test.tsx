import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import type { DynamicIslandPayload, IslandAction } from "@openx/shared";
import { BroadcastTicker } from "./BroadcastTicker";

function basePayload(overrides: Partial<DynamicIslandPayload> = {}): DynamicIslandPayload {
  return {
    id: "card-1",
    kind: "broadcast",
    severity: "info",
    title: "测试卡",
    message: "内容",
    autoDismissMs: 0,
    actions: [
      {
        id: "approve",
        label: "通过",
        variant: "primary",
        action: { type: "approve", goalId: "g1" },
      },
    ],
    ...overrides,
  };
}

describe("BroadcastTicker action lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("onAction 返回 true 时不再二次 onDismiss", async () => {
    const onDismiss = vi.fn();
    const onAction = vi.fn(async (_action: IslandAction) => true);

    render(
      <BroadcastTicker
        payload={basePayload({ expanded: true })}
        displayToken={1}
        onDismiss={onDismiss}
        onAction={onAction}
      />,
    );

    await act(async () => {
      vi.advanceTimersByTime(30);
    });

    fireEvent.click(screen.getByRole("button", { name: "通过" }));

    await waitFor(() => expect(onAction).toHaveBeenCalled());
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("onAction 返回 falsy 时走 dismiss → onDismiss(token)", async () => {
    const onDismiss = vi.fn();
    const onAction = vi.fn(async () => false);

    render(
      <BroadcastTicker
        payload={basePayload({ expanded: true })}
        displayToken={7}
        onDismiss={onDismiss}
        onAction={onAction}
      />,
    );

    await act(async () => {
      vi.advanceTimersByTime(30);
    });

    fireEvent.click(screen.getByRole("button", { name: "通过" }));

    await waitFor(() => expect(onAction).toHaveBeenCalled());
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(onDismiss).toHaveBeenCalledWith(7);
  });

  it("动作开始时暂停自动关闭计时器", async () => {
    const onDismiss = vi.fn();
    let resolveAction: (value: boolean) => void = () => {};
    const onAction = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveAction = resolve;
        }),
    );

    render(
      <BroadcastTicker
        payload={basePayload({
          expanded: true,
          autoDismissMs: 200,
          actions: [
            {
              id: "go",
              label: "执行",
              variant: "primary",
              action: { type: "navigate", goalId: "g1" },
            },
          ],
        })}
        displayToken={3}
        onDismiss={onDismiss}
        onAction={onAction}
      />,
    );

    await act(async () => {
      vi.advanceTimersByTime(30);
    });

    fireEvent.click(screen.getByRole("button", { name: "执行" }));
    expect(onAction).toHaveBeenCalled();

    // 若未暂停，200ms 后会 auto-dismiss
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    await act(async () => {
      resolveAction(true);
    });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
