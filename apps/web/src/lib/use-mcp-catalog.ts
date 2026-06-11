import { useEffect, useState } from "react";
import { api } from "../api";
import { COACH_MCPS, type CoachMcp } from "../lib/coach-context";

export function useMcpCatalog() {
  const [mcps, setMcps] = useState<CoachMcp[]>(COACH_MCPS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void api
      .getMcp()
      .then(({ catalog }) => {
        if (cancelled) return;
        if (catalog?.length) {
          setMcps(
            catalog.map((m) => ({
              id: m.id,
              name: m.name,
              desc: m.desc,
            })),
          );
        }
      })
      .catch(() => {
        if (!cancelled) setMcps(COACH_MCPS);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { mcps, loading };
}
