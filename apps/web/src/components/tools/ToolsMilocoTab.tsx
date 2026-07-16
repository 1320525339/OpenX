import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  connectEvents,
  type MilocoHomeCronStatus,
  type MilocoLayerBStatus,
  type MilocoScopeCamera,
  type MilocoStatusResponse,
} from "../../api";
import { MilocoEventsPanel } from "./MilocoEventsPanel";
import type { MilocoEventItem } from "../../api";

type PageId = "overview" | "devices" | "automation" | "events" | "diagnose" | "wizard";

type Props = {
  onOpenGoal?: (goalId: string) => void;
};

function cameraStatusLabel(cam: MilocoScopeCamera): string {
  if (cam.in_use && cam.is_online && cam.connected) return "就绪";
  if (cam.in_use && cam.is_online) return "在线未连流";
  if (cam.in_use) return "已启用离线";
  if (cam.is_online) return "在线未启用";
  return "离线";
}

function cameraStatusClass(cam: MilocoScopeCamera): string {
  if (cam.in_use && cam.is_online && cam.connected) return "miloco-cam-ready";
  if (cam.in_use) return "miloco-cam-warn";
  return "miloco-cam-off";
}

function connectionLabel(layerB: MilocoLayerBStatus | null): string {
  if (!layerB?.checkedAt) return "检测中";
  if (layerB.ready) return "已连接";
  if (layerB.checks.some((c) => c.ok)) return "部分可用";
  return "离线";
}

function mapWslError(detail: string): string {
  const text = detail.toLowerCase();
  if (/there is no distribution|发行版|wsl.*not.*install/i.test(detail) || text.includes("no distribution")) {
    return "WSL 发行版不存在或未安装";
  }
  if (/timeout|超时/.test(detail)) return "Miloco 命令超时，服务可能未响应";
  if (/connection refused|无法连接|econnrefused/.test(text)) return "Miloco 未启动或端口不可达";
  if (/curl|webhook/.test(text) && /fail|无法/.test(detail)) return "Webhook 回调网络不通";
  return detail;
}

function MetricCard({
  label,
  ok,
  detail,
  onClick,
}: {
  label: string;
  ok: boolean;
  detail: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={`miloco-metric${ok ? " ok" : " fail"}`}
      onClick={onClick}
    >
      <strong>{label}</strong>
      <span>{ok ? "正常" : "异常"}</span>
      <em>{detail}</em>
    </button>
  );
}

