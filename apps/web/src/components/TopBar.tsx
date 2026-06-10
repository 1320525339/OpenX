import type { ExecutorInfo, ModelRuntime } from "../api";

export type ExecutorScope = "all" | string;

type Props = {
  executorScope: ExecutorScope;
  onExecutorScopeChange: (scope: ExecutorScope) => void;
  executors: ExecutorInfo[];
  sseStatus: "connected" | "reconnecting" | "disconnected";
  coachRuntime?: ModelRuntime | null;
};

export function TopBar({
  executorScope,
  onExecutorScopeChange,
  executors,
  sseStatus,
  coachRuntime,
}: Props) {
  const standbyLabel =
    sseStatus === "connected"
      ? "待命"
      : sseStatus === "reconnecting"
        ? "连接中"
        : "已断开";

  const coachMode = coachRuntime?.ready ? "智能" : "基础";
  const modelLabel = coachRuntime?.ready
    ? `${coachRuntime.slug ?? "模型"} · ${coachRuntime.model ?? ""}`
    : "规则模板";

  return (
    <header className="app-topbar" aria-label="运行台顶栏">
      <div className="topbar-group">
        <label className="topbar-label" htmlFor="executor-scope">
          执行范围
        </label>
        <select
          id="executor-scope"
          className="topbar-select"
          value={executorScope}
          onChange={(e) => onExecutorScopeChange(e.target.value)}
        >
          <option value="all">全部</option>
          {executors.map((ex) => (
            <option key={ex.id} value={ex.id}>
              {ex.displayName}
              {!ex.available ? "（离线）" : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="topbar-status">
        <span className={`topbar-led ${sseStatus}`} aria-hidden />
        <span>{standbyLabel}</span>
        <span className={`coach-status-badge${coachRuntime?.ready ? " llm" : ""}`}>
          {coachMode}模式
        </span>
        {coachRuntime?.ready && (
          <span className="topbar-model" title={coachRuntime.baseUrl}>
            {modelLabel}
          </span>
        )}
      </div>
    </header>
  );
}
