import { useMemo } from "react";
import type { Conversation, Goal, Project } from "@openx/shared";
import { SYSTEM_PROJECT_ID, isSystemConversationId, isProjectGoalVaultConversationId } from "@openx/shared";
import { pickWorkspaceDirectory } from "../lib/workspace";
import { WorkspacePicker } from "./WorkspacePicker";
import { RowClearButton } from "./RowClearButton";
import { RowDeleteButton } from "./RowDeleteButton";

export type AppView = "home" | "console" | "project" | "conversation" | "settings";

type Props = {
  active: AppView;
  projects: Project[];
  conversations: Conversation[];
  goals: Goal[];
  selectedProjectId: string | null;
  selectedConversationId: string | null;
  expandedProjectIds: Set<string>;
  onHome: () => void;
  onOpenConsole: () => void;
  onOpenProject: (projectId: string) => void;
  onOpenConversation: (projectId: string, conversationId: string) => void;
  onToggleProject: (projectId: string) => void;
  onAddProject: (workspaceDir: string) => Promise<void>;
  onNewConversation: (projectId: string) => void;
  onNewRoundtable?: (projectId: string) => void;
  onDeleteProject?: (projectId: string) => void;
  onDeleteConversation?: (conversationId: string) => void;
  onClearConversation?: (conversationId: string) => void;
  onClearConsoleConversation?: () => void;
  onSettings: () => void;
  onNewGoal: () => void;
  inboxBadgeCount?: number;
  consoleBadgeCount?: number;
  systemWorkspaceRoot?: string;
  systemWorkspaceResolved?: string;
  onSystemWorkspaceSave?: (path: string) => void | Promise<void>;
};

function convBadge(goals: Goal[], conversationId: string): number {
  return goals.filter(
    (g) =>
      g.conversationId === conversationId &&
      (g.status === "running" || g.status === "awaiting_review"),
  ).length;
}

function projectBadge(goals: Goal[], projectId: string, conversations: Conversation[]): number {
  const convIds = new Set(
    conversations.filter((c) => c.projectId === projectId).map((c) => c.id),
  );
  return goals.filter(
    (g) =>
      convIds.has(g.conversationId) &&
      (g.status === "running" || g.status === "awaiting_review"),
  ).length;
}

