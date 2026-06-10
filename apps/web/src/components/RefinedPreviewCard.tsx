import type { RefinedGoal, RefinedSubGoal } from "@openx/shared";



type Props = {

  refined: RefinedGoal;

  selectedGoalTitle?: string;

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

  onApply,

  onCreate,

  onCreateSubGoals,

  applying,

  creating,

  autoExecute,

}: Props) {

  const subCount = refined.subGoals?.length ?? 0;

  const hasSubGoals = subCount > 0;



  return (

    <div className="refined-preview">

      <h4>{hasSubGoals ? "目标整理 · 多子任务" : "目标整理"}</h4>

      <div className="refined-field">

        <label>标题</label>

        <p>{refined.title}</p>

      </div>

      <div className="refined-field">

        <label>验收标准</label>

        <p>{refined.acceptance}</p>

      </div>

      {!hasSubGoals && (

        <div className="refined-field">

          <label>执行说明</label>

          <pre>{refined.executionPrompt}</pre>

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

          {creating

            ? "创建中…"

            : autoExecute

              ? "创建并执行"

              : "创建目标"}

        </button>

      )}

      {onCreate && hasSubGoals && (

        <button

          type="button"

          className="btn"

          disabled={creating}

          onClick={onCreate}

        >

          {creating

            ? "创建中…"

            : autoExecute

              ? "创建核心目标及子任务"

              : "创建核心目标及子任务"}

        </button>

      )}

    </div>

  );

}

