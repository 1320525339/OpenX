import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Goal } from "@openx/shared";
import { api } from "../api";
import { sortGoalsPageOrder } from "./goal-list";

type Scope = {
  conversationId?: string;
  projectId?: string;
};

const PAGE_SIZE = 80;

const EMPTY_COUNTS = {
  all: 0,
  incomplete: 0,
  failed: 0,
  done: 0,
  rework: 0,
};

function goalsEqual(a: Goal, b: Goal): boolean {
  return (
    a.updatedAt === b.updatedAt &&
    a.status === b.status &&
    a.progress === b.progress &&
    a.title === b.title
  );
}

export function usePaginatedGoals(
  scope: Scope,
  displayFilter: string,
  enabled = true,
) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState(EMPTY_COUNTS);
  const offsetRef = useRef(0);
  const loadingRef = useRef(false);
  const requestGenRef = useRef(0);
  const scopeKey = `${scope.conversationId ?? ""}:${scope.projectId ?? ""}:${displayFilter}:${enabled}`;

  const loadPage = useCallback(
    async (reset: boolean) => {
      if (!enabled || loadingRef.current) return;
      const gen = ++requestGenRef.current;
      loadingRef.current = true;
      setLoading(true);
      try {
        const offset = reset ? 0 : offsetRef.current;
        const page = await api.getGoalsPage({
          conversationId: scope.conversationId,
          projectId: scope.projectId,
          displayFilter,
          limit: PAGE_SIZE,
          offset,
        });
        if (gen !== requestGenRef.current) return;
        setError(null);
        setGoals((prev) => (reset ? page.goals : [...prev, ...page.goals]));
        setTotal(page.total);
        setHasMore(page.hasMore);
        offsetRef.current = offset + page.goals.length;
      } catch (err) {
        if (gen === requestGenRef.current) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (gen === requestGenRef.current) {
          loadingRef.current = false;
          setLoading(false);
        }
      }
    },
    [displayFilter, enabled, scope.conversationId, scope.projectId],
  );

  const refreshCounts = useCallback(async () => {
    if (!enabled) return;
    const gen = requestGenRef.current;
    try {
      const { counts: next } = await api.getGoalCounts({
        conversationId: scope.conversationId,
        projectId: scope.projectId,
      });
      if (gen !== requestGenRef.current) return;
      setError(null);
      setCounts(next);
    } catch (err) {
      if (gen !== requestGenRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [enabled, scope.conversationId, scope.projectId]);

  useEffect(() => {
    if (!enabled) {
      setGoals([]);
      setTotal(0);
      setHasMore(false);
      setLoading(false);
      setError(null);
      setCounts(EMPTY_COUNTS);
      offsetRef.current = 0;
      return;
    }
    offsetRef.current = 0;
    requestGenRef.current += 1;
    void loadPage(true);
    void refreshCounts();
  }, [scopeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const mergeGoal = useCallback((goal: Goal) => {
    setGoals((prev) => {
      const idx = prev.findIndex((g) => g.id === goal.id);
      if (idx === -1) {
        setTotal((n) => n + 1);
        return [...prev, goal].sort(sortGoalsPageOrder);
      }
      if (goalsEqual(prev[idx]!, goal)) return prev;
      const next = [...prev];
      next[idx] = goal;
      return next;
    });
  }, []);

  const removeGoal = useCallback((goalId: string) => {
    setGoals((prev) => {
      if (!prev.some((g) => g.id === goalId)) return prev;
      return prev.filter((g) => g.id !== goalId);
    });
    setTotal((n) => Math.max(0, n - 1));
  }, []);

  return useMemo(
    () => ({
      goals,
      total,
      hasMore,
      loading,
      error,
      counts,
      loadMore: () => {
        if (!enabled || !hasMore || loading) return;
        void loadPage(false);
      },
      reload: () => {
        if (!enabled) return;
        offsetRef.current = 0;
        requestGenRef.current += 1;
        void loadPage(true);
        void refreshCounts();
      },
      mergeGoal,
      removeGoal,
      refreshCounts,
    }),
    [
      goals,
      total,
      hasMore,
      loading,
      error,
      counts,
      enabled,
      loadPage,
      refreshCounts,
      mergeGoal,
      removeGoal,
    ],
  );
}
