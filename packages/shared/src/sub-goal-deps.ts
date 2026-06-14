export type SubGoalDepInput = {
  dependsOn?: string[];
  /** 同批子任务索引依赖；显式 [] 表示并行无依赖 */
  dependsOnIndex?: number[];
};

/**
 * 解析同批子目标的 dependsOn：
 * - 显式 dependsOn 优先
 * - dependsOnIndex: [] → 并行无依赖
 * - dependsOnIndex: [0,1] → 依赖同批已创建 id
 * - 默认：首项无依赖，其余链式依赖 chainPrevId
 */
export function resolveSubGoalDependsOn(
  index: number,
  batch: SubGoalDepInput[],
  createdIds: string[],
  chainPrevId: string,
): string[] {
  const sub = batch[index];
  if (sub?.dependsOn !== undefined) return sub.dependsOn;
  if (sub?.dependsOnIndex !== undefined) {
    if (sub.dependsOnIndex.length === 0) return [];
    return sub.dependsOnIndex
      .map((idx) => createdIds[idx])
      .filter((id): id is string => Boolean(id));
  }
  if (index === 0) return [];
  const previousInBatch = createdIds[index - 1];
  return [previousInBatch ?? chainPrevId];
}

/** 同批子目标中可立即并行启动的数量上限 */
export const MAX_PARALLEL_SUB_GOAL_STARTS = 6;
