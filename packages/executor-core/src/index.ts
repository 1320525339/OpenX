import type { Goal, LogLevel, ModelSettingsSlice, PiExecutorSettings, RunDeltaEvent, ExecutionSkillHint } from "@openx/shared";



export interface ExecutorCallbacks {

  onProgress: (progress: number, message?: string) => Promise<void>;

  onLog: (level: LogLevel, message: string) => Promise<void>;

  onRunEvent?: (event: RunDeltaEvent) => Promise<void>;

  onComplete: (resultSummary: string) => Promise<void>;

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

  isRework?: boolean;

  /** 当前 executor 启用的 Skills（由 orchestrator 解析） */
  enabledSkills?: ExecutionSkillHint[];

}



export { buildExecutionPrompt } from "./prompt.js";
export { RunEventEmitter, createRunEmitter } from "./run-events.js";



export interface ExecutorAdapter {

  id: string;

  displayName: string;

  detect(settings: {

    pi?: PiExecutorSettings;

    model?: ModelSettingsSlice["model"];

    providers?: ModelSettingsSlice["providers"];

  }): Promise<{ available: boolean; hint?: string }>;

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



/** 按 Goal.executorId 解析到已注册的 ExecutorAdapter（pi / acp / connect） */
export function resolveExecutor(goalExecutorId: string): ExecutorAdapter | undefined {
  if (goalExecutorId === "auto") return undefined;
  if (goalExecutorId === "pi") return registry.get("pi");
  if (goalExecutorId.startsWith("acp:")) return registry.get("acp");
  return registry.get("connect");
}



export function listExecutors(): ExecutorAdapter[] {

  return [...registry.values()];

}



/** 测试用：清空执行器注册表 */
export function resetExecutorRegistry(): void {
  registry.clear();
}


