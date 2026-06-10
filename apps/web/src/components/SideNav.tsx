import type { ReactNode } from "react";
import { WorkspacePicker } from "./WorkspacePicker";

export type AppView = "home" | "running" | "review" | "assistant" | "settings";

type SseStatus = "connected" | "reconnecting" | "disconnected";

type NavItem = {
  id: AppView;
  label: string;
  icon: ReactNode;
  badge?: number;
};

type NavGroup = {
  title?: string;
  items: NavItem[];
};

type Props = {
  active: AppView;
  onChange: (view: AppView) => void;
  onNewGoal: () => void;
  runningCount?: number;
  reviewCount?: number;
  workspaceRoot?: string;
  workspaceResolved?: string;
  onWorkspaceSave?: (path: string) => Promise<void>;
  sseStatus?: SseStatus;
};

function NavIcon({ children }: { children: ReactNode }) {
  return (
    <span className="sidebar-icon" aria-hidden>
      {children}
    </span>
  );
}

function IconHome() {
  return (
    <NavIcon>
      <svg viewBox="0 0 20 20" fill="none">
        <path
          d="M4 9.5 10 4l6 5.5V16a1 1 0 0 1-1 1h-4v-5H9v5H5a1 1 0 0 1-1-1V9.5Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    </NavIcon>
  );
}

function IconRunning() {
  return (
    <NavIcon>
      <svg viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="6.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10 6.5v4l2.5 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </NavIcon>
  );
}

function IconReview() {
  return (
    <NavIcon>
      <svg viewBox="0 0 20 20" fill="none">
        <path
          d="M6 10.5 8.5 13 14 7"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <rect x="4" y="4" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </NavIcon>
  );
}

function IconAssistant() {
  return (
    <NavIcon>
      <svg viewBox="0 0 20 20" fill="none">
        <path
          d="M4 4.5h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H8l-3.5 2.5V5.5a1 1 0 0 1 1-1Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    </NavIcon>
  );
}

function IconSettings() {
  return (
    <NavIcon>
      <svg viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="2.25" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M10 2.5v2M10 15.5v2M3.5 10h2M14.5 10h2"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    </NavIcon>
  );
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: "总览",
    items: [{ id: "home", label: "首页", icon: <IconHome /> }],
  },
  {
    title: "业务功能",
    items: [
      { id: "running", label: "正在推进", icon: <IconRunning /> },
      { id: "review", label: "等我确认", icon: <IconReview /> },
    ],
  },
  {
    title: "助手与配置",
    items: [
      { id: "assistant", label: "我的助手", icon: <IconAssistant /> },
      { id: "settings", label: "设置", icon: <IconSettings /> },
    ],
  },
];

export function SideNav({
  active,
  onChange,
  onNewGoal,
  runningCount = 0,
  reviewCount = 0,
  workspaceRoot,
  workspaceResolved,
  onWorkspaceSave,
}: Props) {
  const badgeFor = (id: AppView) => {
    if (id === "running") return runningCount || undefined;
    if (id === "review") return reviewCount || undefined;
    return undefined;
  };

  return (
    <nav className="app-sidebar" aria-label="主导航">
      <div className="sidebar-brand">
        <span className="brand-mark">O</span>
        <div className="sidebar-brand-text">
          <span className="sidebar-title">OpenX</span>
          <span className="sidebar-subtitle">本机工头</span>
        </div>
      </div>

      <div className="sidebar-nav">
        {NAV_GROUPS.map((group) => (
          <div key={group.title ?? "main"} className="sidebar-group">
            {group.title ? <div className="sidebar-group-title">{group.title}</div> : null}
            {group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`sidebar-item${active === item.id ? " active" : ""}`}
                aria-current={active === item.id ? "page" : undefined}
                onClick={() => onChange(item.id)}
              >
                {item.icon}
                <span className="sidebar-item-label">{item.label}</span>
                {badgeFor(item.id) ? (
                  <span className="sidebar-badge">{badgeFor(item.id)}</span>
                ) : null}
              </button>
            ))}
          </div>
        ))}
      </div>

      {onWorkspaceSave && (
        <WorkspacePicker
          compact
          value={workspaceRoot ?? "."}
          resolvedPath={workspaceResolved}
          onSave={onWorkspaceSave}
        />
      )}

      <div className="sidebar-footer">
        <button type="button" className="btn primary sidebar-new" onClick={onNewGoal}>
          ＋ 新目标
        </button>
      </div>
    </nav>
  );
}
