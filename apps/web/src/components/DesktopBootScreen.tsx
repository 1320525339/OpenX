type Props = {
  state: "booting" | "error";
  onRetry?: () => void;
};

export function DesktopBootScreen({ state, onRetry }: Props) {
  return (
    <div className="desktop-boot-screen" role="status" aria-live="polite">
      <div className="desktop-boot-card">
        <div className="desktop-boot-logo">OpenX</div>
        {state === "booting" ? (
          <>
            <p className="desktop-boot-title">正在启动本地服务…</p>
            <p className="desktop-boot-hint">首次启动可能需要几秒钟</p>
            <div className="desktop-boot-spinner" aria-hidden />
          </>
        ) : (
          <>
            <p className="desktop-boot-title">本地服务启动失败</p>
            <p className="desktop-boot-hint">请检查 sidecar 是否已正确打包，或稍后重试。</p>
            {onRetry ? (
              <button type="button" className="btn primary desktop-boot-retry" onClick={onRetry}>
                重试
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
