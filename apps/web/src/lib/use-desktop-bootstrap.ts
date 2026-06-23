import { useEffect, useState } from "react";
import { getApiBase } from "./api-base";
import { listenServerReady } from "./desktop-bridge";
import { isTauri } from "./is-tauri";

export type DesktopBootState = "booting" | "ready" | "error";

const PROBE_INTERVAL_MS = 1000;
const PROBE_TIMEOUT_MS = 2000;

async function probeServerReady(): Promise<boolean> {
  try {
    const res = await fetch(`${getApiBase()}/api/health`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function useDesktopBootstrap() {
  const [bootState, setBootState] = useState<DesktopBootState>(() =>
    isTauri() ? "booting" : "ready",
  );

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let pollTimer: ReturnType<typeof setInterval> | undefined;

    const markReady = (ready: boolean) => {
      if (disposed) return;
      setBootState(ready ? "ready" : "error");
      if (ready && pollTimer) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }
    };

    void probeServerReady().then((ok) => {
      if (ok) markReady(true);
    });

    pollTimer = setInterval(() => {
      void probeServerReady().then((ok) => {
        if (ok) markReady(true);
      });
    }, PROBE_INTERVAL_MS);

    void listenServerReady((ready) => {
      markReady(ready);
    }).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      unlisten = fn;
    });

    return () => {
      disposed = true;
      if (pollTimer) clearInterval(pollTimer);
      unlisten?.();
    };
  }, []);

  return { bootState, isDesktop: isTauri() };
}
