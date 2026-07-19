import type { MouseEvent } from "react";

type Props = {
  label: string;
  title?: string;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
};

/** 悬停行时显示的清空对话图标（保留会话壳） */
export function RowClearButton({ label, title, onClick }: Props) {
  return (
    <button
      type="button"
      className="sidebar-row-clear"
      aria-label={label}
      title={title ?? label}
      onClick={onClick}
    >
      <svg viewBox="0 0 20 20" fill="none" aria-hidden>
        <path
          d="M4.5 6.5h11M7 6.5V5.2c0-.7.5-1.2 1.2-1.2h3.6c.7 0 1.2.5 1.2 1.2v1.3"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <path
          d="M6.2 6.5l.7 8.2c.05.6.55 1.1 1.15 1.1h4c.6 0 1.1-.5 1.15-1.1l.7-8.2"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M8.2 9.2l.4 4.2M11.8 9.2l-.4 4.2"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
