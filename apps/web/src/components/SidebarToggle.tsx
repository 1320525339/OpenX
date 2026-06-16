type Props = {
  open: boolean;
  onToggle: () => void;
};

export function SidebarToggle({ open, onToggle }: Props) {
  const label = open ? "隐藏侧边栏" : "显示侧边栏";

  return (
    <button
      type="button"
      className="sidebar-toggle-btn"
      onClick={onToggle}
      aria-label={label}
      title={`${label} (Ctrl+B)`}
    >
      <svg
        className="sidebar-toggle-icon"
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden
      >
        <rect
          x="3.5"
          y="4.5"
          width="13"
          height="11"
          rx="1.5"
          stroke="currentColor"
          strokeWidth="1.25"
        />
        <path d="M7.5 4.5v11" stroke="currentColor" strokeWidth="1.25" />
        {!open ? (
          <path d="M5.5 10h2.8" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        ) : null}
      </svg>
    </button>
  );
}
