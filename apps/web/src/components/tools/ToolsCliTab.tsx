import { useState } from "react";
import type { Goal, Settings } from "@openx/shared";
import type { ExecutorInfo } from "../../api";
import { ExecutorPicker } from "../ExecutorPicker";
import { AddCliDialog } from "./AddCliDialog";
import { cliKindLabel, listManagedClis, type CliEntry } from "../../lib/tools-clis";

type Props = {
  settings: Settings;
  executors: ExecutorInfo[];
  detecting: boolean;
  onChange: (settings: Settings) => void;
  onRefresh: () => void;
  onIntegrationGoalCreated: (goal: Goal) => void;
  onDeleteProfile: (executorId: string) => Promise<void>;
  onBootstrap: (executorId: string) => Promise<{ command?: string }>;
  onDisconnect: (executorId: string) => Promise<void>;
};

function CliCard({
  cli,
  onDelete,
  onBootstrap,
  onDisconnect,
  onCopyCommand,
}: {
  cli: CliEntry;
  onDelete?: () => void;
  onBootstrap?: () => void;
  onDisconnect?: () => void;
  onCopyCommand?: () => void;
}) {
  return (
    <div className={`tools-cli-card${cli.available ? "" : " unavailable"}`}>
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
}: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const clis = listManagedClis(executors, settings.cliProfiles ?? []);
  const acpClis = clis.filter((c) => c.kind === "acp");
  const connectClis = clis.filter((c) => c.kind === "connect");
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
          通过「添加 CLI」创建 Pi 接入任务；安装与配置由 Pi 按教程完成，派单 ID 由系统自动处理。
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
        <h4 className="tools-section-title">全局</h4>
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
        </div>
      </div>

      <div className="tools-section">
        <h4 className="tools-section-title">内嵌 Pi</h4>
        <p className="settings-hint">系统内置，不可删除。</p>
        {piCli ? <CliCard cli={piCli} /> : <p className="settings-hint">Pi 执行器未注册。</p>}
      </div>

      <div className="tools-section">
        <h4 className="tools-section-title">ACP CLI</h4>
        <p className="settings-hint">系统预置 ACP 运行时；未安装时可创建接入任务。</p>
        <div className="tools-cli-grid">
          {acpClis.map((cli) => (
            <CliCard key={cli.id} cli={cli} />
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
      />
    </>
  );
}
