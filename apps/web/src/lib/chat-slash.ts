import type { Goal } from "@openx/shared";
import {
  formatWorkOrderId,
  goalDisplayHint,
  goalDisplayLabel,
  isPausedGoal,
  parseWorkOrderId,
} from "@openx/shared";

export type ChatSlashCommand =
  | { type: "help" }
  | { type: "status" }
  | { type: "tasks" }
  | { type: "locate"; query: string }
  | { type: "approve" }
  | { type: "rework"; reason?: string }
  | { type: "start" }
  | { type: "resume"; query?: string; message?: string }
  | { type: "refine"; message: string };

const HELP_TEXT = `OpenX 斜杠命令：
/status — 本对话任务概况
/tasks — 列出任务单号与状态
/locate WO-000001 — 定位任务（支持 WO 编号或标题关键词）
/approve — 确认完成当前选中任务（待验收时）
/rework [原因] — 返工当前选中任务
/start — 开始推进当前选中任务
/resume [WO-xxx] [决策] — 显式续跑暂停任务（须指定任务或当前仅有一个暂停）
/refine [描述] — 整理成任务单
/help — 显示此帮助`;

export function chatSlashHelpText(): string {
  return HELP_TEXT;
}

/** 解析以 / 开头的输入；非斜杠命令返回 null */
export function parseChatSlash(input: string): ChatSlashCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;

  const body = trimmed.slice(1).trim();
  if (!body || body === "help" || body === "帮助") return { type: "help" };

  const [cmd, ...rest] = body.split(/\s+/);
  const arg = rest.join(" ").trim();
  const key = cmd.toLowerCase();

  switch (key) {
    case "status":
    case "状态":
      return { type: "status" };
    case "tasks":
    case "任务":
    case "list":
      return { type: "tasks" };
    case "locate":
    case "jump":
    case "跳":
    case "wo":
      if (!arg) return null;
      return { type: "locate", query: arg };
    case "approve":
    case "验收":
    case "确认":
      return { type: "approve" };
    case "rework":
    case "返工":
      return { type: "rework", reason: arg || undefined };
    case "start":
    case "推进":
    case "开始":
      return { type: "start" };
    case "resume":
    case "续跑":
    case "继续": {
      if (!arg) return { type: "resume" };
      const parts = arg.split(/\s+/);
      const first = parts[0] ?? "";
      const wo = parseWorkOrderId(first) ?? (/^\d+$/.test(first) ? Number(first) : null);
      if (wo != null || /^WO-/i.test(first) || first.length >= 6) {
        return {
          type: "resume",
          query: first,
          message: parts.slice(1).join(" ").trim() || undefined,
        };
      }
      return { type: "resume", message: arg };
    }
    case "refine":
    case "派单":
    case "整理":
      if (!arg) return null;
      return { type: "refine", message: arg };
    default:
      return null;
  }
}

export function formatConversationStatusSummary(goals: Goal[]): string {
  if (goals.length === 0) return "本对话还没有任务单。";
  const running = goals.filter((g) => g.status === "running").length;
  const paused = goals.filter((g) => isPausedGoal(g)).length;
  const review = goals.filter((g) => g.status === "awaiting_review").length;
  const done = goals.filter((g) => g.status === "done").length;
  const failed = goals.filter(
    (g) => g.status === "failed" || g.status === "cancelled",
  ).length;
  const draft = goals.length - running - paused - review - done - failed;
  return [
    `本对话共 ${goals.length} 个任务单。`,
    draft > 0 ? `${draft} 未开始` : null,
    running > 0 ? `${running} 进行中` : null,
    paused > 0 ? `${paused} 等待决策` : null,
    review > 0 ? `${review} 待验收` : null,
    done > 0 ? `${done} 已完成` : null,
    failed > 0 ? `${failed} 失败/取消` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function formatConversationTasksList(goals: Goal[]): string {
  if (goals.length === 0) return "暂无任务单。";
  const sorted = [...goals].sort((a, b) => {
    if (a.orderNo !== b.orderNo) return a.orderNo - b.orderNo;
    return a.createdAt.localeCompare(b.createdAt);
  });
  return sorted
    .map((g) => {
      const wo = g.orderNo > 0 ? formatWorkOrderId(g.orderNo) : g.id.slice(0, 8);
      const hint = goalDisplayHint(g);
      return `· ${wo} ${g.title} — ${goalDisplayLabel(g)}${hint ? `（${hint}）` : ""}`;
    })
    .join("\n");
}

export function findGoalByLocateQuery(goals: Goal[], query: string): Goal | undefined {
  const q = query.trim();
  if (!q) return undefined;

  const orderNo = parseWorkOrderId(q) ?? (/^\d+$/.test(q) ? Number(q) : null);
  if (orderNo != null && Number.isFinite(orderNo)) {
    const byOrder = goals.find((g) => g.orderNo === orderNo);
    if (byOrder) return byOrder;
  }

  const lower = q.toLowerCase();
  return (
    goals.find((g) => g.id === q || g.id.startsWith(q)) ??
    goals.find((g) => g.title.toLowerCase().includes(lower))
  );
}

export function resolveResumeTarget(
  goals: Goal[],
  selectedGoal: Goal | null | undefined,
  query?: string,
): { goal: Goal } | { error: string } {
  if (query?.trim()) {
    const found = findGoalByLocateQuery(goals, query.trim());
    if (!found) return { error: `未找到「${query}」对应的任务单。` };
    if (!isPausedGoal(found) && !(found.status === "running" && found.crewStatus === "awaiting_user")) {
      return { error: `「${found.title}」未处于暂停等待决策。` };
    }
    return { goal: found };
  }
  if (
    selectedGoal &&
    (isPausedGoal(selectedGoal) ||
      (selectedGoal.status === "running" && selectedGoal.crewStatus === "awaiting_user"))
  ) {
    return { goal: selectedGoal };
  }
  const paused = goals.filter(
    (g) =>
      isPausedGoal(g) || (g.status === "running" && g.crewStatus === "awaiting_user"),
  );
  if (paused.length === 1) return { goal: paused[0]! };
  if (paused.length === 0) return { error: "当前没有暂停等待决策的任务。" };
  return {
    error: `有 ${paused.length} 个暂停任务，请指定：/resume WO-编号 [决策]`,
  };
}
