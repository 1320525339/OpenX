import type { PinDesktopScope } from "@openx/shared";

type Props = {
  scope: PinDesktopScope;
  onOpenDom: () => void;
  onOpenNetwork: () => void;
  onPreviewForeman: () => void;
};

/** 工头底栏/上下文条：浏览器观测快捷入口 */
export function ForemanBrowserShortcuts({ scope, onOpenDom, onOpenNetwork, onPreviewForeman }: Props) {
  return (
    <div className="foreman-browser-shortcuts" role="group" aria-label="浏览器工头观测">
      <span className="foreman-browser-shortcuts-label">浏览器·工头</span>
      <button type="button" className="btn compact" onClick={onOpenDom} title="查看 DOM（browser_dom）">
        DOM
      </button>
      <button type="button" className="btn compact" onClick={onOpenNetwork} title="DevTools 网络面板">
        网络
      </button>
      <button
        type="button"
        className="btn compact"
        onClick={onPreviewForeman}
        title="预览工头 LLM 将看到的浏览器上下文"
      >
        工头视图
      </button>
      <span className="foreman-browser-shortcuts-hint">{scope === "console" ? "调度台" : "项目对话"}</span>
    </div>
  );
}
