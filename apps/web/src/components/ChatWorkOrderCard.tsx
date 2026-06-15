import type { RefinedGoal, RefinedSubGoal } from "@openx/shared";
import { DISPATCH_PERMISSION_LABELS } from "@openx/shared";
import type { ExecutorInfo } from "../api";
import { buildExecutorOptions, executorDisplayLabel } from "../lib/executors";
import { WorkOrderIdBadge } from "./WorkOrderIdBadge";
import { CrewDialogueSummary } from "./CrewDialogueSummary";

type Props = {
  refined: RefinedGoal;
  executorId: string;
  executors: ExecutorInfo[];
  recommendedId?: string;
  recommendReason?: string;
  onChange: (next: RefinedGoal) => void;
  onExecutorChange: (id: string) => void;
  /** 已创建任务的全局序号 */
  orderNo?: number;
  /** 已关联的目标 id（展示工头↔施工队协作） */
  linkedGoalId?: string;
  crewStatus?: string;
  /** 由澄清卡生成的工单：展示来源并可跳转到澄清记录 */
  sourceClarifyTitle?: string;
  onViewSourceClarify?: () => void;
};

function SubGoalRow({ sub, index }: { sub: RefinedSubGoal; index: number }) {
  return (
    <div className="chat-workorder-subgoal">
      <span className="chat-workorder-subgoal-index">{index + 1}</span>
      <div>
        <strong>{sub.title}</strong>
        <p>{sub.acceptance}</p>
        {sub.executorId ? (
          <span className="chat-workorder-tag">{executorDisplayLabel(sub.executorId)}</span>
        ) : null}
        {sub.permissionMode ? (
          <span className="chat-workorder-tag">
            {DISPATCH_PERMISSION_LABELS[sub.permissionMode]?.label ?? sub.permissionMode}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** 对话流内任务单：完整展示、无内嵌滚动，操作按钮在底部 dock */
export function ChatWorkOrderCard({
  refined,
  executorId,
  executors,
  recommendedId,
  recommendReason,
  onChange,
  onExecutorChange,
  orderNo,
  linkedGoalId,
  crewStatus,
  sourceClarifyTitle,
  onViewSourceClarify,
}: Props) {
  const subCount = refined.subGoals?.length ?? 0;
  const hasSubGoals = subCount > 0;
  const options = buildExecutorOptions(executors, true);

  const patch = (partial: Partial<RefinedGoal>) => {
    onChange({ ...refined, ...partial });
  };

  const constraintsText = refined.constraints.join("\n");
  const setConstraintsFromText = (text: string) => {
    patch({
      constraints: text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    });
  };

  return (
    <article className="chat-workorder" aria-label="待确认任务单">
      {orderNo && orderNo > 0 ? (
        <div className="chat-workorder-order-banner">
          <WorkOrderIdBadge orderNo={orderNo} />
        </div>
      ) : (
        <div className="chat-workorder-order-banner chat-workorder-order-banner-pending">
          <span className="chat-workorder-pending-id">待创建</span>
        </div>
      )}
      {linkedGoalId ? (
        <CrewDialogueSummary
          goalId={linkedGoalId}
          crewStatus={crewStatus}
          embedded
          className="chat-workorder-crew"
        />
      ) : null}
      <header className="chat-workorder-head">
        <span className="chat-workorder-label">任务单</span>
        <label className="chat-workorder-executor">
          <span className="chat-workorder-executor-label">派单</span>
          <select
            className="chat-workorder-executor-select"
            value={executorId}
            onChange={(e) => onExecutorChange(e.target.value)}
          >
            {options.map((opt) => (
              <option key={opt.id} value={opt.id} disabled={!opt.selectable}>
                {opt.label}
                {opt.id === recommendedId && opt.id !== executorId ? " · 推荐" : ""}
              </option>
            ))}
          </select>
        </label>
      </header>

      {sourceClarifyTitle && onViewSourceClarify ? (
        <button
          type="button"
          className="btn link chat-workorder-source-clarify"
          onClick={onViewSourceClarify}
        >
          来自澄清「{sourceClarifyTitle}」
        </button>
      ) : null}

      {recommendedId && recommendedId !== executorId && recommendReason ? (
        <p className="chat-workorder-hint">
          建议派给 {executorDisplayLabel(recommendedId)}：{recommendReason}
        </p>
      ) : null}

      <div className="chat-workorder-field">
        <span className="chat-workorder-field-label">标题</span>
        <input
          className="chat-workorder-input"
          value={refined.title}
          onChange={(e) => patch({ title: e.target.value })}
        />
      </div>

      <div className="chat-workorder-field">
        <span className="chat-workorder-field-label">验收</span>
        <textarea
          className="chat-workorder-textarea"
          value={refined.acceptance}
          rows={2}
          onChange={(e) => patch({ acceptance: e.target.value })}
        />
      </div>

      <div className="chat-workorder-field">
        <span className="chat-workorder-field-label">约束</span>
        <textarea
          className="chat-workorder-textarea"
          value={constraintsText}
          rows={2}
          placeholder="每行一条"
          onChange={(e) => setConstraintsFromText(e.target.value)}
        />
      </div>

      {!hasSubGoals ? (
        <div className="chat-workorder-field">
          <span className="chat-workorder-field-label">执行说明</span>
          <textarea
            className="chat-workorder-textarea"
            value={refined.executionPrompt}
            rows={4}
            onChange={(e) => patch({ executionPrompt: e.target.value })}
          />
        </div>
      ) : (
        <div className="chat-workorder-field">
          <span className="chat-workorder-field-label">子任务 · {subCount}</span>
          <div className="chat-workorder-subgoals">
            {refined.subGoals!.map((sub, i) => (
              <SubGoalRow key={`${sub.title}-${i}`} sub={sub} index={i} />
            ))}
          </div>
        </div>
      )}
    </article>
  );
}
