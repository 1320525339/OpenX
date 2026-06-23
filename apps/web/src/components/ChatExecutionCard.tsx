import type { Goal, GoalRunState } from "@openx/shared";
import { RunConsole } from "./RunConsole";
import { CrewDialogueSummary } from "./CrewDialogueSummary";
import {
  ChatTaskOrderDispatch,
  ChatTaskOrderFooter,
  ChatTaskOrderHeader,
} from "./ChatTaskOrderSections";
import { executorAgentShortName } from "../lib/chat-task-order";

type Props = {
  goal: Goal;
  run: GoalRunState;
  onOpenDetail?: () => void;
};

export function ChatExecutionCard({ goal, run, onOpenDetail }: Props) {
  const agentShort = executorAgentShortName(goal.executorId);

  return (
    <div className="chat-turn chat-turn-execution">
      <article className={`chat-task-card chat-task-order chat-execution-order status-${goal.status}`}>
        <ChatTaskOrderHeader
          goal={goal}
          title={goal.title}
          expanded={false}
          run={run}
          showLiveMeta
        />
        {onOpenDetail ? (
          <div className="chat-execution-order-actions">
            <button
              type="button"
              className="btn compact linkish chat-execution-link"
              onClick={onOpenDetail}
            >
              查看详情
            </button>
          </div>
        ) : null}
        <ChatTaskOrderDispatch goal={goal} />
        <div className="chat-task-order-feed">
          <CrewDialogueSummary goalId={goal.id} crewStatus={goal.crewStatus} embedded />
          <RunConsole run={run} compact taskOrder agentShortName={agentShort} />
        </div>
        <ChatTaskOrderFooter goal={goal} run={run} />
      </article>
    </div>
  );
}
