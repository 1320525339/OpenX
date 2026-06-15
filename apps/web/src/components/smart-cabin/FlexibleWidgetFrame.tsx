import type { ReactNode } from "react";

type Props = {
  title: string;
  children: ReactNode;
  pinned?: boolean;
  pinnable?: boolean;
  onPinChange?: (pinned: boolean) => void;
};

export function FlexibleWidgetFrame({
  title,
  children,
  pinned = true,
  pinnable = false,
  onPinChange,
}: Props) {
  return (
    <section className="flexible-widget">
      <header className="flexible-widget-head">
        <h3 className="flexible-widget-title">{title}</h3>
        {pinnable && onPinChange ? (
          <button
            type="button"
            className={`flexible-widget-pin${pinned ? " pinned" : ""}`}
            aria-pressed={pinned}
            title={pinned ? "取消固定，主 Widget 占满宽度" : "固定到桌面，与主 Widget 并排"}
            onClick={() => onPinChange(!pinned)}
          >
            {pinned ? "已固定" : "固定"}
          </button>
        ) : null}
      </header>
      <div className="flexible-widget-body">{children}</div>
    </section>
  );
}
