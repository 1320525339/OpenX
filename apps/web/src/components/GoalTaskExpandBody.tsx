import type { Goal } from "@openx/shared";
import { truncate } from "../lib/goal-detail";
import { resolveGoalDeliverables } from "../lib/goal-deliverables";
import { api } from "../api";
import {
  GoalTaskActions,
  type GoalTaskActionHandlers,
} from "./GoalTaskActions";
import { ReviewTimelineCompact } from "./ReviewTimelineCompact";

type Props = {
  goal: Goal;
  handlers?: GoalTaskActionHandlers;
};

/** 展开区：验收一行 + 结果一行 + 文件 chip + 状态操作 */
export function GoalTaskExpandBody({ goal, handlers }: Props) {
  const deliverables = resolveGoalDeliverables(goal);
  const files = deliverables.filter((d) => d.kind === "file");
  const summaryLine = goal.resultSummary?.trim().split("\n").find((l) => l.trim()) ?? "";
  const hasResult = Boolean(summaryLine) || files.length > 0;

  return (
    <div className="goal-task-expand minimal">
      {goal.acceptance?.trim() && (
        <p className="goal-task-line dim">{truncate(goal.acceptance.trim(), 88)}</p>
      )}

      {goal.status === "running" && !hasResult && (
        <div className="progress-bar goal-task-progress thin">
          <span style={{ width: `${goal.progress}%` }} />
        </div>
      )}

      {files.length > 0 && (
        <div className="goal-task-files">
          {files.slice(0, 4).map((f, i) =>
            f.kind === "file" ? (
              <button
                key={`${f.path}-${i}`}
                type="button"
                className="goal-task-file"
                title={f.path}
                onClick={(e) => {
                  e.stopPropagation();
                  void api.openInIde(f.path);
                }}
              >
                {f.label ?? f.path}
              </button>
            ) : null,
          )}
        </div>
      )}

      {summaryLine && (
        <p className="goal-task-line">{truncate(summaryLine, 120)}</p>
      )}

      {!hasResult && goal.status !== "running" && (
        <p className="goal-task-line dim">暂无结果</p>
      )}

      {goal.status === "awaiting_review" && handlers ? (
        <ReviewTimelineCompact
          goalId={goal.id}
          compact
          showFeedback
          onApprove={handlers.onApprove ? () => handlers.onApprove!(goal.id) : undefined}
          onRework={
            handlers.onRework
              ? (reason) => handlers.onRework!(goal.id, reason || undefined)
              : undefined
          }
        />
      ) : null}

      <GoalTaskActions
        goal={goal}
        handlers={
          goal.status === "awaiting_review" && handlers
            ? { onOpenDetail: handlers.onOpenDetail }
            : handlers
        }
        compact
      />
    </div>
  );
}

export function goalResultTeaser(goal: Goal): string | null {
  const deliverables = resolveGoalDeliverables(goal);
  const files = deliverables
    .filter((d) => d.kind === "file")
    .map((d) => (d.kind === "file" ? d.label ?? d.path : ""))
    .filter(Boolean)
    .slice(0, 2);
  const summaryLine = goal.resultSummary?.trim().split("\n").find((l) => l.trim()) ?? "";
  if (summaryLine) {
    return files.length > 0 ? `${summaryLine} · ${files.join("、")}` : summaryLine;
  }
  if (files.length > 0) return files.join("、");
  if (goal.status === "running") return "执行中…";
  return null;
}
