import type { Goal } from "@openx/shared";
import { app } from "./routes.js";

export const REAL_ENV_TIMEOUT_MS = 180_000;
/** Mock Pi 执行器等待目标状态的超时 */
export const MOCK_PI_TIMEOUT_MS = 15_000;
/** 含 Coach refine 的集成测试整体超时 */
export const GOAL_API_TEST_TIMEOUT_MS = 60_000;

export async function waitForGoalStatus(
  goalId: string,
  statuses: Goal["status"][],
  opts?: { timeoutMs?: number; intervalMs?: number },
): Promise<Goal> {
  const timeoutMs = opts?.timeoutMs ?? REAL_ENV_TIMEOUT_MS;
  const intervalMs = opts?.intervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const res = await app.request(`/api/goals/${goalId}`);
    const { goal } = (await res.json()) as { goal: Goal };
    if (statuses.includes(goal.status)) {
      return goal;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  const final = await app.request(`/api/goals/${goalId}`);
  const { goal } = (await final.json()) as { goal: Goal };
  throw new Error(
    `Goal ${goalId} 未在 ${timeoutMs}ms 内进入 [${statuses.join(", ")}]，当前：${goal.status}`,
  );
}
