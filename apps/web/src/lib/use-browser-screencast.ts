import { useCallback, useEffect, useRef, useState } from "react";

export type BrowserFrameResponse = {
  ok: boolean;
  imageBase64?: string;
  mime?: string;
  width?: number;
  height?: number;
  url?: string;
  mock?: boolean;
  error?: string;
  hint?: string;
};

type Options = {
  sessionId: string;
  startUrl?: string;
  pollMs?: number;
  enabled?: boolean;
};

export function useBrowserScreencast({
  sessionId,
  startUrl,
  pollMs = 400,
  enabled = true,
}: Options) {
  const [frame, setFrame] = useState<BrowserFrameResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const ensuredRef = useRef(false);

  const fetchFrame = useCallback(async () => {
    const qs = startUrl ? `?startUrl=${encodeURIComponent(startUrl)}` : "";
    try {
      const res = await fetch(`/api/desktop/browser/${sessionId}/frame${qs}`);
      let data: BrowserFrameResponse;
      try {
        data = (await res.json()) as BrowserFrameResponse;
      } catch {
        setError(`浏览器服务异常 (${res.status})`);
        setLoading(false);
        return;
      }
      if (!data.ok) {
        setError(data.hint ?? data.error ?? `browser_unavailable (${res.status})`);
        setLoading(false);
        return;
      }
      setFrame(data);
      setError(null);
      setLoading(false);
    } catch {
      setError("无法连接浏览器服务");
      setLoading(false);
    }
  }, [sessionId, startUrl]);

  useEffect(() => {
    if (!enabled || !sessionId) return;
    let cancelled = false;

    void (async () => {
      if (!ensuredRef.current) {
        ensuredRef.current = true;
        await fetch(`/api/desktop/browser/${sessionId}/ensure`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ startUrl }),
        }).catch(() => undefined);
      }
      if (cancelled) return;
      await fetchFrame();
    })();

    const timer = window.setInterval(() => {
      void fetchFrame();
    }, pollMs);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled, sessionId, startUrl, pollMs, fetchFrame]);

  const sendClick = useCallback(
    async (x: number, y: number) => {
      try {
        const res = await fetch(`/api/desktop/browser/${sessionId}/input`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "click", x, y }),
        });
        let data: { ok: boolean; frame?: BrowserFrameResponse; error?: string; hint?: string };
        try {
          data = (await res.json()) as typeof data;
        } catch {
          setError(`点击失败 (${res.status})`);
          return;
        }
        if (!data.ok) {
          setError(data.hint ?? data.error ?? "点击转发失败");
          return;
        }
        if (data.frame) {
          setFrame({ ...data.frame, ok: true });
          setError(null);
        } else {
          await fetchFrame();
        }
      } catch {
        setError("点击转发请求失败");
      }
    },
    [sessionId, fetchFrame],
  );

  return { frame, error, loading, sendClick, refresh: fetchFrame };
}
