import type { BrowserDomPayload, BrowserNetworkEntry } from "../../lib/use-browser-observe";

type Tab = "network" | "dom" | "foreman";

type Props = {
  tab: Tab;
  dom: BrowserDomPayload | null;
  network: BrowserNetworkEntry[];
  foremanPreview: string | null;
  loading: boolean;
  error: string | null;
};

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return String(ts);
  }
}

export function BrowserDevToolsPanel({ tab, dom, network, foremanPreview, loading, error }: Props) {
  if (error) {
    return <p className="oxsp-browser-devtools-error">{error}</p>;
  }

  if (loading && !dom && network.length === 0 && !foremanPreview) {
    return <p className="oxsp-browser-devtools-loading">加载中…</p>;
  }

  if (tab === "network") {
    if (network.length === 0) {
      return <p className="oxsp-browser-devtools-empty">暂无网络请求（导航后会自动记录）</p>;
    }
    return (
      <div className="oxsp-browser-network-table-wrap">
        <table className="oxsp-browser-network-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>方法</th>
              <th>状态</th>
              <th>类型</th>
              <th>URL</th>
            </tr>
          </thead>
          <tbody>
            {[...network].reverse().map((e) => (
              <tr key={e.id}>
                <td>{formatTime(e.ts)}</td>
                <td>{e.method}</td>
                <td>{e.status ?? "—"}</td>
                <td>{e.mimeType ?? "—"}</td>
                <td title={e.url}>{e.url}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (tab === "foreman") {
    return (
      <pre className="oxsp-browser-foreman-preview">
        {foremanPreview?.trim() || "工头 LLM 将在对话/施工队请示时自动注入已 Pin 浏览器槽的 DOM 与网络摘要。"}
      </pre>
    );
  }

  if (!dom) {
    return <p className="oxsp-browser-devtools-empty">暂无 DOM 快照</p>;
  }

  return (
    <div className="oxsp-browser-dom-panel">
      <p className="oxsp-browser-dom-meta">
        <strong>{dom.title || "(无标题)"}</strong>
        <span>{dom.url}</span>
      </p>
      {dom.inputs.length > 0 ? (
        <details open>
          <summary>表单控件 ({dom.inputs.length})</summary>
          <ul className="oxsp-browser-dom-list">
            {dom.inputs.map((i, idx) => (
              <li key={`${i.name}-${idx}`}>
                {i.tag}
                {i.type ? `[${i.type}]` : ""} · {i.name || "—"} · {i.placeholder || "—"}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {dom.links.length > 0 ? (
        <details>
          <summary>链接 ({dom.links.length})</summary>
          <ul className="oxsp-browser-dom-list">
            {dom.links.map((l, idx) => (
              <li key={`${l.href}-${idx}`}>
                <a href={l.href} target="_blank" rel="noreferrer">
                  {l.text || l.href}
                </a>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <pre className="oxsp-browser-dom-text">{dom.text || "(空页面)"}</pre>
    </div>
  );
}
