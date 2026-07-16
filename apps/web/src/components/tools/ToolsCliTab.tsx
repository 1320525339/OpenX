import { useEffect, useState } from "react";
import {
  DEFAULT_PI_MAX_TOOL_CALLS,
  type ConnectBootstrapStatus,
  type Goal,
  type Settings,
} from "@openx/shared";
import { hasAcpCliConfigTool } from "@openx/shared";
import { api, type ExecutorInfo } from "../../api";
import { ExecutorPicker } from "../ExecutorPicker";
import { AddCliDialog } from "./AddCliDialog";
import { AcpCliConfigDialog } from "./AcpCliConfigDialog";
import { cliKindLabel, listManagedClis, type CliEntry } from "../../lib/tools-clis";

type Props = {
  settings: Settings;
  executors: ExecutorInfo[];
  detecting: boolean;
  onChange: (settings: Settings) => void;
  onRefresh: () => void;
  onIntegrationGoalCreated: (goal: Goal) => void;
  onDeleteProfile: (executorId: string) => Promise<void>;
  onBootstrap: (executorId: string) => Promise<{ command?: string; online?: boolean }>;
  onDisconnect: (executorId: string) => Promise<void>;
  onConnectReady?: (executorId: string) => void;
};

function bootstrapStatusHint(status?: ConnectBootstrapStatus): string | undefined {
  if (!status) return undefined;
  if (status.online) return "自举：已上线";
  if (status.phase === "running" && status.pid) return `自举中 · pid ${status.pid}`;
  if (status.phase === "spawning") return "自举：正在启动…";
  if (status.phase === "exited") {
    const code = status.exitCode != null ? ` (code ${status.exitCode})` : "";
    return `自举：进程已退出${code}`;
  }
  return undefined;
}

function CliCard({
  cli,
  onDelete,
  onBootstrap,
  onDisconnect,
  onCopyCommand,
  onOpenConfig,
  bootstrapStatus,
}: {
  cli: CliEntry;
  onDelete?: () => void;
  onBootstrap?: () => void;
  onDisconnect?: () => void;
  onCopyCommand?: () => void;
  onOpenConfig?: () => void;
  bootstrapStatus?: ConnectBootstrapStatus;
}) {
  const bootstrapHint = bootstrapStatusHint(bootstrapStatus);
  const configurable = hasAcpCliConfigTool(cli.id);

  return (
    <div
      className={`tools-cli-card${cli.available ? "" : " unavailable"}${configurable ? " clickable" : ""}`}
      role={configurable ? "button" : undefined}
      tabIndex={configurable ? 0 : undefined}
      onClick={
        configurable
          ? (e) => {
              if ((e.target as HTMLElement).closest("button, a")) return;
              onOpenConfig?.();
            }
          : undefined
      }
      onKeyDown={
        configurable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpenConfig?.();
              }
            }
          : undefined
      }
    >
      <div className="tools-cli-card-head">
        <span className="tools-cli-kind">{cliKindLabel(cli.kind)}</span>
        <span className={`tools-cli-status${cli.available ? " ok" : ""}`}>
          {cli.available ? "● 可用" : "○ 不可用"}
        </span>
      </div>
      <strong className="tools-cli-name">{cli.label}</strong>
      <code className="tools-cli-id">{cli.id}</code>
      {cli.hint && cli.hint !== cli.label && (
        <p className="settings-hint tools-cli-hint">{cli.hint}</p>
      )}
      {bootstrapHint && (
        <p className={`settings-hint tools-cli-hint${bootstrapStatus?.online ? " ok-text" : ""}`}>
          {bootstrapHint}
          {bootstrapStatus?.lastError && !bootstrapStatus.online
            ? ` — ${bootstrapStatus.lastError}`
            : ""}
        </p>
      )}
      {configurable && (
        <p className="settings-hint tools-cli-config-hint">点击选择渠道与模型</p>
      )}
      {cli.tutorialUrl && (
        <a
          className="tools-tutorial-link inline"
          href={cli.tutorialUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          接入教程 ↗
        </a>
      )}
      <div className="tools-cli-card-actions">
        {cli.canBootstrap && onBootstrap && (
          <button type="button" className="btn primary compact" onClick={onBootstrap}>
            一键自举
          </button>
        )}
        {cli.canBootstrap && onCopyCommand && (
          <button type="button" className="btn compact" onClick={onCopyCommand}>
            复制启动命令
          </button>
        )}
        {cli.available && cli.kind === "connect" && onDisconnect && (
          <button type="button" className="btn compact" onClick={onDisconnect}>
            断开连接
          </button>
        )}
        {cli.deletable && onDelete && (
          <button type="button" className="btn danger compact" onClick={onDelete}>
            删除
          </button>
        )}
      </div>
    </div>
  );
}

