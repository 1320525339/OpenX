import type { Goal } from "@openx/shared";

export type GoalTreeEntry = {
  goal: Goal;
  depth: number;
};

/** 将扁平 goals 按 parentGoalId 排成树形列表（根在前，子任务缩进） */
export function buildGoalTreeList(goals: Goal[]): GoalTreeEntry[] {
  const ids = new Set(goals.map((g) => g.id));
  const byParent = new Map<string | null, Goal[]>();

  for (const g of goals) {
    const parentKey =
      g.parentGoalId && ids.has(g.parentGoalId) ? g.parentGoalId : null;
    const list = byParent.get(parentKey) ?? [];
    list.push(g);
    byParent.set(parentKey, list);
  }

  for (const list of byParent.values()) {
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  const result: GoalTreeEntry[] = [];
  const seen = new Set<string>();

  function walk(parentId: string | null, depth: number) {
    for (const g of byParent.get(parentId) ?? []) {
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      result.push({ goal: g, depth });
      walk(g.id, depth + 1);
    }
  }

  walk(null, 0);

  for (const g of goals) {
    if (!seen.has(g.id)) {
      result.push({ goal: g, depth: g.parentGoalId ? 1 : 0 });
    }
  }

  return result;
}
