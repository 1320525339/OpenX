import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import {
  areDependenciesMet,
  insertGoal,
  listRunnableDraftGoals,
  resetDb,
  appendSseEvent,
  listSseEventsAfter,
  countSseEventsAfter,
  getGoalById,
  updateGoal,
} from "./db.js";
import type { Goal } from "@openx/shared";

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  const now = new Date().toISOString();
  return {
    id: nanoid(),
    title: "测试目标",
    acceptance: "完成",
    executionPrompt: "执行",
    constraints: [],
    executorId: "pi",
    status: "draft",
    progress: 0,
    dependsOn: [],
    priority: "medium",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("goal chain", () => {
  beforeEach(() => {
    process.env.OPENX_DB_PATH = ":memory:";
    resetDb();
  });

  afterEach(() => {
    resetDb();
    delete process.env.OPENX_DB_PATH;
  });

  it("blocks until dependencies are done", () => {
    const parent = makeGoal({ status: "running" });
    const child = makeGoal({ dependsOn: [parent.id], parentGoalId: parent.id });
    insertGoal(parent);
    insertGoal(child);

    expect(areDependenciesMet(child)).toBe(false);

    parent.status = "done";
    updateGoal(parent);
    const updatedChild = getGoalById(child.id)!;
    expect(areDependenciesMet(updatedChild)).toBe(true);
  });

  it("lists runnable drafts by priority", () => {
    const dep = makeGoal({ status: "done", priority: "low" });
    const high = makeGoal({ dependsOn: [dep.id], priority: "high" });
    const low = makeGoal({ dependsOn: [dep.id], priority: "low" });
    insertGoal(dep);
    insertGoal(low);
    insertGoal(high);

    const runnable = listRunnableDraftGoals();
    expect(runnable.map((g) => g.id)).toEqual([high.id, low.id]);
  });
});

describe("sse event store", () => {
  beforeEach(() => {
    process.env.OPENX_DB_PATH = ":memory:";
    resetDb();
  });

  afterEach(() => {
    resetDb();
    delete process.env.OPENX_DB_PATH;
  });

  it("replays events after id", () => {
    const a = appendSseEvent({
      type: "narration.append",
      message: "a",
      timestamp: new Date().toISOString(),
    });
    appendSseEvent({
      type: "narration.append",
      message: "b",
      timestamp: new Date().toISOString(),
    });

    const replay = listSseEventsAfter(a.id);
    expect(replay).toHaveLength(1);
    expect(replay[0]?.payload.type).toBe("narration.append");
    expect(countSseEventsAfter(a.id)).toBe(1);
  });
});
