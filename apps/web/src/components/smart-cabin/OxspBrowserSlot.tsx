import { useCallback, useEffect, useState } from "react";
import type { PinDesktopScope } from "@openx/shared";
import { useBrowserBridge } from "../../lib/use-browser-bridge";
import { useBrowserObserve } from "../../lib/use-browser-observe";
import {
  OPENX_BROWSER_DEVTOOLS_EVENT,
  type BrowserDevToolsTab,
  type OpenBrowserDevToolsDetail,
} from "../../lib/browser-devtools-bus";
import { BrowserDevToolsPanel } from "./BrowserDevToolsPanel";

type Props = {
  slotId: string;
  startUrl?: string;
  sessionId?: string;
  scope?: PinDesktopScope;
};

export function OxspBrowserSlot({ slotId, startUrl, sessionId, scope = "conversation" }: Props) {
  const sid = sessionId ?? slotId;
  const initialUrl = startUrl?.trim() ?? "";
  const [navInput, setNavInput] = useState(initialUrl);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [devtoolsOpen, setDevtoolsOpen] = useState(false);
  const [devtoolsTab, setDevtoolsTab] = useState<BrowserDevToolsTab>("network");

  const {
    pageUrl,
    pageTitle,
    mock,
    connected,
    loading,
    error,
    frameRef,
    stageRef,
    navigate,
    goBack,
    goForward,
    reload,
    find,
    findStop,
    findResult,
    onFrameMouseDown,
    onFrameKeyDown,
  } = useBrowserBridge({
    sessionId: sid,
    startUrl: initialUrl || undefined,
  });

  const { dom, network, foremanPreview, loading: observeLoading, error: observeError, refresh, loadForemanPreview } =
    useBrowserObserve(sid, devtoolsOpen);

  useEffect(() => {
    if (pageUrl) setNavInput(pageUrl);
  }, [pageUrl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFindOpen(true);
        stageRef.current?.focus();
      }
      if (e.key === "Escape" && findOpen) {
        setFindOpen(false);
        findStop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [findOpen, findStop, stageRef]);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<OpenBrowserDevToolsDetail>).detail;
      if (detail.sessionId && detail.sessionId !== sid) return;
      setDevtoolsOpen(true);
      setDevtoolsTab(detail.tab);
      if (detail.tab === "foreman") {
        void loadForemanPreview(detail.scope ?? scope);
      }
    };
    window.addEventListener(OPENX_BROWSER_DEVTOOLS_EVENT, onOpen);
    return () => window.removeEventListener(OPENX_BROWSER_DEVTOOLS_EVENT, onOpen);
  }, [loadForemanPreview, scope, sid]);

  const onNavigate = useCallback(() => {
    const trimmed = navInput.trim();
    if (!trimmed) return;
    navigate(trimmed);
  }, [navInput, navigate]);

  const submitFind = useCallback(
    (direction: "next" | "prev" = "next", fromStart = false) => {
      if (!findQuery.trim()) return;
      find(findQuery, direction, fromStart);
    },
    [find, findQuery],
  );

  const openDevtools = useCallback(
    (tab: BrowserDevToolsTab) => {
      setDevtoolsOpen(true);
      setDevtoolsTab(tab);
      if (tab === "foreman") void loadForemanPreview(scope);
    },
    [loadForemanPreview, scope],
  );

  const displayUrl = pageUrl || initialUrl || "about:blank";

  return (
    <div className="oxsp-browser-slot pin-extension-webview">
      <div className="pin-extension-webview-toolbar oxsp-browser-toolbar">
        <div className="oxsp-browser-nav-group">
          <button type="button" className="btn compact oxsp-browser-nav-btn" title="后退" onClick={goBack}>
            ←
          </button>
          <button type="button" className="btn compact oxsp-browser-nav-btn" title="前进" onClick={goForward}>
            →
          </button>
          <button type="button" className="btn compact oxsp-browser-nav-btn" title="刷新" onClick={reload}>
            ↻
          </button>
        </div>
        <input
          className="pin-extension-bind-input oxsp-browser-url-input"
          value={navInput}
          onChange={(e) => setNavInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onNavigate();
          }}
          placeholder="输入网址后按 Enter 前往"
          aria-label="浏览器地址"
        />
        <button type="button" className="btn compact" onClick={() => void onNavigate()}>
          前往
        </button>
        <button type="button" className="btn compact" title="页内查找 Ctrl+F" onClick={() => setFindOpen(true)}>
          查找
        </button>
        <button
          type="button"
          className={`btn compact${devtoolsOpen && devtoolsTab === "network" ? " active" : ""}`}
          title="DevTools 网络"
          onClick={() => openDevtools("network")}
        >
          网络
        </button>
        <button
          type="button"
          className={`btn compact${devtoolsOpen && devtoolsTab === "dom" ? " active" : ""}`}
          title="browser_dom 快照"
          onClick={() => openDevtools("dom")}
        >
          DOM
        </button>
        <button
          type="button"
          className={`btn compact${devtoolsOpen && devtoolsTab === "foreman" ? " active" : ""}`}
          title="工头 LLM 可见上下文预览"
          onClick={() => openDevtools("foreman")}
        >
          工头
        </button>
        <span className="oxsp-browser-badge oxsp-browser-badge-foreman" title="Pin 后工头对话自动注入">
          工头可见
        </span>
        {mock ? (
          <span className="oxsp-browser-badge">Mock</span>
        ) : connected ? (
          <span className="oxsp-browser-badge oxsp-browser-badge-live">Live</span>
        ) : null}
      </div>

      {findOpen ? (
        <div className="oxsp-browser-find-bar">
          <input
            className="pin-extension-bind-input oxsp-browser-find-input"
            value={findQuery}
            onChange={(e) => setFindQuery(e.target.value)}
            placeholder="页内查找…"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") submitFind(e.shiftKey ? "prev" : "next", e.shiftKey);
              if (e.key === "Escape") {
                setFindOpen(false);
                findStop();
              }
            }}
          />
          <button type="button" className="btn compact" onClick={() => submitFind("next", true)}>
            查找
          </button>
          <button type="button" className="btn compact" onClick={() => submitFind("next")}>
            下一个
          </button>
          <button type="button" className="btn compact" onClick={() => submitFind("prev")}>
            上一个
          </button>
          <span className="oxsp-browser-find-meta">
            {findResult
              ? findResult.found
                ? "已匹配"
                : "无匹配"
              : "Enter 查找 · Shift+Enter 上一个"}
          </span>
          <button
            type="button"
            className="btn compact"
            onClick={() => {
              setFindOpen(false);
              findStop();
            }}
          >
            关闭
          </button>
        </div>
      ) : null}

      {devtoolsOpen ? (
        <div className="oxsp-browser-devtools">
          <div className="oxsp-browser-devtools-tabs">
            {(["network", "dom", "foreman"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                className={`btn compact${devtoolsTab === tab ? " active" : ""}`}
                onClick={() => openDevtools(tab)}
              >
                {tab === "network" ? "网络" : tab === "dom" ? "DOM" : "工头视图"}
              </button>
            ))}
            <button type="button" className="btn compact" onClick={() => void refresh()}>
              刷新
            </button>
            <button type="button" className="btn compact" onClick={() => setDevtoolsOpen(false)}>
              关闭
            </button>
          </div>
          <BrowserDevToolsPanel
            tab={devtoolsTab}
            dom={dom}
            network={network}
            foremanPreview={foremanPreview}
            loading={observeLoading}
            error={observeError}
          />
        </div>
      ) : null}

      {error ? (
        <p className="pin-extension-webview-error">{error}</p>
      ) : loading ? (
        <p className="pin-extension-webview-loading">正在连接 CDP 浏览器…</p>
      ) : null}

      <div
        ref={stageRef}
        className="oxsp-browser-screencast-wrap oxsp-browser-screencast-stage"
        tabIndex={0}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={onFrameKeyDown}
        role="presentation"
        title={`CDP · ${pageTitle || displayUrl}（点击/滚轮/键盘/Ctrl+V）`}
      >
        {!connected && !loading ? (
          <span className="oxsp-browser-screencast-hint">WebSocket 未连接，无法点击操作</span>
        ) : mock ? (
          <span className="oxsp-browser-screencast-hint">Mock 模式：无真实浏览器，点击无效</span>
        ) : null}
        <canvas
          ref={frameRef}
          className="oxsp-browser-screencast oxsp-browser-screencast-fit"
          aria-label={displayUrl}
          onMouseDown={onFrameMouseDown}
        />
      </div>
    </div>
  );
}
