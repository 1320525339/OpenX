import { useMemo, useState, type MouseEvent } from "react";

import type {
  BatchGoalsAction,
  Conversation,
  Goal,
  Project,
} from "@openx/shared";
import { goalMatchesDisplayFilter, isSystemConversationId, isProjectGoalVaultConversationId } from "@openx/shared";

import { api } from "../api";

import { GoalsWorkspace } from "./GoalsWorkspace";
import { KnowledgeSpacePanel } from "./KnowledgeSpacePanel";
import { ProjectBriefTemplatePanel } from "./ProjectBriefTemplatePanel";
import { RowClearButton } from "./RowClearButton";
import { RowDeleteButton } from "./RowDeleteButton";



type GoalActions = {

  onApprove: (id: string) => Promise<boolean>;

  onRework: (id: string, reason?: string) => Promise<boolean>;

  onStart: (id: string) => Promise<boolean>;

};



type Props = {

  project: Project;

  conversations: Conversation[];

  goals: Goal[];

  onOpenConversation: (conversationId: string, goalId?: string) => void;

  onNewConversation: () => void;

  onNewRoundtable?: () => void;

  onDeleteConversation?: (conversationId: string) => void;

  onClearConversation?: (conversationId: string) => void;

  onForgetProjectConversations?: () => void;

  onBatchAction: (action: BatchGoalsAction, ids: string[]) => Promise<void>;

  goalActions: GoalActions;

};



function filterProjectGoals(goals: Goal[], filter: string): Goal[] {
  return goals.filter((g) => goalMatchesDisplayFilter(g, filter));
}



export function ProjectPage({

  project,

  conversations,

  goals,

  onOpenConversation,

  onNewConversation,

  onNewRoundtable,

  onDeleteConversation,

  onClearConversation,

  onForgetProjectConversations,

  onBatchAction,

  goalActions,

}: Props) {

  const [statusFilter, setStatusFilter] = useState("all");

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [editMode, setEditMode] = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());



  const conversationTitles = useMemo(() => {

    const map: Record<string, string> = {};

    for (const conv of conversations) {
      if (isProjectGoalVaultConversationId(conv.id)) {
        map[conv.id] = "已保留任务";
        continue;
      }
      map[conv.id] = conv.title;
    }

    return map;

  }, [conversations]);

  const visibleConversations = useMemo(
    () => conversations.filter((c) => !isProjectGoalVaultConversationId(c.id)),
    [conversations],
  );



  const filteredGoals = useMemo(

    () => filterProjectGoals(goals, statusFilter),

    [goals, statusFilter],

  );



  const activeCount = goals.filter(

    (g) => g.status === "running" || g.status === "awaiting_review",

  ).length;



  const openGoalInConversation = (goalId: string) => {

    const goal = goals.find((g) => g.id === goalId);

    if (!goal) return;

    onOpenConversation(goal.conversationId, goalId);

  };



  return (

    <div className="main-view project-view">

      <header className="project-header">

        <div>

          <h2 className="project-title">{project.name}</h2>

          <p className="project-path" title={project.workspaceDir}>

            {project.workspaceDir}

          </p>

        </div>

        <button

          type="button"

          className="btn compact"

          onClick={() => void api.openInIde(project.workspaceDir)}

        >

          在 IDE 打开

        </button>

      </header>



      <div className="project-stats">

        <span>{conversations.length} 个对话</span>

        <span>{goals.length} 个任务</span>

        {activeCount > 0 ? <span>{activeCount} 进行中/待确认</span> : null}

      </div>

      <div className="project-layout">

        <section className="project-board">

          <GoalsWorkspace

            goals={filteredGoals}

            allGoals={goals}

            filter={statusFilter}

            onFilterChange={setStatusFilter}

            selectedId={selectedId}

            onSelect={setSelectedId}

            onOpenDetail={openGoalInConversation}

            onNewGoal={onNewConversation}

            hideFooterNewGoal

            editMode={editMode}

            onEditModeChange={setEditMode}

            selectedIds={selectedIds}

            onToggleSelect={(id) => {

              setSelectedIds((prev) => {

                const next = new Set(prev);

                if (next.has(id)) next.delete(id);

                else next.add(id);

                return next;

              });

            }}

            onSelectAllVisible={(visibleIds) =>
              setSelectedIds(
                new Set(visibleIds ?? filteredGoals.map((g) => g.id)),
              )
            }

            onClearSelection={() => setSelectedIds(new Set())}

            onBatchAction={onBatchAction}

            conversationTitles={conversationTitles}

            goalActions={goalActions}

            paginationScope={{ projectId: project.id }}

          />

        </section>



        <section className="project-section project-conversations">

          <div className="project-section-head">

            <h3>对话</h3>

            <button type="button" className="btn compact" onClick={onNewConversation}>

              ＋ 新对话

            </button>

            {onNewRoundtable ? (

              <button type="button" className="btn compact" onClick={onNewRoundtable}>

                🪑 新圆桌

              </button>

            ) : null}

            {onForgetProjectConversations ? (

              <button
                type="button"
                className="btn compact"
                onClick={onForgetProjectConversations}
                title="清空本项目全部对话（保留任务与知识）"
              >

                清空本项目全部对话

              </button>

            ) : null}

          </div>

          {visibleConversations.length === 0 ? (

            <p className="dashboard-muted">还没有对话，创建一个开始推进</p>

          ) : (

            <ul className="dashboard-conv-list">

              {visibleConversations.map((conv) => {

                const convGoals = goals.filter((g) => g.conversationId === conv.id);

                const active = convGoals.filter(

                  (g) => g.status === "running" || g.status === "awaiting_review",

                ).length;

                return (

                  <li key={conv.id} className="dashboard-conv-item">
                    <button
                      type="button"
                      className="dashboard-conv-row"
                      onClick={() => onOpenConversation(conv.id)}
                    >
                      <span className="dashboard-conv-title">{conv.title}</span>
                      <span className="dashboard-conv-meta">
                        {convGoals.length} 任务
                        {active > 0 ? ` · ${active} 活跃` : ""}
                      </span>
                    </button>
                    {onClearConversation &&
                    !isSystemConversationId(conv.id) &&
                    !isProjectGoalVaultConversationId(conv.id) ? (
                      <RowClearButton
                        label={`清空对话 ${conv.title}`}
                        title="清空对话内容（保留会话与任务）"
                        onClick={(e: MouseEvent) => {
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
                        onClick={(e: MouseEvent) => {
                          e.stopPropagation();
                          onDeleteConversation(conv.id);
                        }}
                      />
                    ) : null}
                  </li>

                );

              })}

            </ul>

          )}

        </section>

        <ProjectBriefTemplatePanel project={project} />

        <KnowledgeSpacePanel
          mode="project"
          projectId={project.id}
          projectName={project.name}
          embedded
        />
      </div>

    </div>

  );

}


