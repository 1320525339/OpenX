import type { CliProfile, Goal } from "@openx/shared";
import type { ExecutorInfo } from "../../api";
import {
  buildConsoleAgentRows,
  consoleAgentKindBadge,
  consoleAgentSummary,
  type ConsoleConnection,
} from "../../lib/console-agents";

type Props = {
  executors: ExecutorInfo[];
  cliProfiles: CliProfile[];
  connections: ConsoleConnection[];
  crossProjectReviewGoals: Goal[];
  crossProjectAwaitingReview: number;
  onNavigateToGoal: (goalId: string) => void;
};

export function ConsoleFleetPanel({
  executors,
  cliProfiles,
  connections,
  crossProjectReviewGoals,
  crossProjectAwaitingReview,
  onNavigateToGoal,
}: Props) {
  const agentRows = buildConsoleAgentRows(executors, cliProfiles, connections);
  const connectLinkedCount = connections.length;

  return (
    <div className="smart-card fleet-panel panel-scroll">
      <section className="console-section console-section-executors">
        <div className="console-section-head">
          <h3 className="console-section-title">在线执行器</h3>
          <span className="console-section-meta">
            {consoleAgentSummary(agentRows, connectLinkedCount)}
          </span>
        </div>
        {agentRows.length === 0 ? (
          <p className="console-muted">
            尚未配置 CLI。请在设置 → 工具与 CLI 中添加或同步 Skills。
          </p>
        ) : (
          <ul className="console-cli-list">
            {agentRows.map((row) => (
              <li key={row.id} className="console-cli-card" title={row.statusLabel}>
                <span
                  className="console-cli-status-dot"
                  data-tone={row.statusTone}
                  aria-label={row.statusLabel}
                />
                <span className="console-cli-name">{row.label}</span>
                <span className={`console-cli-kind ${row.kind}`}>
                  {consoleAgentKindBadge(row.kind)}
                </span>
                <span className="console-cli-id">{row.id}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {crossProjectReviewGoals.length > 0 ? (
        <section className="console-section console-section-review">
          <div className="console-section-head">
            <h3 className="console-section-title">跨项目待确认</h3>
            <span className="console-section-meta">{crossProjectAwaitingReview} 项</span>
          </div>
          <ul className="console-review-list">
            {crossProjectReviewGoals.map((goal) => (
              <li key={goal.id}>
                <button
                  type="button"
                  className="console-review-item"
                  onClick={() => onNavigateToGoal(goal.id)}
                >
                  <span className="console-review-title">{goal.title}</span>
                  <span className="console-review-meta">等你确认 →</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