export function SideNav({
  active,
  projects,
  conversations,
  goals,
  selectedProjectId,
  selectedConversationId,
  expandedProjectIds,
  onHome,
  onOpenConsole,
  onOpenProject,
  onOpenConversation,
  onToggleProject,
  onAddProject,
  onNewConversation,
  onNewRoundtable,
  onDeleteProject,
  onDeleteConversation,
  onClearConversation,
  onClearConsoleConversation,
  onSettings,
  onNewGoal,
  inboxBadgeCount = 0,
  consoleBadgeCount = 0,
  systemWorkspaceRoot = "",
  systemWorkspaceResolved,
  onSystemWorkspaceSave,
}: Props) {
  const userProjects = useMemo(
    () => projects.filter((p) => p.id !== SYSTEM_PROJECT_ID),
    [projects],
  );

  const convByProject = useMemo(() => {
    const map = new Map<string, Conversation[]>();
    for (const c of conversations) {
      if (isProjectGoalVaultConversationId(c.id)) continue;
      const list = map.get(c.projectId) ?? [];
      list.push(c);
      map.set(c.projectId, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    return map;
  }, [conversations]);

  const handleAddProject = async () => {
    const picked = await pickWorkspaceDirectory();
    if (picked.ok) {
      await onAddProject(picked.path);
    }
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
        <button
          type="button"
          className={`sidebar-item${active === "home" ? " active" : ""}`}
          aria-current={active === "home" ? "page" : undefined}
          onClick={onHome}
        >
          <span className="sidebar-item-label">首页</span>
          {inboxBadgeCount > 0 ? (
            <span className="sidebar-badge">{inboxBadgeCount}</span>
          ) : null}
        </button>

        <button
          type="button"
          className={`sidebar-item${active === "console" ? " active" : ""}`}
          aria-current={active === "console" ? "page" : undefined}
          onClick={onOpenConsole}
        >
          <span className="sidebar-item-label">调度台</span>
          {consoleBadgeCount > 0 ? (
            <span className="sidebar-badge">{consoleBadgeCount}</span>
          ) : null}
        </button>

        <div className="sidebar-group">
          <div className="sidebar-group-title">项目</div>
          {userProjects.map((project) => {
            const expanded = expandedProjectIds.has(project.id);
            const projectConvs = convByProject.get(project.id) ?? [];
            const pBadge = projectBadge(goals, project.id, conversations);
            const projectActive =
              active === "project" && selectedProjectId === project.id;

            return (
              <div key={project.id} className="sidebar-tree-project">
                <div className="sidebar-tree-row">
                  <button
                    type="button"
                    className="sidebar-tree-toggle"
                    aria-expanded={expanded}
                    onClick={() => onToggleProject(project.id)}
                  >
                    {expanded ? "▾" : "▸"}
                  </button>
                  <button
                    type="button"
                    className={`sidebar-tree-item${projectActive ? " active" : ""}`}
                    onClick={() => onOpenProject(project.id)}
                    title={project.workspaceDir}
                  >
                    <span className="sidebar-tree-label">{project.name}</span>
                    {pBadge > 0 ? (
                      <span className="sidebar-badge">{pBadge}</span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    className="sidebar-tree-add-conv"
                    aria-label={`在 ${project.name} 下新建对话`}
                    title="新对话"
                    onClick={(e) => {
                      e.stopPropagation();
                      onNewConversation(project.id);
                    }}
                  >
                    +
                  </button>
                  {onNewRoundtable ? (
                    <button
                      type="button"
                      className="sidebar-tree-add-conv sidebar-tree-add-roundtable"
                      aria-label={`在 ${project.name} 下新建圆桌`}
                      title="新圆桌"
                      onClick={(e) => {
                        e.stopPropagation();
                        onNewRoundtable(project.id);
                      }}
                    >
                      🪑
                    </button>
                  ) : null}
                  {onDeleteProject ? (
                    <RowDeleteButton
                      label={`删除项目 ${project.name}`}
                      title="删除项目及下属对话与任务"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteProject(project.id);
                      }}
                    />
                  ) : null}
                </div>

                {expanded ? (
                  <div className="sidebar-tree-children">
                    {projectConvs.map((conv) => {
                      const cBadge = convBadge(goals, conv.id);
                      const convActive =
                        active === "conversation" &&
                        selectedConversationId === conv.id;
                      return (
                        <div
                          key={conv.id}
                          className={`sidebar-tree-conv-row${convActive ? " active" : ""}`}
                        >
                          <button
                            type="button"
                            className={`sidebar-tree-conv${convActive ? " active" : ""}`}
                            onClick={() => onOpenConversation(project.id, conv.id)}
                          >
                            <span className="sidebar-tree-label">
                              {conv.mode === "roundtable" ? "🪑 " : ""}
                              {conv.title}
                            </span>
                            {cBadge > 0 ? (
                              <span className="sidebar-badge">{cBadge}</span>
                            ) : null}
                          </button>
                          {onClearConversation &&
                          !isProjectGoalVaultConversationId(conv.id) ? (
                            <RowClearButton
                              label={`清空对话 ${conv.title}`}
                              title="清空对话内容（保留会话与任务）"
                              onClick={(e) => {
                                e.stopPropagation();
                                onClearConversation(conv.id);
                              }}
                            />
                          ) : null}
                          {onDeleteConversation &&
                          !isSystemConversationId(conv.id) &&
                          !isProjectGoalVaultConversationId(conv.id) ? (
                            <RowDeleteButton
                              label={`删除对话 ${conv.title}`}
                              title="删除会话；已创建任务保留并迁入任务保管箱"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteConversation(conv.id);
                              }}
                            />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}

          <button
            type="button"
            className="sidebar-tree-add-project"
            onClick={() => void handleAddProject()}
          >
            ＋ 添加项目
          </button>
        </div>

        <button
          type="button"
          className={`sidebar-item${active === "settings" ? " active" : ""}`}
          aria-current={active === "settings" ? "page" : undefined}
          onClick={onSettings}
        >
          <span className="sidebar-item-label">设置</span>
        </button>
      </div>

      {active === "console" ? (
        <div className="sidebar-footer">
          <span className="sidebar-footer-label">系统工作目录</span>
          {onSystemWorkspaceSave ? (
            <WorkspacePicker
              variant="sidebar"
              compact
              value={systemWorkspaceRoot}
              resolvedPath={systemWorkspaceResolved}
              onSave={onSystemWorkspaceSave}
            />
          ) : null}
          <button type="button" className="btn primary sidebar-new" onClick={onNewGoal}>
            ＋ 发布任务
          </button>
          {onClearConsoleConversation ? (
            <button
              type="button"
              className="btn sidebar-new"
              onClick={onClearConsoleConversation}
              title="清空调度台聊天记录（保留任务）"
            >
              清空调度台对话
            </button>
          ) : null}
        </div>
      ) : null}
    </nav>
  );
}
