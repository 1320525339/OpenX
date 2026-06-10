import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listCoachMessages, resetDb, saveCoachMessage } from "./db.js";

describe("coach messages scope", () => {
  beforeEach(() => {
    process.env.OPENX_DB_PATH = ":memory:";
    resetDb();
  });

  afterEach(() => {
    resetDb();
    delete process.env.OPENX_DB_PATH;
  });

  it("global thread only includes goal_id IS NULL", () => {
    saveCoachMessage(null, "user", "全局你好");
    saveCoachMessage("goal-a", "user", "目标A专用");
    saveCoachMessage(null, "coach", "全局回复");

    const globalMsgs = listCoachMessages(null);
    expect(globalMsgs.map((m) => m.text)).toEqual(["全局你好", "全局回复"]);
  });

  it("goal thread includes goal messages and global messages", () => {
    saveCoachMessage(null, "user", "全局上下文");
    saveCoachMessage("goal-a", "user", "关于A的问题");
    saveCoachMessage("goal-a", "coach", "A的回复");
    saveCoachMessage("goal-b", "user", "B不应出现");

    const scoped = listCoachMessages("goal-a");
    expect(scoped.map((m) => m.text)).toEqual([
      "全局上下文",
      "关于A的问题",
      "A的回复",
    ]);
  });
});
