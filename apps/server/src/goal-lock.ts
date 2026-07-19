/**
 * 目标级串行锁：派发 / steer / watchdog cancel 共用，避免竞态。
 */
const locks = new Map<string, Promise<void>>();

export async function withGoalLock<T>(
  goalId: string,
  fn: () => Promise<T> | T,
): Promise<T> {
  const prev = locks.get(goalId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chain = prev.then(() => gate);
  locks.set(goalId, chain);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(goalId) === chain) {
      locks.delete(goalId);
    }
  }
}

/** 非阻塞尝试：若目标正被锁定则返回 null */
export async function tryWithGoalLock<T>(
  goalId: string,
  fn: () => Promise<T> | T,
): Promise<T | null> {
  if (locks.has(goalId)) return null;
  return withGoalLock(goalId, fn);
}

export function isGoalLocked(goalId: string): boolean {
  return locks.has(goalId);
}

/** 测试用 */
export function clearGoalLocks(): void {
  locks.clear();
}