export function ToolsCliTab({
  settings,
  executors,
  detecting,
  onChange,
  onRefresh,
  onIntegrationGoalCreated,
  onDeleteProfile,
  onBootstrap,
  onDisconnect,
  onConnectReady,
}: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [configExecutorId, setConfigExecutorId] = useState<string | null>(null);
  const [bootstrapStatuses, setBootstrapStatuses] = useState<
    Map<string, ConnectBootstrapStatus>
  >(new Map());
  const clis = listManagedClis(executors, settings.cliProfiles ?? []);
  const acpClis = clis.filter((c) => c.kind === "acp");
  const connectClis = clis.filter((c) => c.kind === "connect");
  const offlineConnectIds = connectClis.filter((c) => !c.available).map((c) => c.id);

  useEffect(() => {
    if (offlineConnectIds.length === 0) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const { statuses } = await api.getCliBootstrapStatuses();
        if (cancelled) return;
        setBootstrapStatuses(new Map(statuses.map((s: ConnectBootstrapStatus) => [s.executorId, s])));
      } catch {
        /* 轮询失败可忽略 */
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [offlineConnectIds.join("|")]);
  const piCli = clis.find((c) => c.kind === "pi");
  const existingIds = clis.map((c) => c.id);

  const copyBootstrap = async (executorId: string) => {
    const res = await fetch(`/api/cli/profiles/${encodeURIComponent(executorId)}/bootstrap`);
    const body = (await res.json()) as { command?: string };
    if (body.command) await navigator.clipboard.writeText(body.command);
  };

  return (
    <>
      <div className="tools-tab-toolbar">
        <p className="settings-hint tools-tab-lead">
          添加 Connect Agent 时会预写派单 ID 并可选自动自举；若未上线，Pi 接入任务会调用 bootstrap API 完成启动。
        </p>
        <div className="tools-tab-toolbar-actions">
          <button type="button" className="btn primary compact" onClick={() => setShowAdd(true)}>
            ＋ 添加 CLI
          </button>
          <button type="button" className="btn compact" disabled={detecting} onClick={onRefresh}>
            {detecting ? "检测中…" : "重新检测"}
          </button>
        </div>
      </div>

      <div className="tools-section">
        <h4 className="tools-section-title">派单默认</h4>
        <div className="tools-card">
          <ExecutorPicker
            label="默认执行器"
            value={settings.defaultExecutorId}
            executors={executors}
            includeAuto
            onChange={(id) => onChange({ ...settings, defaultExecutorId: id })}
          />
          <div className="mech-switch">
            <span>创建后自动执行</span>
            <input
              type="checkbox"
              checked={settings.autoExecute}
              onChange={(e) => onChange({ ...settings, autoExecute: e.target.checked })}
            />
          </div>
          <div className="mech-switch">
            <span>依赖完成后自动启动子任务</span>
            <input
              type="checkbox"
              checked={settings.autoStartDependents}
              onChange={(e) =>
                onChange({ ...settings, autoStartDependents: e.target.checked })
              }
            />
          </div>
          <div className="mech-switch">
            <span>验收失败自动返工</span>
            <input
              type="checkbox"
              checked={settings.autoRework}
              onChange={(e) => onChange({ ...settings, autoRework: e.target.checked })}
            />
          </div>
          <div className="mech-switch">
            <span>ACP 默认无人值守（跳过权限确认）</span>
            <input
              type="checkbox"
              checked={settings.executors.acp?.defaultSkipPermissions ?? false}
              onChange={(e) =>
                onChange({
                  ...settings,
                  executors: {
                    ...settings.executors,
                    pi: settings.executors.pi,
                    acp: {
                      ...settings.executors.acp,
                      defaultSkipPermissions: e.target.checked,
                    },
                  },
                })
              }
            />
          </div>
          <p className="settings-hint">
            无人值守仅建议在本机桌面模式开启；与「写前确认」互斥，派单时选 unattended。
          </p>
          <div className="mech-switch">
            <span>Pi 沙箱配置（仅记录，尚未隔离执行）</span>
            <input
              type="checkbox"
              checked={settings.executors.pi?.sandbox?.enabled ?? false}
              onChange={(e) =>
                onChange({
                  ...settings,
                  executors: {
                    ...settings.executors,
                    pi: {
                      ...settings.executors.pi,
                      sandbox: {
                        type: settings.executors.pi?.sandbox?.type ?? "docker",
                        enabled: e.target.checked,
                        image: settings.executors.pi?.sandbox?.image,
                        allowedPaths: settings.executors.pi?.sandbox?.allowedPaths,
                      },
                    },
                  },
                })
              }
            />
          </div>
        </div>
      </div>

      <div className="tools-section">
        <h4 className="tools-section-title">内嵌 Pi</h4>
        <p className="settings-hint">系统内置，不可删除。执行参数在此配置。</p>
        {piCli ? <CliCard cli={piCli} /> : <p className="settings-hint">Pi 执行器未注册。</p>}
        <div className="tools-card tools-pi-settings">
          <label className="field-label">单次运行超时（分钟）</label>
          <input
            type="number"
            className="field-input settings-field-narrow"
            min={1}
            max={60}
            value={Math.round((settings.executors.pi.runTimeoutMs ?? 600_000) / 60_000)}
            onChange={(e) => {
              const minutes = Math.max(1, Math.min(60, Number(e.target.value) || 10));
              onChange({
                ...settings,
                executors: {
                  ...settings.executors,
                  pi: { ...settings.executors.pi, runTimeoutMs: minutes * 60_000 },
                },
              });
            }}
          />
          <label className="field-label">单轮工具调用上限（次）</label>
          <input
            type="number"
            className="field-input settings-field-narrow"
            min={1}
            max={100}
            value={settings.executors.pi.maxToolCalls ?? DEFAULT_PI_MAX_TOOL_CALLS}
            onChange={(e) => {
              const n = Math.max(
                1,
                Math.min(100, Number(e.target.value) || DEFAULT_PI_MAX_TOOL_CALLS),
              );
              onChange({
                ...settings,
                executors: {
                  ...settings.executors,
                  pi: { ...settings.executors.pi, maxToolCalls: n },
                },
              });
            }}
          />
          <p className="settings-hint settings-hint-tight">
            单目标内 Pi 最多调用工具的次数，超出后自动中止（默认 {DEFAULT_PI_MAX_TOOL_CALLS}
            ）。接入 Connect Agent 等复杂任务可适当调高。
          </p>
        </div>
      </div>

      <div className="tools-section">
        <h4 className="tools-section-title">ACP CLI</h4>
        <p className="settings-hint">系统预置 ACP 运行时；未安装时可创建接入任务。</p>
        <div className="tools-cli-grid">
          {acpClis.map((cli) => (
            <CliCard
              key={cli.id}
              cli={cli}
              onOpenConfig={
                hasAcpCliConfigTool(cli.id)
                  ? () => setConfigExecutorId(cli.id)
                  : undefined
              }
            />
          ))}
        </div>
      </div>

      <div className="tools-section">
        <h4 className="tools-section-title">Connect / 自定义 Agent</h4>
        <div className="tools-cli-grid">
          {connectClis.length === 0 ? (
            <p className="settings-hint">暂无 Connect Agent。创建接入任务完成后将显示在此处。</p>
          ) : (
            connectClis.map((cli) => (
              <CliCard
                key={cli.id}
                cli={cli}
                onDelete={
                  cli.deletable
                    ? () => {
                        if (window.confirm(`确定删除 CLI「${cli.label}」？`)) {
                          void onDeleteProfile(cli.id);
                        }
                      }
                    : undefined
                }
                onBootstrap={
                  cli.canBootstrap
                    ? () => void onBootstrap(cli.id)
                    : undefined
                }
                onDisconnect={
                  cli.available
                    ? () => void onDisconnect(cli.id)
                    : undefined
                }
                onCopyCommand={
                  cli.profile
                    ? () => void copyBootstrap(cli.id)
                    : undefined
                }
                bootstrapStatus={bootstrapStatuses.get(cli.id)}
              />
            ))
          )}
        </div>
      </div>

      <AddCliDialog
        open={showAdd}
        autoExecute={settings.autoExecute}
        onClose={() => setShowAdd(false)}
        existingIds={existingIds}
        onCreated={onIntegrationGoalCreated}
        onSettingsChange={onChange}
        onConnectReady={onConnectReady}
        autoBootstrapConnect={settings.autoBootstrapConnect ?? true}
      />

      <AcpCliConfigDialog
        executorId={configExecutorId}
        settings={settings}
        onClose={() => setConfigExecutorId(null)}
        onSaved={(next) => {
          onChange(next);
          void onRefresh();
        }}
      />
    </>
  );
}
