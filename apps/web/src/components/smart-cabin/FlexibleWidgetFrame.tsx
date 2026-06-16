import type { PointerEvent, ReactNode } from "react";

type Props = {
  title: string;
  children: ReactNode;
  pinned?: boolean;
  pinnable?: boolean;
  onPinChange?: (pinned: boolean) => void;
  dragHandle?: boolean;
  onHeaderPointerDown?: (e: PointerEvent<HTMLElement>) => void;
};

export function FlexibleWidgetFrame({
  title,
  children,
  pinned = true,
  pinnable = false,
  onPinChange,
  dragHandle = false,
  onHeaderPointerDown,
}: Props) {
  return (
    <section className="flexible-widget">
      <header
        className={`flexible-widget-head${dragHandle ? " flexible-widget-head-draggable" : ""}`}
        onPointerDown={onHeaderPointerDown}
      >
        <div className="flexible-widget-head-left">
          {dragHandle ? (
            <span className="flexible-widget-drag" title="按住拖动交换位置" aria-hidden>
              ⠿
            </span>
          ) : null}
          <h3 className="flexible-widget-title">{title}</h3>
        </div>
        <div className="flexible-widget-head-actions">
          {pinnable && onPinChange ? (
            <button
              type="button"
              className={`flexible-widget-pin${pinned ? " pinned" : ""}`}
              aria-pressed={pinned}
              title={pinned ? "取消固定" : "固定到桌面"}
              onClick={() => onPinChange(!pinned)}
            >
              {pinned ? "已固定" : "固定"}
            </button>
          ) : null}
        </div>
      </header>
      <div className="flexible-widget-body">{children}</div>
    </section>
  );
}
