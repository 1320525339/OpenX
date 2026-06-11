import type { Goal, GoalDeliverable, LogLevel, ModelSettingsSlice, PiExecutorSettings, RunDeltaEvent, ExecutionSkillHint } from "@openx/shared";



export interface ExecutorCallbacks {

  onProgress: (progress: number, message?: string) => Promise<void>;

  onLog: (level: LogLevel, message: string) => Promise<void>;

  onRunEvent?: (event: RunDeltaEvent) => Promise<void>;

  onComplete: (resultSummary: string, deliverables?: GoalDeliverable[]) => Promise<void>;

  onFail: (errorMessage: string) => Promise<void>;

}


export interface ExecutorContext {

  goal: Goal;

  workspaceRoot: string;

  callbacks: ExecutorCallbacks;

  settings: {

    pi?: PiExecutorSettings;

    model?: ModelSettingsSlice["model"];

    providers?: ModelSettingsSlice["providers"];

  };

  /** 本轮执行前的近期日志，用于返工续跑 */

  priorLogs?: { level: string; message: string }[];

  /** 历史执行摘要（execution_summaries），供返工优化 */

  priorSummaries?: string[];
  /** 历史审查员判定（返工时注入执行 prompt） */
  priorReviewRounds?: string[];

  isRework?: boolean;

  /** 当前 executor 启用的 Skills（由 orchestrator 解析） */
  enabledSkills?: ExecutionSkillHint[];

  /** 派单时启用的 MCP servers（来自 settings + 对话选择；env 为 ACP 协议要求的 name/value 数组） */
  mcpServers?: Array<{
    name: string;
    command: string;
    args: string[];
    env?: Array<{ name: string; value: string }>;
  }>;

  /** Agent 角色设定（前置到执行 prompt） */
  agentRole?: string;

  /** ACP 子进程额外环境变量（来自 OpenX 渠道映射） */
  spawnEnv?: Record<string, string>;
}



export { buildExecutionPrompt } from "./prompt.js";
export { RunEventEmitter, createRunEmitter } from "./run-events.js";
export {
  extractDeliverableFromTool,
  extractPathFromToolArgs,
  inferFileAction,
  mergeDeliverable,
} from "./deliverables.js";
export {
  readWorkspaceFileBaseline,
  resolveWorkspaceFilePath,
} from "./workspace-file.js";



export interface ExecutorDetectEntry {
  id: string;
  displayName: string;
  available: boolean;
  hint?: string;
  bootstrappable?: boolean;
}

export interface ExecutorAdapter {

  id: string;

  displayName: string;

  /** push = 服务端驱动执行；pull = Agent 心跳拉取 */
  executionModel?: "push" | "pull";

  /** 判断 goal.executorId 是否由本 adapter 处理；未实现时仅精确匹配 id */
  matchExecutorId?(goalExecutorId: string): boolean;

  detect(settings: {

    pi?: PiExecutorSettings;

    model?: ModelSettingsSlice["model"];

    providers?: ModelSettingsSlice["providers"];

  }): Promise<{ available: boolean; hint?: string }>;

  /** 探测本 adapter 负责的全部 executor 条目；未实现时仅返回 adapter.id 一条 */
  detectEntries?(settings: {
    pi?: PiExecutorSettings;
    model?: ModelSettingsSlice["model"];
    providers?: ModelSettingsSlice["providers"];
  }): Promise<ExecutorDetectEntry[]>;

  run(ctx: ExecutorContext): Promise<void>;

  /** 返工时对已 park 的 session 注入 steer/followUp，成功则无需重启 */

  steerRework?(ctx: ExecutorContext): Promise<boolean>;

  cancel?(goalId: string): void;

}



const registry = new Map<string, ExecutorAdapter>();



export function registerExecutor(adapter: ExecutorAdapter): void {

  registry.set(adapter.id, adapter);

}



export function getExecutor(id: string): ExecutorAdapter | undefined {

  return registry.get(id);

}



/** 按 Goal.executorId 解析到已注册的 ExecutorAdapter */
export function resolveExecutor(goalExecutorId: string): ExecutorAdapter | undefined {
  if (goalExecutorId === "auto") return undefined;
  for (const adapter of registry.values()) {
    if (adapter.matchExecutorId) {
      if (adapter.matchExecutorId(goalExecutorId)) return adapter;
    } else if (adapter.id === goalExecutorId) {
      return adapter;
    }
  }
  return undefined;
}



export function listExecutors(): ExecutorAdapter[] {

  return [...registry.values()];

}



/** 测试用：清空执行器注册表 */
export function resetExecutorRegistry(): void {
  registry.clear();
}


