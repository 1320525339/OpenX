import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({
  api: {
    approveGoal: vi.fn(),
    reworkGoal: vi.fn(),
    startGoal: vi.fn(),
    retryGoal: vi.fn(),
    cancelGoal: vi.fn(),
  },
}));

import { api } from "../api";
import { runTaskAction } from "./task-action";

beforeEach(() => {
  vi.mocked(api.approveGoal).mockReset();
  vi.mocked(api.reworkGoal).mockReset();
  vi.mocked(api.startGoal).mockReset();
  vi.mocked(api.retryGoal).mockReset();
  vi.mocked(api.cancelGoal).mockReset();
});

describe("runTaskAction", () => {
  it("returns ok on approve success", async () => {
    vi.mocked(api.approveGoal).mockResolvedValueOnce({ goal: {} as never });
    const result = await runTaskAction({ type: "approve", goalId: "g1" });
    expect(result).toEqual({ ok: true });
    expect(api.approveGoal).toHaveBeenCalledWith("g1");
  });

  it("returns ok:false when approve fails (does not throw)", async () => {
    vi.mocked(api.approveGoal).mockRejectedValueOnce(new Error("冲突"));
    const result = await runTaskAction({ type: "approve", goalId: "g1" });
    expect(result).toEqual({ ok: false, error: "冲突" });
  });

  it("uses retryGoal when start on failed goal", async () => {
    vi.mocked(api.retryGoal).mockResolvedValueOnce({ goal: {} as never });
    const result = await runTaskAction({
      type: "start",
      goalId: "g1",
      goalStatus: "failed",
    });
    expect(result).toEqual({ ok: true });
    expect(api.retryGoal).toHaveBeenCalledWith("g1");
    expect(api.startGoal).not.toHaveBeenCalled();
  });

  it("returns ok:false when rework fails", async () => {
    vi.mocked(api.reworkGoal).mockRejectedValueOnce(new Error("返工拒绝"));
    const result = await runTaskAction({
      type: "rework",
      goalId: "g1",
      reason: "缺测试",
    });
    expect(result).toEqual({ ok: false, error: "返工拒绝" });
    expect(api.reworkGoal).toHaveBeenCalledWith("g1", "缺测试");
  });
});
