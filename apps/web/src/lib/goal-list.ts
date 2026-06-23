import type { Goal } from "@openx/shared";

export { goalNeedsUserAttention } from "./goal-attention";

export type GoalTreeEntry = {
  goal: Goal;
  depth: number;
};

export type BuildGoalTreeListOptions = {
  /** 用于解析父链（分页时父任务可能不在当前页） */
  contextGoals?: Goal[];
  /** 保持 goals 原有顺序（分页列表），仅计算缩进深度 */
  preserveOrder?: boolean;
};

function sortGoalsByTree(a: Goal, b: Goal): number {
  return a.createdAt.localeCompare(b.createdAt);
}

function ancestorDepth(goal: Goal, byId: Map<string, Goal>): number {
  let depth = 0;
  let parentId = goal.parentGoalId;
  const seen = new Set<string>();
  while (parentId && byId.has(parentId) && !seen.has(parentId)) {
    seen.add(parentId);
    depth += 1;
    parentId = byId.get(parentId)!.parentGoalId;
  }
  return depth;
}

function buildGoalTreeListWalk(goals: Goal[], contextIds: Set<string>): GoalTreeEntry[] {
  const visibleIds = new Set(goals.map((g) => g.id));
  const byParent = new Map<string | null, Goal[]>();

  for (const g of goals) {
    const parentKey =
      g.parentGoalId && contextIds.has(g.parentGoalId) && visibleIds.has(g.parentGoalId)
        ? g.parentGoalId
        : null;
    const list = byParent.get(parentKey) ?? [];
    list.push(g);
    byParent.set(parentKey, list);
  }

  for (const list of byParent.values()) {
    list.sort(sortGoalsByTree);
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
      result.push({
        goal: g,
        depth: g.parentGoalId && contextIds.has(g.parentGoalId) ? 1 : 0,
      });
    }
  }

  return result;
}

/** 将扁平 goals 排成树形列表（根在前，子任务缩进） */
export function buildGoalTreeList(
  goals: Goal[],
  options: BuildGoalTreeListOptions = {},
): GoalTreeEntry[] {
  const contextGoals = options.contextGoals ?? goals;
  const byId = new Map(contextGoals.map((g) => [g.id, g]));
  const contextIds = new Set(contextGoals.map((g) => g.id));

  if (options.preserveOrder) {
    return goals.map((goal) => ({
      goal,
      depth: ancestorDepth(goal, byId),
    }));
  }

  return buildGoalTreeListWalk(goals, contextIds);
}

export function sortGoalsPageOrder(a: Goal, b: Goal): number {
  if (a.orderNo !== b.orderNo) return a.orderNo - b.orderNo;
  return a.createdAt.localeCompare(b.createdAt);
}
