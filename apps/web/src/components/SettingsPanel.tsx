import { useEffect, useRef, useState } from "react";

import type { Settings } from "@openx/shared";
import { OPERATOR_TIER_LABELS, OperatorTierSchema } from "@openx/shared";

import type { ExecutorInfo, SettingsResponse } from "../api";
import { settingsDraftDirty } from "../lib/settings-draft";

import { ModelProviderSettings } from "./ModelProviderSettings";
import { BriefTemplateSettings } from "./BriefTemplateSettings";
import { WorkspacePicker } from "./WorkspacePicker";
import { ThemePreferenceControl } from "./ThemePreferenceControl";
import { DesktopSettingsSection } from "./DesktopSettingsSection";
import { useTheme } from "../lib/use-theme";
import { useThemeRippleContext } from "../lib/theme-ripple-context";



type Props = {

  settings: Settings | null;

  workspaceResolved?: string;

  executors: ExecutorInfo[];

  onSave: (s: Settings) => Promise<SettingsResponse>;

  onRefreshExecutors: () => Promise<void>;

  onReloadSettings: () => Promise<void>;

};



export function SettingsPanel({

  settings,

  workspaceResolved,

  executors: _executors,

  onSave,

  onRefreshExecutors: _onRefreshExecutors,

  onReloadSettings,

}: Props) {

  const [local, setLocal] = useState<Settings | null>(settings);

  const [saving, setSaving] = useState(false);

  const [savedFlash, setSavedFlash] = useState(false);
  const dirtyRef = useRef(false);
  const { preference: themePreference, setPreference: setThemePreference } = useTheme();
  const themeRipple = useThemeRippleContext();

  const dirty = settingsDraftDirty(settings, local);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    if (!settings || dirtyRef.current) return;
    setLocal(settings);
  }, [settings]);

  if (!local) {

    return (

      <section className="mech-panel">

        <div className="mech-panel-body">加载中…</div>

      </section>

    );

  }



  const save = async () => {
    setSaving(true);
    try {
      const saved = await onSave(local);
      dirtyRef.current = false;
      setLocal(saved);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
    } finally {
      setSaving(false);
    }
  };



  return (

    <section className="mech-panel">

      <div className="mech-panel-body panel-stack">

        <div className="panel-scroll">

          <ModelProviderSettings

            settings={local}

            onChange={(next) => {
              dirtyRef.current = true;
              setLocal(next);
            }}

            onReload={onReloadSettings}

          />



          <section className="settings-section">

            <h4 className="settings-section-title">偏好</h4>

            <ThemePreferenceControl
              value={themeRipple?.preference ?? themePreference}
              onChange={setThemePreference}
              onChangeWithRipple={themeRipple?.changeWithRipple}
            />

            <DesktopSettingsSection />

            <div className="mech-switch">

              <span>完成后通知</span>

              <input

                type="checkbox"

                checked={local.notifyOnComplete}

                onChange={(e) => {
                  dirtyRef.current = true;
                  setLocal((prev) =>
                    prev ? { ...prev, notifyOnComplete: e.target.checked } : prev,
                  );
                }}

              />

            </div>

            {workspaceResolved !== undefined ? (
              <>
                <label className="field-label">系统工作目录</label>
                <WorkspacePicker
                  variant="settings"
                  value={settings?.systemWorkspaceRoot ?? local.systemWorkspaceRoot}
                  resolvedPath={workspaceResolved}
                  onSave={async (path) => {
                    const next = { ...local, systemWorkspaceRoot: path };
                    dirtyRef.current = true;
                    setLocal(next);
                    const saved = await onSave(next);
                    dirtyRef.current = false;
                    setLocal(saved);
                    setSavedFlash(true);
                    setTimeout(() => setSavedFlash(false), 2500);
                  }}
                />
                <p className="settings-hint settings-hint-tight">
                  调度台、系统任务、Skills 与 MCP 均使用此目录；各项目任务仍以项目目录为准。
                </p>
              </>
            ) : null}

          </section>

          <BriefTemplateSettings
            settings={local}
            onChange={(next) => {
              dirtyRef.current = true;
              setLocal(next);
            }}
          />

          <section className="settings-section">
            <h4 className="settings-section-title">施工队</h4>
            <p className="settings-hint settings-hint-tight">
              派单时工头自动推荐施工队。Pi 为工头班底；Codex / Claude / Gemini 为外部 CLI 施工队（在「工具」页检测在线状态）。
              模型与 API 密钥请在上方渠道配置。
            </p>
          </section>

          <section className="settings-section">
            <h4 className="settings-section-title">工头自控权限</h4>
            <p className="settings-hint settings-hint-tight">
              控制 Coach 是否可通过 Tool Calling 调用 OpenX API；admin 级敏感写操作仍需在对话中确认。
            </p>
            <div className="settings-operator-tiers">
              {OperatorTierSchema.options.map((tier) => {
                const meta = OPERATOR_TIER_LABELS[tier];
                return (
                  <label key={tier} className="settings-operator-tier">
                    <input
                      type="radio"
                      name="operatorTier"
                      value={tier}
                      checked={(local.operatorTier ?? "off") === tier}
                      onChange={() => {
                        dirtyRef.current = true;
                        setLocal((prev) => (prev ? { ...prev, operatorTier: tier } : prev));
                      }}
                    />
                    <span className="settings-operator-tier-label">{meta.label}</span>
                    <span className="settings-operator-tier-desc">{meta.description}</span>
                  </label>
                );
              })}
            </div>
            {(local.operatorTier ?? "off") === "admin" ? (
              <p className="settings-hint settings-hint-warn">
                admin 权限可修改模型、CLI、MCP 与全局设置，请仅在信任环境下启用。
              </p>
            ) : null}
          </section>

        </div>



        <div className="panel-footer settings-panel-footer">

          <span className="settings-footer-status" aria-live="polite">

            {savedFlash && <span className="settings-saved">已保存</span>}

            {!savedFlash && dirty && <span className="settings-dirty">有未保存的更改</span>}

          </span>

          <button

            type="button"

            className="btn primary"

            disabled={saving || !dirty}

            onClick={() => void save()}

          >

            {saving ? "保存中…" : "保存设置"}

          </button>

        </div>

      </div>

    </section>

  );

}

