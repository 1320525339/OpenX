import type { Goal } from "@openx/shared";
import { goalDisplayOutcome } from "@openx/shared";

export type KanbanColumn = {
  key: string;
  title: string;
  hint: string;
  goals: Goal[];
};

export function buildKanbanColumns(goals: Goal[]): KanbanColumn[] {
  const incomplete: Goal[] = [];
  const review: Goal[] = [];
  const done: Goal[] = [];
  const failed: Goal[] = [];

  for (const g of goals) {
    const outcome = goalDisplayOutcome(g);
    if (outcome === "done") done.push(g);
    else if (outcome === "failed" || g.status === "cancelled") failed.push(g);
    else if (g.status === "awaiting_review") review.push(g);
    else incomplete.push(g);
  }

  const sortFn = (a: Goal, b: Goal) => {
    if (a.orderNo !== b.orderNo) return a.orderNo - b.orderNo;
    return a.createdAt.localeCompare(b.createdAt);
  };

  return [
    {
      key: "incomplete",
      title: "进行中",
      hint: "未开始 / 执行中",
      goals: incomplete.sort(sortFn),
    },
    {
      key: "review",
      title: "待验收",
      hint: "等你确认",
      goals: review.sort(sortFn),
    },
    { key: "done", title: "已完成", hint: "已通过", goals: done.sort(sortFn) },
    {
      key: "failed",
      title: "异常",
      hint: "失败 / 取消",
      goals: failed.sort(sortFn),
    },
  ];
}
