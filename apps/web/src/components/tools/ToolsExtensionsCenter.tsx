import { useCallback, useEffect, useState } from "react";
import { connectEvents, api, type IntegrationDirectoryEntry } from "../../api";
import { ToolsMilocoTab } from "./ToolsMilocoTab";
import type { Goal } from "@openx/shared";

type Props = {
  onOpenGoal?: (goal: Goal) => void;
};

const HEALTH_LABEL: Record<string, string> = {
  ok: "正常",
  degraded: "降级",
  disabled: "未启用",
  starting: "启动中",
};

/**
 * 通用拓展中心：目录卡片 + 详情（Miloco 等由 manifest 驱动）。
 */
export function ToolsExtensionsCenter({ onOpenGoal }: Props) {
  const [integrations, setIntegrations] = useState<IntegrationDirectoryEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await api.getIntegrations();
      setIntegrations(res.integrations ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const disconnect = connectEvents({
      onEvent: (e) => {
        if (e.type === "integration.updated" || e.type === "integration.run.updated") {
          void refresh();
        }
      },
    });
    return () => disconnect();
  }, [refresh]);

  const toggle = async (id: string, enabled: boolean) => {
    setBusy(id);
    setError(null);
    try {
      const res = await api.patchIntegration(id, { enabled });
      if (!res.ok) {
        setError(res.error ?? (res.envLocked ? "环境变量已锁定" : "操作失败"));
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  if (selectedId === "miloco") {
    return (
      <div className="tools-section">
        <button type="button" className="btn" onClick={() => setSelectedId(null)}>
          ← 返回拓展中心
        </button>
        <ToolsMilocoTab
          onOpenGoal={(goalId) => onOpenGoal?.({ id: goalId } as Goal)}
        />
      </div>
    );
  }

  return (
    <div className="tools-section miloco-tools">
      <h3 className="tools-section-title">拓展中心</h3>
      <p className="settings-hint">安装与管理第三方集成。禁用后停止后台任务并拒绝新事件。</p>
      {error ? <p className="form-error">{error}</p> : null}

      <div className="miloco-metrics" style={{ gridTemplateColumns: "1fr" }}>
        {integrations.length === 0 ? (
          <p className="settings-hint">暂无已安装的集成。</p>
        ) : (
          integrations.map((item) => (
            <div key={item.id} className="tools-card miloco-card" style={{ padding: "0.85rem" }}>
              <div className="miloco-hero">
                <div>
                  <h4 className="tools-section-title">
                    {item.icon} {item.displayName}
                    <span className={`miloco-pill${item.health === "ok" ? " ok" : ""}`}>
                      {HEALTH_LABEL[item.health] ?? item.health}
                    </span>
                  </h4>
                  <p className="settings-hint">
                    v{item.version}
                    {item.enabled ? " · 已启用" : " · 未启用"}
                    {item.envLocked ? ` · ${item.envLockReason}` : ""}
                    {item.healthDetail ? ` · ${item.healthDetail}` : ""}
                  </p>
                </div>
                <div className="miloco-actions">
                  {item.enabled ? (
                    <button
                      type="button"
                      className="btn"
                      disabled={!!busy || item.envLocked}
                      onClick={() => void toggle(item.id, false)}
                    >
                      停用
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn primary"
                      disabled={!!busy || item.envLocked}
                      onClick={() => void toggle(item.id, true)}
                    >
                      启用
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn"
                    disabled={!item.enabled}
                    onClick={() => setSelectedId(item.id)}
                  >
                    打开
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
