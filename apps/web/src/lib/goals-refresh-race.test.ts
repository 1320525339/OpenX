import { describe, expect, it } from "vitest";
import {
  nextGoalsRefreshGen,
  resolveGoalsAfterRefreshRace,
  shouldApplyGoalsRefresh,
} from "./goals-refresh-race";

describe("goals refresh race", () => {
  it("rejects stale gen responses", () => {
    expect(shouldApplyGoalsRefresh(1, 2)).toBe(false);
    expect(shouldApplyGoalsRefresh(3, 3)).toBe(true);
  });

  it("upsert increments gen so prior refresh is discarded", () => {
    let gen = 0;
    const staleGen = nextGoalsRefreshGen(gen);
    gen = staleGen;
    // create 成功后 upsert：作废飞行中的列表
    gen = nextGoalsRefreshGen(gen);
    expect(shouldApplyGoalsRefresh(staleGen, gen)).toBe(false);
  });

  it("keeps newly created goal when stale full list arrives late", () => {
    const previous = [{ id: "old" }];
    const created = { id: "new-from-chat" };
    const staleList = [{ id: "old" }]; // 创建前快照，缺新任务
    const result = resolveGoalsAfterRefreshRace({
      previous,
      upserted: [created],
      staleList,
      staleGen: 1,
      genAfterUpsert: 2,
    });
    expect(result.map((g) => g.id)).toEqual(["new-from-chat", "old"]);
  });

  it("applies refresh when gen still matches", () => {
    const result = resolveGoalsAfterRefreshRace({
      previous: [{ id: "a" }],
      upserted: [],
      staleList: [{ id: "a" }, { id: "b" }],
      staleGen: 5,
      genAfterUpsert: 5,
    });
    expect(result.map((g) => g.id)).toEqual(["a", "b"]);
  });
});
