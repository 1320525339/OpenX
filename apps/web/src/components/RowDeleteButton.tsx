import type { MouseEvent } from "react";

type Props = {
  label: string;
  title?: string;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
};

/** Cursor 风格：悬停行时显示的归档/删除图标 */
export function RowDeleteButton({ label, title, onClick }: Props) {
  return (
    <button
      type="button"
      className="sidebar-row-delete"
      aria-label={label}
      title={title ?? label}
      onClick={onClick}
    >
      <svg viewBox="0 0 20 20" fill="none" aria-hidden>
        <rect
          x="4"
          y="5"
          width="12"
          height="11"
          rx="1.5"
          stroke="currentColor"
          strokeWidth="1.4"
        />
        <path
          d="M7.5 5V4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1M4 5h12"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <path
          d="M8 9v4M12 9v4"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
