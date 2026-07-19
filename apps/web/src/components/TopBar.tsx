import { useMemo } from "react";
import type { Conversation, Goal, Project } from "@openx/shared";
import { isPausedGoal } from "@openx/shared";
import type { AppView } from "./SideNav";
import { goalNeedsUserAttention } from "../lib/goal-attention";
import { goalStatusText } from "../lib/goal-detail";
import { GOAL_STATUS_FILTER_LABELS } from "../lib/workflow-ui";
import { WorkOrderIdBadge } from "./WorkOrderIdBadge";
import { SidebarToggle } from "./SidebarToggle";

type Props = {
  view: AppView;
  goals: Goal[];
  statusFilter: string;
  filteredCount: number;
  detailGoal?: Goal;
  selectedProject?: Project;
  selectedConversation?: Conversation;
  sseStatus: "connected" | "reconnecting" | "disconnected";
  onUrgentClick?: (goalId: string) => void;
  onNewGoal?: () => void;
  sidebarOpen?: boolean;
  onSidebarToggle?: () => void;
};

function countByStatus(goals: Goal[], status: Goal["status"]) {
  return goals.filter((g) => g.status === status).length;
}

export function TopBar({
  view,
  goals,
  statusFilter,
  filteredCount,
  detailGoal,
  selectedProject,
  selectedConversation,
  sseStatus,
  onUrgentClick,
  onNewGoal,
  sidebarOpen,
  onSidebarToggle,
}: Props) {
  const stats = useMemo(
    () => ({
      total: goals.length,
      running: countByStatus(goals, "running"),
      review: countByStatus(goals, "awaiting_review"),
    }),
    [goals],
  );

  const urgentGoal = useMemo(() => {
    const paused = goals.find((g) => isPausedGoal(g));
    if (paused) return paused;
    const review = goals.find((g) => g.status === "awaiting_review");
    if (review) return review;
    return goals.find((g) => g.status === "failed") ?? null;
  }, [goals]);

  const sseWarning =
    sseStatus === "disconnected"
      ? "与后台断开"
      : sseStatus === "reconnecting"
        ? "连接中…"
        : null;

  let primary = "";
  let secondary = "";

  if (detailGoal) {
    primary = detailGoal.title;
    secondary = `${goalStatusText(detailGoal)} · ${detailGoal.progress}%`;
  } else if (view === "conversation" && selectedConversation) {
    primary = selectedConversation.title;
    secondary = selectedProject
      ? `${selectedProject.name} · ${GOAL_STATUS_FILTER_LABELS[statusFilter] ?? statusFilter} ${filteredCount}`
      : `${GOAL_STATUS_FILTER_LABELS[statusFilter] ?? statusFilter} ${filteredCount}`;
    if (stats.running > 0 || stats.review > 0) {
      secondary += ` · ${stats.running} 进行中 · ${stats.review} 待确认`;
    }
  } else if (view === "project" && selectedProject) {
    primary = selectedProject.name;
    const projectGoalCount = goals.length;
    secondary =
      projectGoalCount > 0
        ? `${projectGoalCount} 个任务 · ${selectedProject.workspaceDir}`
        : selectedProject.workspaceDir;
  } else if (view === "console") {
    primary = "调度台";
    secondary = `${stats.running} 进行中 · ${stats.review} 待确认 · 系统任务池`;
  } else if (view === "home") {
    primary = "首页";
    const urgent = goals.filter(goalNeedsUserAttention).length;
    secondary = urgent > 0 ? `${urgent} 项需要你关注` : "跨项目态势";
  }

  return (
    <header className="app-topbar" aria-label="运行台顶栏">
      <div className="topbar-leading">
        {onSidebarToggle != null && sidebarOpen != null ? (
          <SidebarToggle open={sidebarOpen} onToggle={onSidebarToggle} />
        ) : null}
        <div className="topbar-primary">
        {detailGoal?.orderNo && detailGoal.orderNo > 0 ? (
          <WorkOrderIdBadge orderNo={detailGoal.orderNo} className="topbar-order-id" />
        ) : null}
        <span className="topbar-title">{primary}</span>
        {secondary ? <span className="topbar-meta">{secondary}</span> : null}
        </div>
      </div>

      <div className="topbar-actions">
        {sseWarning ? (
          <span className={`topbar-alert ${sseStatus}`}>{sseWarning}</span>
        ) : null}

        {!detailGoal && urgentGoal && onUrgentClick && view === "home" ? (
          <button
            type="button"
            className="topbar-urgent"
            onClick={() => onUrgentClick(urgentGoal.id)}
          >
            「{urgentGoal.title}」
            {urgentGoal.status === "awaiting_review"
              ? "等你确认"
              : urgentGoal.crewStatus === "awaiting_user"
                ? "等你决策"
                : "卡住了"}{" "}
            →
          </button>
        ) : null}

        {!detailGoal && view === "conversation" && onNewGoal ? (
          <button type="button" className="btn compact primary" onClick={onNewGoal}>
            ＋ 新任务
          </button>
        ) : null}
      </div>
    </header>
  );
}
