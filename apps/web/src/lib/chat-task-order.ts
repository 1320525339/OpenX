import type { Goal } from "@openx/shared";
import { executorDisplayLabel } from "./executors";

/** 活动流展示用短名：Pi / codex / claude */
export function executorAgentShortName(executorId: string): string {
  if (executorId === "pi") return "Pi";
  if (executorId.startsWith("acp:")) return executorId.slice(4);
  const label = executorDisplayLabel(executorId);
  const crew = label.match(/^(.+?)\s*施工队/);
  if (crew?.[1]) return crew[1].trim();
  return label.slice(0, 12);
}

export function formatGoalRecentTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

export function goalHasDispatchBrief(goal: Goal): boolean {
  return Boolean(goal.executionPrompt?.trim() || goal.constraints?.length);
}
