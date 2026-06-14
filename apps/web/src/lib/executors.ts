import type { ExecutorInfo } from "../api";
import { CONNECT_ANY_EXECUTOR_ID, EXECUTOR_AUTO } from "@openx/shared";

export function executorDisplayLabel(id: string): string {
  if (id === EXECUTOR_AUTO) return "自动（工头推荐）";
  if (id === CONNECT_ANY_EXECUTOR_ID) return "远程施工队（任意在线）";
  if (id === "pi") return "Pi 施工队（工头班底）";
  if (id === "acp:codex") return "Codex 施工队";
  if (id === "acp:claude") return "Claude 施工队";
  if (id === "acp:gemini") return "Gemini 施工队";
  if (id.startsWith("acp:")) return `${id.slice(4)} 施工队`;
  if (id.startsWith("Connect:")) return id.replace(/^Connect:\s*/, "");
  return id;
}

export type ExecutorOption = {
  id: string;
  label: string;
  available: boolean;
  /** 可选择：在线，或未在线但派单时可自动自举 */
  selectable: boolean;
  bootstrappable?: boolean;
  hint?: string;
};

export function buildExecutorOptions(
  executors: ExecutorInfo[],
  includeAuto = true,
): ExecutorOption[] {
  const options: ExecutorOption[] = [];

  if (includeAuto) {
    const piAvailable = executors.some((e) => e.id === "pi" && e.available);
    options.push({
      id: EXECUTOR_AUTO,
      label: "自动（工头推荐）",
      available: piAvailable,
      selectable: piAvailable,
      hint: "由工头根据任务自动选择施工队",
    });
  }

  for (const e of executors) {
    if (e.id === EXECUTOR_AUTO) continue;
    options.push({
      id: e.id,
      label: e.displayName,
      available: e.available,
      selectable: e.available || e.bootstrappable === true,
      bootstrappable: e.bootstrappable,
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

/** 调度台：仅 Connect 类执行器（含 connect:any） */
export function filterConnectExecutors(executors: ExecutorInfo[]): ExecutorInfo[] {
  return executors.filter(
    (e) =>
      e.id === CONNECT_ANY_EXECUTOR_ID ||
      (e.id !== "pi" && e.id !== EXECUTOR_AUTO && !e.id.startsWith("acp:")),
  );
}

export function defaultConnectExecutorChoice(executors: ExecutorInfo[]): string {
  const connectOnly = filterConnectExecutors(executors);
  const anyPool = connectOnly.find((e) => e.id === CONNECT_ANY_EXECUTOR_ID);
  if (anyPool?.available || anyPool?.bootstrappable) return CONNECT_ANY_EXECUTOR_ID;
  const online = connectOnly.find((e) => e.available && e.id !== CONNECT_ANY_EXECUTOR_ID);
  if (online) return online.id;
  const bootstrap = connectOnly.find((e) => e.bootstrappable);
  return bootstrap?.id ?? CONNECT_ANY_EXECUTOR_ID;
}

export function connectClaimStatus(goal: { executorId: string; status: string }): string | null {
  if (goal.executorId === CONNECT_ANY_EXECUTOR_ID) {
    return goal.status === "running" ? "待认领" : null;
  }
  if (
    goal.status === "running" ||
    goal.status === "awaiting_review" ||
    goal.status === "draft"
  ) {
    return `已认领 · ${executorDisplayLabel(goal.executorId)}`;
  }
  return null;
}
