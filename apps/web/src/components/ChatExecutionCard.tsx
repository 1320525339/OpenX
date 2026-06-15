import type { Goal, GoalRunState } from "@openx/shared";
import { goalStatusText } from "../lib/goal-detail";
import { RunConsole } from "./RunConsole";
import { WorkOrderIdBadge } from "./WorkOrderIdBadge";
import { CrewDialogueSummary } from "./CrewDialogueSummary";

type Props = {
  goal: Goal;
  run: GoalRunState;
  onOpenDetail?: () => void;
};

export function ChatExecutionCard({ goal, run, onOpenDetail }: Props) {
  return (
    <div className="chat-turn chat-turn-execution">
      <div className="chat-execution-card">
        {goal.orderNo > 0 ? (
          <div className="chat-execution-order-banner">
            <WorkOrderIdBadge orderNo={goal.orderNo} />
          </div>
        ) : null}
        <div className="chat-execution-head">
          <span className="chat-execution-label">
            {run.active ? "任务执行中" : "最近执行"}
          </span>
          <strong className="chat-execution-title">{goal.title}</strong>
          <span className={`status-pill compact ${goal.status}`}>
            {goalStatusText(goal)}
          </span>
          {onOpenDetail && (
            <button type="button" className="btn compact linkish chat-execution-link" onClick={onOpenDetail}>
              查看详情
            </button>
          )}
        </div>
        <CrewDialogueSummary
          goalId={goal.id}
          crewStatus={goal.crewStatus}
          embedded
        />
        <RunConsole run={run} compact />
      </div>
    </div>
  );
}
