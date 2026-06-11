import type { Goal, GoalRunState } from "@openx/shared";
import { goalStatusText } from "../lib/goal-detail";
import { RunConsole } from "./RunConsole";

type Props = {
  goal: Goal;
  run: GoalRunState;
  onOpenDetail?: () => void;
};

export function ChatExecutionCard({ goal, run, onOpenDetail }: Props) {
  return (
    <div className="chat-turn chat-turn-execution">
      <div className="chat-execution-card">
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
        <RunConsole run={run} compact />
      </div>
    </div>
  );
}
