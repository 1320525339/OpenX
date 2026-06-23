import { useMemo, useState } from "react";
import type { Goal, GoalRunState } from "@openx/shared";
import { goalStatusText } from "../lib/goal-detail";
import { resolveGoalDeliverables } from "../lib/goal-deliverables";
import { api } from "../api";
import { DeliveryChips } from "./DeliveryChips";
import { ReviewTimelineCompact } from "./ReviewTimelineCompact";
import { RunConsole } from "./RunConsole";
import { WorkOrderIdBadge } from "./WorkOrderIdBadge";

type LogEntry = {
  goalId: string;
  level: string;
  message: string;
  timestamp: string;
};

type EvidenceTab = "run" | "files" | "review";

type Props = {
  goal?: Goal;
  run?: GoalRunState;
  goals: Goal[];
  logs?: LogEntry[];
  onSelectGoal?: (id: string) => void;
  surface?: "preview" | "evidence";
};

const EVIDENCE_TABS: { id: EvidenceTab; label: string }[] = [
  { id: "run", label: "运行日志" },
  { id: "files", label: "变更文件" },
  { id: "review", label: "审查记录" },
];

export function PreviewRail({
  goal,
  run,
  goals,
  logs = [],
  onSelectGoal,
  surface = "preview",
}: Props) {
  const evidenceMode = surface === "evidence";
  const panelTitle = evidenceMode ? "交付证据" : "产物预览";
  const [evidenceTab, setEvidenceTab] = useState<EvidenceTab>("run");

  const deliverables = useMemo(
    () => (goal ? resolveGoalDeliverables(goal) : []),
    [goal],
  );

  const fileDeliverables = useMemo(
    () => deliverables.filter((d) => d.kind === "file"),
    [deliverables],
  );

  const goalLogs = useMemo(
    () => (goal ? logs.filter((l) => l.goalId === goal.id).slice(-40) : []),
    [goal, logs],
  );

  const awaitingReview = useMemo(
    () => goals.filter((g) => g.status === "awaiting_review"),
    [goals],
  );

  const hasRunEvidence =
    Boolean(run && (run.active || run.events.length > 0 || run.liveText)) ||
    goalLogs.length > 0;
  const hasReviewEvidence = goal?.status === "awaiting_review" || goal?.effectStatus != null;

  if (!goal) {
    return (
      <aside className={`preview-rail preview-rail-empty${evidenceMode ? " preview-rail-evidence" : ""}`}>
        <div className="preview-rail-head">
          <h3 className="preview-rail-title">{panelTitle}</h3>
        </div>
        <p className="preview-rail-hint">
          {evidenceMode
            ? "选择任务后，这里展示运行日志、变更文件与审查记录。"
            : "选择左侧任务，或等待执行产出后，这里会显示文件预览与 Diff。"}
        </p>
        {awaitingReview.length > 0 ? (
          <div className="preview-rail-section">
            <p className="preview-rail-section-label">待验收</p>
            <ul className="preview-rail-quick-list">
              {awaitingReview.slice(0, 6).map((g) => (
                <li key={g.id}>
                  <button
                    type="button"
                    className="preview-rail-quick-item"
                    onClick={() => onSelectGoal?.(g.id)}
                  >
                    {g.orderNo > 0 ? (
                      <WorkOrderIdBadge orderNo={g.orderNo} />
                    ) : null}
                    <span>{g.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </aside>
    );
  }

  if (evidenceMode) {
    return (
      <aside className="preview-rail preview-rail-evidence">
        <div className="preview-rail-head preview-rail-evidence-head">
          <h3 className="preview-rail-title">{panelTitle}</h3>
        </div>

        <div className="evidence-tabs" role="tablist" aria-label="交付证据">
          {EVIDENCE_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={evidenceTab === tab.id}
              className={`evidence-tab${evidenceTab === tab.id ? " active" : ""}`}
              onClick={() => setEvidenceTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="preview-rail-evidence-body panel-scroll">
          {evidenceTab === "run" ? (
            <div className="preview-rail-section preview-rail-run">
              {run && (run.active || run.events.length > 0 || run.liveText) ? (
                <RunConsole run={run} compact />
              ) : null}
              {goalLogs.length > 0 ? (
                <ul className="preview-rail-log-list">
                  {goalLogs.map((l, i) => (
                    <li key={`${l.timestamp}-${i}`} className={l.level}>
                      <time>{new Date(l.timestamp).toLocaleTimeString("zh-CN")}</time>
                      <em>{l.level}</em>
                      <span>{l.message}</span>
                    </li>
                  ))}
                </ul>
              ) : !hasRunEvidence ? (
                <p className="preview-rail-hint preview-rail-empty-evidence">暂无证据</p>
              ) : null}
            </div>
          ) : null}

          {evidenceTab === "files" ? (
            <div className="preview-rail-section preview-rail-deliverables">
              {fileDeliverables.length > 0 ? (
                <ul className="evidence-file-list">
                  {fileDeliverables.map((f, i) =>
                    f.kind === "file" ? (
                      <li key={`${f.path}-${i}`}>
                        <button
                          type="button"
                          className="evidence-file-item"
                          onClick={() => void api.openInIde(f.path)}
                        >
                          <span className="evidence-file-name">{f.label ?? f.path}</span>
                          <span className="evidence-file-path">{f.path}</span>
                        </button>
                      </li>
                    ) : null,
                  )}
                </ul>
              ) : deliverables.length > 0 ? (
                <DeliveryChips items={deliverables} />
              ) : goal.resultSummary?.trim() ? (
                <p className="preview-rail-result-summary">{goal.resultSummary.trim().slice(0, 600)}</p>
              ) : (
                <p className="preview-rail-hint preview-rail-empty-evidence">暂无变更文件</p>
              )}
            </div>
          ) : null}

          {evidenceTab === "review" ? (
            <div className="preview-rail-section preview-rail-review">
              {hasReviewEvidence || goal.status === "done" ? (
                <ReviewTimelineCompact goalId={goal.id} />
              ) : (
                <p className="preview-rail-hint preview-rail-empty-evidence">暂无审查记录</p>
              )}
            </div>
          ) : null}
        </div>
      </aside>
    );
  }

  return (
    <aside className="preview-rail">
      <div className="preview-rail-head">
        <div className="preview-rail-head-main">
          {goal.orderNo > 0 ? <WorkOrderIdBadge orderNo={goal.orderNo} /> : null}
          <h3 className="preview-rail-title">{goal.title}</h3>
        </div>
        <span className="preview-rail-meta">
          {goalStatusText(goal)} · {goal.progress}%
        </span>
      </div>

      {run && (run.active || run.events.length > 0 || run.liveText) ? (
        <div className="preview-rail-section preview-rail-run">
          <p className="preview-rail-section-label">执行过程</p>
          <RunConsole run={run} compact />
        </div>
      ) : null}

      <div className="preview-rail-section preview-rail-deliverables">
        <p className="preview-rail-section-label">
          交付物{deliverables.length > 0 ? ` · ${deliverables.length}` : ""}
        </p>
        {deliverables.length === 0 ? (
          <p className="preview-rail-hint">
            {goal.status === "running"
              ? "执行中，产物将在这里出现。"
              : goal.resultSummary?.trim()
                ? goal.resultSummary.trim().slice(0, 400)
                : "暂无结构化交付物。"}
          </p>
        ) : (
          <DeliveryChips items={deliverables} />
        )}
      </div>

      {goal.acceptance?.trim() ? (
        <div className="preview-rail-section">
          <p className="preview-rail-section-label">验收标准</p>
          <p className="preview-rail-acceptance">{goal.acceptance}</p>
        </div>
      ) : null}
    </aside>
  );
}
