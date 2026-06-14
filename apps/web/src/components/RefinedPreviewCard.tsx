import type { RefinedGoal, RefinedSubGoal } from "@openx/shared";
import { COACH_AGENT_ROLES, DEFAULT_EXECUTION_AGENT_ID } from "@openx/shared";

type Props = {
  refined: RefinedGoal;
  selectedGoalTitle?: string;
  onChange?: (next: RefinedGoal) => void;
  contextSummary?: string;
  recommendLabel?: string;
  onApply?: () => void;
  onCreate?: () => void;
  onCreateSubGoals?: () => void;
  applying?: boolean;
  creating?: boolean;
  autoExecute?: boolean;
};

function SubGoalItem({ sub, index }: { sub: RefinedSubGoal; index: number }) {
  return (
    <div className="refined-subgoal">
      <div className="refined-subgoal-head">
        <span className="refined-subgoal-index">{index + 1}</span>
        <strong>{sub.title}</strong>
        {sub.executorId && (
          <span className="executor-tag" style={{ marginLeft: "0.35rem" }}>
            {sub.executorId}
          </span>
        )}
      </div>
      <p className="refined-subgoal-acceptance">{sub.acceptance}</p>
    </div>
  );
}

export function RefinedPreviewCard({
  refined,
  selectedGoalTitle,
  onChange,
  contextSummary,
  recommendLabel,
  onApply,
  onCreate,
  onCreateSubGoals,
  applying,
  creating,
  autoExecute,
}: Props) {
  const subCount = refined.subGoals?.length ?? 0;
  const hasSubGoals = subCount > 0;
  const editable = Boolean(onChange);

  const patch = (partial: Partial<RefinedGoal>) => {
    onChange?.({ ...refined, ...partial });
  };

  const constraintsText = refined.constraints.join("\n");
  const executionAgentId = refined.agentId ?? DEFAULT_EXECUTION_AGENT_ID;
  const agentLabel =
    COACH_AGENT_ROLES[executionAgentId]?.name ??
    executionAgentId;
  const mcpLabel = refined.mcpIds?.length ? refined.mcpIds.join(", ") : "（未指定）";
  const skillLabel = refined.skillIds?.length ? refined.skillIds.join(", ") : "（未指定）";
  const setConstraintsFromText = (text: string) => {
    patch({
      constraints: text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    });
  };

  return (
    <div className="refined-preview">
      <h4>{hasSubGoals ? "工单预览 · 多子任务" : "工单预览"}</h4>
      {recommendLabel && (
        <p className="refined-recommend-hint">{recommendLabel}</p>
      )}
      {contextSummary && (
        <p className="refined-context-hint">{contextSummary}</p>
      )}

      <div className="refined-field">
        <label>标题</label>
        {editable ? (
          <input
            className="field-input"
            value={refined.title}
            onChange={(e) => patch({ title: e.target.value })}
          />
        ) : (
          <p>{refined.title}</p>
        )}
      </div>

      <div className="refined-field">
        <label>验收标准</label>
        {editable ? (
          <textarea
            className="mech-textarea refined-edit-area"
            value={refined.acceptance}
            rows={2}
            onChange={(e) => patch({ acceptance: e.target.value })}
          />
        ) : (
          <p>{refined.acceptance}</p>
        )}
      </div>

      <div className="refined-field refined-dispatch-field">
        <label>派单上下文</label>
        <div className="refined-dispatch-grid">
          <span>
            <em>执行角色</em>{" "}
            {editable ? (
              <input
                className="field-input"
                value={refined.agentId ?? DEFAULT_EXECUTION_AGENT_ID}
                placeholder={DEFAULT_EXECUTION_AGENT_ID}
                onChange={(e) =>
                  patch({
                    agentId:
                      e.target.value.trim() === DEFAULT_EXECUTION_AGENT_ID
                        ? undefined
                        : e.target.value.trim() || undefined,
                  })
                }
              />
            ) : (
              agentLabel
            )}
          </span>
          <span>
            <em>MCP</em>{" "}
            {editable ? (
              <input
                className="field-input"
                value={refined.mcpIds?.join(", ") ?? ""}
                placeholder="browser, workspace"
                onChange={(e) =>
                  patch({
                    mcpIds: e.target.value
                      .split(/[,，\s]+/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            ) : (
              mcpLabel
            )}
          </span>
          <span>
            <em>Skills</em>{" "}
            {editable ? (
              <input
                className="field-input"
                value={refined.skillIds?.join(", ") ?? ""}
                placeholder="skill-id"
                onChange={(e) =>
                  patch({
                    skillIds: e.target.value
                      .split(/[,，\s]+/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            ) : (
              skillLabel
            )}
          </span>
        </div>
      </div>

      <div className="refined-field">
        <label>约束</label>
        {editable ? (
          <textarea
            className="mech-textarea refined-edit-area"
            value={constraintsText}
            rows={2}
            placeholder="每行一条约束"
            onChange={(e) => setConstraintsFromText(e.target.value)}
          />
        ) : (
          <ul className="refined-constraints">
            {refined.constraints.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        )}
      </div>

      {!hasSubGoals && (
        <div className="refined-field">
          <label>执行说明</label>
          {editable ? (
            <textarea
              className="mech-textarea refined-edit-area"
              value={refined.executionPrompt}
              rows={4}
              onChange={(e) => patch({ executionPrompt: e.target.value })}
            />
          ) : (
            <pre>{refined.executionPrompt}</pre>
          )}
        </div>
      )}

      {hasSubGoals && (
        <div className="refined-field">
          <label>子任务 ({subCount})</label>
          <div className="refined-subgoals">
            {refined.subGoals!.map((sub, i) => (
              <SubGoalItem key={`${sub.title}-${i}`} sub={sub} index={i} />
            ))}
          </div>
        </div>
      )}

      {onApply && !hasSubGoals && (
        <button
          type="button"
          className="btn primary"
          disabled={!selectedGoalTitle || applying}
          title={selectedGoalTitle ? undefined : "请先在任务区选择目标"}
          onClick={onApply}
        >
          {selectedGoalTitle
            ? `应用到「${selectedGoalTitle.slice(0, 16)}${selectedGoalTitle.length > 16 ? "…" : ""}」`
            : "请先在任务区选择目标"}
        </button>
      )}

      {onCreateSubGoals && (
        <button
          type="button"
          className="btn primary"
          disabled={creating}
          onClick={onCreateSubGoals}
        >
          {creating
            ? "创建中…"
            : autoExecute
              ? `创建 ${subCount} 个子任务并执行`
              : `创建 ${subCount} 个子任务`}
        </button>
      )}

      {onCreate && !hasSubGoals && (
        <button
          type="button"
          className="btn primary"
          disabled={creating}
          onClick={onCreate}
        >
          {creating ? "创建中…" : autoExecute ? "创建并执行" : "创建目标"}
        </button>
      )}

      {onCreate && hasSubGoals && (
        <button type="button" className="btn" disabled={creating} onClick={onCreate}>
          {creating
            ? "创建中…"
            : autoExecute
              ? "创建核心目标及子任务并执行"
              : "创建核心目标及子任务"}
        </button>
      )}
    </div>
  );
}
