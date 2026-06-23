import { useMemo } from "react";
import type { Conversation, Goal, Project } from "@openx/shared";
import { goalStatusText } from "../lib/goal-detail";
import { goalNeedsUserAttention } from "../lib/goal-attention";
import { KnowledgeSpacePanel } from "./KnowledgeSpacePanel";

type Props = {
  goals: Goal[];
  projects: Project[];
  conversations: Conversation[];
  onOpenConversation: (projectId: string, conversationId: string, goalId?: string) => void;
  onAddProject: () => void;
};

export function HomeDashboard({
  goals,
  projects,
  conversations,
  onOpenConversation,
  onAddProject,
}: Props) {
  const projectMap = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects],
  );
  const convMap = useMemo(
    () => new Map(conversations.map((c) => [c.id, c])),
    [conversations],
  );

  const urgentGoals = useMemo(
    () =>
      goals
        .filter(goalNeedsUserAttention)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 12),
    [goals],
  );

  const recentConversations = useMemo(
    () => [...conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8),
    [conversations],
  );

  if (projects.length === 0) {
    return (
      <div className="main-view dashboard-view">
        <div className="dashboard-empty">
          <h2 className="dashboard-empty-title">添加第一个项目</h2>
          <p className="dashboard-empty-desc">
            每个目录代表一个项目。添加后可在项目下创建多个对话，分别管理任务与聊天历史。
          </p>
          <button type="button" className="btn primary" onClick={onAddProject}>
            ＋ 添加项目
          </button>
        </div>
        <section className="dashboard-section dashboard-knowledge-section">
          <KnowledgeSpacePanel mode="global" embedded />
        </section>
      </div>
    );
  }

  return (
    <div className="main-view dashboard-view">
      <section className="dashboard-section">
        <h3 className="dashboard-section-title">需要你关注</h3>
        {urgentGoals.length === 0 ? (
          <p className="dashboard-muted">暂无需要你关注的任务</p>
        ) : (
          <ul className="dashboard-goal-list">
            {urgentGoals.map((goal) => {
              const conv = convMap.get(goal.conversationId);
              const project = conv ? projectMap.get(conv.projectId) : undefined;
              return (
                <li key={goal.id}>
                  <button
                    type="button"
                    className="dashboard-goal-row"
                    onClick={() => {
                      if (!conv) return;
                      onOpenConversation(conv.projectId, conv.id, goal.id);
                    }}
                  >
                    <span className="dashboard-goal-title">{goal.title}</span>
                    <span className="dashboard-goal-meta">
                      {project?.name ?? "项目"} · {conv?.title ?? "对话"} ·{" "}
                      {goalStatusText(goal)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="dashboard-section">
        <h3 className="dashboard-section-title">最近对话</h3>
        {recentConversations.length === 0 ? (
          <p className="dashboard-muted">在侧栏项目下创建对话</p>
        ) : (
          <ul className="dashboard-conv-list">
            {recentConversations.map((conv) => {
              const project = projectMap.get(conv.projectId);
              const convGoals = goals.filter((g) => g.conversationId === conv.id);
              const activeCount = convGoals.filter(
                (g) => g.status === "running" || g.status === "awaiting_review",
              ).length;
              return (
                <li key={conv.id}>
                  <button
                    type="button"
                    className="dashboard-conv-row"
                    onClick={() => onOpenConversation(conv.projectId, conv.id)}
                  >
                    <span className="dashboard-conv-title">{conv.title}</span>
                    <span className="dashboard-conv-meta">
                      {project?.name ?? "项目"}
                      {convGoals.length > 0 ? ` · ${convGoals.length} 任务` : ""}
                      {activeCount > 0 ? ` · ${activeCount} 活跃` : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="dashboard-section dashboard-knowledge-section">
        <KnowledgeSpacePanel mode="global" embedded />
      </section>
    </div>
  );
}
