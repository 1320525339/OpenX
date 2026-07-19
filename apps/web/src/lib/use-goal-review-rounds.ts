import { useCallback, useEffect, useState } from "react";
import { api, type ReviewRoundEntry } from "../api";

const CACHE_TTL_MS = 8_000;

type CacheEntry = {
  rounds: ReviewRoundEntry[];
  fetchedAt: number;
};

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<ReviewRoundEntry[]>>();

async function fetchReviewRounds(goalId: string, force = false): Promise<ReviewRoundEntry[]> {
  const cached = cache.get(goalId);
  if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.rounds;
  }

  const existing = inflight.get(goalId);
  if (existing && !force) return existing;

  const promise = api
    .getGoalReviewRounds(goalId)
    .then(({ rounds }) => {
      cache.set(goalId, { rounds, fetchedAt: Date.now() });
      return rounds;
    })
    .finally(() => {
      inflight.delete(goalId);
    });

  inflight.set(goalId, promise);
  return promise;
}

export function invalidateGoalReviewRounds(goalId?: string) {
  if (goalId) {
    cache.delete(goalId);
    return;
  }
  cache.clear();
}

export function useGoalReviewRounds(goalId: string) {
  const [rounds, setRounds] = useState<ReviewRoundEntry[]>(() => cache.get(goalId)?.rounds ?? []);
  const [loading, setLoading] = useState(() => !cache.get(goalId));
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    async (force = false) => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchReviewRounds(goalId, force);
        setRounds(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "加载审查记录失败");
      } finally {
        setLoading(false);
      }
    },
    [goalId],
  );

  useEffect(() => {
    const hit = cache.get(goalId);
    if (hit) {
      setRounds(hit.rounds);
      setLoading(false);
      setError(null);
    }
    void refresh();
  }, [goalId, refresh]);

  return { rounds, loading, error, refresh };
}
