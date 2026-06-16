import { useCallback, useEffect, useState } from "react";

export type BrowserDomPayload = {
  url: string;
  title: string;
  text: string;
  links: { text: string; href: string }[];
  inputs: { tag: string; type: string; name: string; placeholder: string }[];
};

export type BrowserNetworkEntry = {
  id: string;
  url: string;
  method: string;
  status?: number;
  mimeType?: string;
  ts: number;
};

export function useBrowserObserve(sessionId: string, enabled: boolean) {
  const [dom, setDom] = useState<BrowserDomPayload | null>(null);
  const [network, setNetwork] = useState<BrowserNetworkEntry[]>([]);
  const [foremanPreview, setForemanPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const [domRes, netRes] = await Promise.all([
        fetch(`/api/desktop/browser/${encodeURIComponent(sessionId)}/dom`),
        fetch(`/api/desktop/browser/${encodeURIComponent(sessionId)}/network`),
      ]);
      if (!domRes.ok || !netRes.ok) throw new Error("加载浏览器观测数据失败");
      const domBody = (await domRes.json()) as { ok: boolean; dom: BrowserDomPayload };
      const netBody = (await netRes.json()) as { ok: boolean; entries: BrowserNetworkEntry[] };
      setDom(domBody.dom);
      setNetwork(netBody.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const loadForemanPreview = useCallback(
    async (scope: "console" | "conversation") => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/desktop/browser-context?scope=${scope}`);
        if (!res.ok) throw new Error("工头上下文预览失败");
        const body = (await res.json()) as { ok: boolean; text: string | null };
        setForemanPreview(body.text);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 4_000);
    return () => window.clearInterval(timer);
  }, [enabled, refresh]);

  return { dom, network, foremanPreview, loading, error, refresh, loadForemanPreview };
}
