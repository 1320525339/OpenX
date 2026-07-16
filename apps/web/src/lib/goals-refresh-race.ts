/**
 * 全量 goals 刷新的请求代次：upsert / 本地补丁后递增，使飞行中的旧 GET /api/goals 响应失效。
 */
export function nextGoalsRefreshGen(current: number): number {
  return current + 1;
}

export function shouldApplyGoalsRefresh(
  responseGen: number,
  currentGen: number,
): boolean {
  return responseGen === currentGen;
}

/**
 * 模拟「upsert 作废飞行中刷新」：本地写入后 gen 前进，旧响应不得覆盖。
 * 返回应保留的 goals（若旧响应被丢弃则保留 previous）。
 */
export function resolveGoalsAfterRefreshRace(input: {
  previous: { id: string }[];
  upserted: { id: string }[];
  staleList: { id: string }[];
  staleGen: number;
  genAfterUpsert: number;
}): { id: string }[] {
  const { previous, upserted, staleList, staleGen, genAfterUpsert } = input;
  const afterUpsert = [...previous];
  for (const g of upserted) {
    const idx = afterUpsert.findIndex((x) => x.id === g.id);
    if (idx >= 0) afterUpsert[idx] = g;
    else afterUpsert.unshift(g);
  }
  if (!shouldApplyGoalsRefresh(staleGen, genAfterUpsert)) {
    return afterUpsert;
  }
  return staleList;
}
