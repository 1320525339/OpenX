import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";

export type StripLogEntry = {
  goalId: string;
  level: string;
  message: string;
  timestamp: string;
};

const PAGE_SIZE = 120;

function logKey(entry: StripLogEntry) {
  return `${entry.goalId}:${entry.timestamp}:${entry.message}`;
}

export function usePaginatedLogs(
  liveLogs: StripLogEntry[],
  opts: { goalId?: string | null; enabled: boolean },
) {
  const [olderLogs, setOlderLogs] = useState<StripLogEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const offsetRef = useRef(0);
  const loadingRef = useRef(false);
  const scopeKey = `${opts.goalId ?? "all"}:${opts.enabled}`;

  const loadOlder = useCallback(async () => {
    if (!opts.enabled || loadingRef.current || !hasMore) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const page = await api.getLogsPage({
        goalId: opts.goalId ?? undefined,
        limit: PAGE_SIZE,
        offset: offsetRef.current,
      });
      setError(null);
      setOlderLogs((prev) => {
        const seen = new Set(prev.map(logKey));
        const older: StripLogEntry[] = [];
        for (const row of page.logs) {
          const key = logKey(row);
          if (seen.has(key)) continue;
          seen.add(key);
          older.push(row);
        }
        return [...older, ...prev];
      });
      setHasMore(page.hasMore);
      offsetRef.current += page.logs.length;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [hasMore, opts.enabled, opts.goalId]);

  const bootstrap = useCallback(async () => {
    if (!opts.enabled) return;
    setLoading(true);
    try {
      const page = await api.getLogsPage({
        goalId: opts.goalId ?? undefined,
        limit: PAGE_SIZE,
        offset: 0,
      });
      setError(null);
      setOlderLogs(page.logs);
      setHasMore(page.hasMore);
      offsetRef.current = page.logs.length;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [opts.enabled, opts.goalId]);

  useEffect(() => {
    offsetRef.current = 0;
    setOlderLogs([]);
    setHasMore(false);
    setError(null);
    if (opts.enabled) void bootstrap();
  }, [scopeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const merged = useMemo(() => {
    const map = new Map<string, StripLogEntry>();
    for (const entry of olderLogs) map.set(logKey(entry), entry);
    for (const entry of liveLogs) map.set(logKey(entry), entry);
    return [...map.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }, [liveLogs, olderLogs]);

  return {
    logs: merged,
    hasMore,
    loading,
    error,
    loadOlder,
    reload: bootstrap,
  };
}
