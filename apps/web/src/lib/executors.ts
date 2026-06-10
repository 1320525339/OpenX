import type { ExecutorInfo } from "../api";
import { EXECUTOR_AUTO } from "@openx/shared";

export function executorDisplayLabel(id: string): string {
  if (id === EXECUTOR_AUTO) return "自动（Pi 选择）";
  if (id === "pi") return "Pi 内嵌";
  if (id.startsWith("acp:")) return id.slice(4);
  if (id.startsWith("Connect:")) return id.replace(/^Connect:\s*/, "");
  return id;
}

export function buildExecutorOptions(
  executors: ExecutorInfo[],
  includeAuto = true,
): Array<{ id: string; label: string; available: boolean; hint?: string }> {
  const options: Array<{ id: string; label: string; available: boolean; hint?: string }> = [];

  if (includeAuto) {
    options.push({
      id: EXECUTOR_AUTO,
      label: "自动（Pi 选择）",
      available: executors.some((e) => e.id === "pi" && e.available),
      hint: "启动时由 Pi 根据任务与在线执行器自动派单",
    });
  }

  for (const e of executors) {
    if (e.id === EXECUTOR_AUTO) continue;
    options.push({
      id: e.id,
      label: e.displayName,
      available: e.available,
      hint: e.hint,
    });
  }

  return options;
}

export function defaultExecutorChoice(
  executors: ExecutorInfo[],
  preferred?: string,
): string {
  if (preferred && preferred !== EXECUTOR_AUTO) {
    const match = executors.find((e) => e.id === preferred);
    if (match?.available) return preferred;
  }
  if (preferred === EXECUTOR_AUTO) {
    const pi = executors.find((e) => e.id === "pi");
    if (pi?.available) return EXECUTOR_AUTO;
  }
  const pi = executors.find((e) => e.id === "pi");
  if (pi?.available) return "pi";
  const first = executors.find((e) => e.available);
  return first?.id ?? EXECUTOR_AUTO;
}