export function ToolsMilocoTab({ onOpenGoal }: Props) {
  const [page, setPage] = useState<PageId>("overview");
  const [status, setStatus] = useState<MilocoStatusResponse | null>(null);
  const [layerB, setLayerB] = useState<MilocoLayerBStatus | null>(null);
  const [homeCron, setHomeCron] = useState<MilocoHomeCronStatus | null>(null);
  const [events, setEvents] = useState<MilocoEventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wizardStep, setWizardStep] = useState(0);
  const [wizardDevices, setWizardDevices] = useState<
    Array<{ did: string; name: string; room: string; online: boolean }>
  >([]);
  const [selectedDids, setSelectedDids] = useState<string[]>([]);
  const [homeName, setHomeName] = useState("");

  const refresh = useCallback(async (opts?: { light?: boolean }) => {
    const light = opts?.light === true;
    if (!light) setLoading(true);
    setError(null);
    try {
      const [st, lb, ev, cron] = await Promise.all([
        api.getMilocoStatus(),
        api.getMilocoLayerB(),
        api.getMilocoEvents(50),
        api.getMilocoHomeCron(),
      ]);
      setStatus(st);
      setLayerB(lb);
      setEvents(ev.goals ?? ev.runs ?? []);
      setHomeCron(cron);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!light) setLoading(false);
    }
  }, []);

  const rediagnose = useCallback(async () => {
    setBusy("rediagnose");
    setError(null);
    try {
      let lb = await api.refreshMilocoLayerB();
      setLayerB(lb);
      for (let i = 0; i < 8 && lb.refreshing; i += 1) {
        await new Promise((r) => setTimeout(r, 700));
        lb = await api.getMilocoLayerB();
        setLayerB(lb);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const disconnect = connectEvents({
      onEvent: (e) => {
        if (
          e.type === "integration.updated" ||
          e.type === "integration.run.updated"
        ) {
          void refresh({ light: true });
        }
      },
    });
    return () => disconnect();
  }, [refresh]);

  const runAction = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await refresh({ light: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const metrics = useMemo(() => {
    const checks = layerB?.checks ?? [];
    const find = (id: string) => checks.find((c) => c.id === id);
    return {
      service: find("miloco_service"),
      webhook: find("wsl_webhook") ?? find("miloco_webhook_config"),
      camera: find("scope_cameras"),
      automation: {
        ok: (homeCron?.enabled ?? false) || events.length >= 0,
        detail: homeCron?.enabled ? "家庭自动化已启用" : "家庭自动化未启用",
      },
    };
  }, [layerB, homeCron, events.length]);

  if (loading && !status) {
    return <p className="settings-hint">加载 Miloco 集成状态…</p>;
  }

  const conn = connectionLabel(layerB);

  return (
    <div className="tools-section miloco-tools">
      <header className="miloco-hero">
        <div>
          <h3 className="tools-section-title">
            Miloco 智能家居
            <span className={`miloco-pill${conn === "已连接" ? " ok" : ""}`}>{conn}</span>
          </h3>
          <p className="settings-hint">
            版本 1.0.0
            {layerB?.checkedAt
              ? ` · 最近检测 ${new Date(layerB.checkedAt).toLocaleString()}`
              : ""}
            {layerB?.refreshing ? " · 诊断中…" : ""}
            {layerB?.stale ? " · 状态可能过期" : ""}
          </p>
        </div>
        <div className="miloco-actions">
          <a
            className="btn"
            href={status?.dashboardUrl ?? "http://127.0.0.1:1810/"}
            target="_blank"
            rel="noreferrer"
          >
            打开 Dashboard
          </a>
          <button type="button" className="btn" disabled={!!busy} onClick={() => setPage("wizard")}>
            接入向导
          </button>
        </div>
      </header>

      {error ? <p className="form-error">{error}</p> : null}

      <nav className="miloco-subnav" aria-label="Miloco 分页">
        {(
          [
            ["overview", "概览"],
            ["devices", "设备与感知"],
            ["automation", "自动化"],
            ["events", "事件"],
            ["diagnose", "诊断"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`tools-tab${page === id ? " active" : ""}`}
            onClick={() => setPage(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {page === "overview" ? (
        <section className="tools-card miloco-card">
          <div className="miloco-metrics">
            <MetricCard
              label="服务"
              ok={metrics.service?.ok ?? false}
              detail={mapWslError(metrics.service?.detail ?? "未知")}
              onClick={() => setPage("diagnose")}
            />
            <MetricCard
              label="Webhook"
              ok={metrics.webhook?.ok ?? false}
              detail={mapWslError(metrics.webhook?.detail ?? "未知")}
              onClick={() => setPage("diagnose")}
            />
            <MetricCard
              label="摄像头"
              ok={metrics.camera?.ok ?? false}
              detail={metrics.camera?.detail ?? "未知"}
              onClick={() => setPage("devices")}
            />
            <MetricCard
              label="自动化"
              ok={Boolean(homeCron?.enabled)}
              detail={metrics.automation.detail}
              onClick={() => setPage("automation")}
            />
          </div>
          <div className="miloco-actions">
            <button
              type="button"
              className="btn"
              disabled={!!busy}
              onClick={() => void runAction("setup", () => api.setupMiloco({ force: false }))}
            >
              {busy === "setup" ? "同步中…" : "同步能力包"}
            </button>
            <button type="button" className="btn" disabled={!!busy} onClick={() => void rediagnose()}>
              {busy === "rediagnose" ? "诊断中…" : "重新诊断"}
            </button>
          </div>
        </section>
      ) : null}

      {page === "devices" ? (
        <section className="tools-card miloco-card">
          <h4 className="tools-section-title">摄像头</h4>
          <p className="settings-hint">
            已启用 {layerB?.enabledCameraCount ?? 0}/{layerB?.maxEnabledCameras ?? 4} 路
          </p>
          {layerB?.cameras?.length ? (
            <div className="miloco-cam-table">
              {layerB.cameras.map((cam) => (
                <div key={cam.did} className="miloco-cam-row">
                  <div>
                    <strong>{cam.name ?? cam.did}</strong>
                    {cam.room ? <span className="miloco-cam-room">{cam.room}</span> : null}
                  </div>
                  <span className={`miloco-cam-status ${cameraStatusClass(cam)}`}>
                    {cameraStatusLabel(cam)}
                  </span>
                  <div className="miloco-cam-btns">
                    {!cam.in_use ? (
                      <button
                        type="button"
                        className="btn small"
                        disabled={!!busy}
                        onClick={() =>
                          void runAction(`enable-${cam.did}`, () =>
                            api.enableMilocoCameras([cam.did]),
                          )
                        }
                      >
                        启用
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn small"
                        disabled={!!busy}
                        onClick={() =>
                          void runAction(`disable-${cam.did}`, () =>
                            api.disableMilocoCameras([cam.did]),
                          )
                        }
                      >
                        停用
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="settings-hint">未找到摄像头，请先完成接入向导。</p>
          )}
        </section>
      ) : null}

      {page === "automation" ? (
        <section className="tools-card miloco-card">
          <h4 className="tools-section-title">家庭定时任务</h4>
          {homeCron ? (
            <>
              <p className="settings-hint">
                {homeCron.enabled ? "已启用" : "未启用（需在环境中打开家庭自动化）"}
              </p>
              <ul className="miloco-meta-list">
                {homeCron.tasks.map((t) => (
                  <li key={t.name}>
                    {t.description || t.name} — {t.nextHint}
                  </li>
                ))}
              </ul>
              <div className="miloco-actions">
                <button
                  type="button"
                  className="btn"
                  disabled={!!busy}
                  onClick={() =>
                    void runAction("cron-digest", () =>
                      api.triggerMilocoHomeCron("miloco-perception-digest"),
                    )
                  }
                >
                  立即运行感知摘要
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={!!busy}
                  onClick={() =>
                    void runAction("cron-patrol", () =>
                      api.triggerMilocoHomeCron("miloco-home-patrol"),
                    )
                  }
                >
                  立即运行家庭巡检
                </button>
              </div>
            </>
          ) : (
            <p className="settings-hint">加载自动化状态…</p>
          )}
        </section>
      ) : null}

      {page === "events" ? (
        <section className="tools-card miloco-card">
          <h4 className="tools-section-title">感知与自动化事件</h4>
          <MilocoEventsPanel
            limit={50}
            pollMs={20_000}
            onOpenGoal={(id) => {
              const item = events.find((e) => e.id === id || e.goalId === id);
              const goalId = item?.goalId ?? (item?.status === "needs_attention" ? undefined : undefined);
              if (item?.goalId) onOpenGoal?.(item.goalId);
              else if (goalId) onOpenGoal?.(goalId);
            }}
          />
        </section>
      ) : null}

      {page === "diagnose" ? (
        <section className="tools-card miloco-card">
          <h4 className="tools-section-title">诊断详情</h4>
          <div className="miloco-actions">
            <button type="button" className="btn primary" disabled={!!busy} onClick={() => void rediagnose()}>
              {busy === "rediagnose" || layerB?.refreshing ? "诊断中…" : "重新诊断"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={!!busy}
              onClick={() =>
                void runAction("connect", () => api.connectMilocoWsl("127.0.0.1"))
              }
            >
              自动配置回调
            </button>
          </div>
          {layerB ? (
            <ul className="miloco-check-list">
              {layerB.checks.map((c) => (
                <li key={c.id} className={c.ok ? "ok" : "fail"}>
                  {mapWslError(c.detail)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="settings-hint">尚无诊断缓存，请点击重新诊断。</p>
          )}
        </section>
      ) : null}

      {page === "wizard" ? (
        <section className="tools-card miloco-card">
          <h4 className="tools-section-title">首次接入向导</h4>
          <ol className="miloco-wizard-steps">
            <li className={wizardStep >= 0 ? "active" : ""}>检测环境</li>
            <li className={wizardStep >= 1 ? "active" : ""}>选择设备</li>
            <li className={wizardStep >= 2 ? "active" : ""}>配置回调</li>
            <li className={wizardStep >= 3 ? "active" : ""}>完成</li>
          </ol>
          {wizardStep === 0 ? (
            <div className="miloco-actions">
              <button
                type="button"
                className="btn primary"
                disabled={!!busy}
                onClick={() =>
                  void runAction("wizard-detect", async () => {
                    await api.refreshMilocoLayerB();
                    const homes = await api.getMilocoHomes();
                    setWizardDevices(homes.devices ?? []);
                    setWizardStep(1);
                  })
                }
              >
                开始检测
              </button>
            </div>
          ) : null}
          {wizardStep === 1 ? (
            <>
              <label className="form-label">家庭名称</label>
              <input
                className="field-input"
                value={homeName}
                onChange={(e) => setHomeName(e.target.value)}
                placeholder="例如：客厅家庭"
              />
              <p className="settings-hint">勾选需要监测的设备</p>
              <ul className="miloco-meta-list">
                {wizardDevices.map((d) => (
                  <li key={d.did}>
                    <label>
                      <input
                        type="checkbox"
                        checked={selectedDids.includes(d.did)}
                        onChange={(e) => {
                          setSelectedDids((prev) =>
                            e.target.checked
                              ? [...prev, d.did]
                              : prev.filter((x) => x !== d.did),
                          );
                        }}
                      />{" "}
                      {d.name || d.did} {d.online ? "(在线)" : "(离线)"}
                    </label>
                  </li>
                ))}
              </ul>
              <button type="button" className="btn primary" onClick={() => setWizardStep(2)}>
                下一步
              </button>
            </>
          ) : null}
          {wizardStep === 2 ? (
            <div className="miloco-actions">
              <button
                type="button"
                className="btn primary"
                disabled={!!busy}
                onClick={() =>
                  void runAction("wizard-finish", async () => {
                    await api.completeMilocoSetupWizard({
                      homeName: homeName || "我的家庭",
                      watchDids: selectedDids,
                      webhookHost: "127.0.0.1",
                    });
                    await api.connectMilocoWsl("127.0.0.1");
                    setWizardStep(3);
                  })
                }
              >
                配置回调并完成
              </button>
            </div>
          ) : null}
          {wizardStep === 3 ? (
            <div>
              <p className="settings-hint">接入完成。可返回概览查看连接状态。</p>
              <button type="button" className="btn" onClick={() => setPage("overview")}>
                返回概览
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
