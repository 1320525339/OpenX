import { useCallback, useEffect, useState } from "react";

type Props = {
  url: string;
};

export function PinExtensionWebView({ url }: Props) {
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    setLoadState("loading");
  }, [url]);

  const onLoad = useCallback(() => {
    setLoadState("ready");
  }, []);

  const onError = useCallback(() => {
    setLoadState("error");
  }, []);

  return (
    <div className="pin-extension-webview">
      <div className="pin-extension-webview-toolbar">
        <span className="pin-extension-webview-url" title={url}>
          {url}
        </span>
        <a
          className="pin-extension-webview-open"
          href={url}
          target="_blank"
          rel="noreferrer noopener"
        >
          新标签页打开
        </a>
      </div>
      {loadState === "error" ? (
        <p className="pin-extension-webview-error">
          无法在卡片内加载该页面（可能被站点禁止嵌入，或地址不可达）。请使用上方链接在新标签页打开。
        </p>
      ) : null}
      {loadState === "loading" ? (
        <p className="pin-extension-webview-loading">网页加载中…</p>
      ) : null}
      <iframe
        className="pin-extension-iframe"
        src={url}
        title="拓展页网页"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
        referrerPolicy="no-referrer-when-downgrade"
        onLoad={onLoad}
        onError={onError}
      />
    </div>
  );
}
