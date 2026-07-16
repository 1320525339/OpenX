import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { emptyPinLayout, normalizeLayout } from "../../lib/pin-desktop";
import { PinDesktopCanvas } from "./PinDesktopCanvas";

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

describe("PinDesktopCanvas width interaction", () => {
  it("uses a single seam resize handle without card-edge duplicate", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const onSeamCommit = vi.fn();
    const layout = normalizeLayout({
      ...emptyPinLayout(),
      cols: ["chat", "tasks", null],
    });

    render(
      <PinDesktopCanvas
        layout={layout}
        widgets={{ chat: <p>Chat content</p>, tasks: <p>Task content</p> }}
        getSlotLabel={(widget) => (widget === "chat" ? "Chat" : "Tasks")}
        onUnpin={vi.fn()}
        onApplyDrop={vi.fn()}
        onSeamCommit={onSeamCommit}
      />,
    );

    expect(screen.getByRole("separator", { name: "调整Chat宽度" })).toBeInTheDocument();
    expect(screen.queryByRole("separator", { name: "拖动调整Chat宽度" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "卡片宽度" })).not.toBeInTheDocument();
  });

  it("commits seam resize when seam drag expands into empty neighbor space", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 240,
      height: 240,
      left: 0,
      right: 300,
      top: 0,
      width: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    const onSeamCommit = vi.fn();
    const layout = normalizeLayout({
      ...emptyPinLayout(),
      cols: ["chat", null, "tasks"],
    });

    render(
      <PinDesktopCanvas
        layout={layout}
        widgets={{ chat: <p>Chat content</p>, tasks: <p>Task content</p> }}
        getSlotLabel={(widget) => (widget === "chat" ? "Chat" : "Tasks")}
        onUnpin={vi.fn()}
        onApplyDrop={vi.fn()}
        onSeamCommit={onSeamCommit}
      />,
    );

    const seam = screen.getByRole("separator", { name: "调整Chat宽度" });
    fireEvent.pointerDown(seam, { button: 0, clientX: 96, pointerId: 7 });
    fireEvent.pointerMove(window, { clientX: 205, pointerId: 7 });
    fireEvent.pointerUp(window, { clientX: 205, pointerId: 7 });

    expect(onSeamCommit).toHaveBeenCalled();
    const [, preview] = onSeamCommit.mock.calls[0]!;
    expect(preview.commitLeftWide || (preview.commitSpan != null && preview.commitSpan >= 2)).toBe(
      true,
    );
  });

  it("commits the tier under the pointer on release, not the furthest tier reached", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 240,
      height: 240,
      left: 0,
      right: 300,
      top: 0,
      width: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    const onSeamCommit = vi.fn();
    const layout = normalizeLayout({
      ...emptyPinLayout(),
      cols: ["chat", null, "tasks"],
    });

    render(
      <PinDesktopCanvas
        layout={layout}
        widgets={{ chat: <p>Chat content</p>, tasks: <p>Task content</p> }}
        getSlotLabel={(widget) => (widget === "chat" ? "Chat" : "Tasks")}
        onUnpin={vi.fn()}
        onApplyDrop={vi.fn()}
        onSeamCommit={onSeamCommit}
      />,
    );

    const seam = screen.getByRole("separator", { name: "调整Chat宽度" });
    fireEvent.pointerDown(seam, { button: 0, clientX: 96, pointerId: 8 });
    fireEvent.pointerMove(window, { clientX: 205, pointerId: 8 });
    fireEvent.pointerMove(window, { clientX: 105, pointerId: 8 });
    fireEvent.pointerUp(window, { clientX: 105, pointerId: 8 });

    const [, preview] = onSeamCommit.mock.calls[0]!;
    expect(preview.commitSpan).toBe(1);
    expect(preview.commitLeftWide).toBe(false);
  });
});
