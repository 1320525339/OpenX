import { useEffect, useState } from "react";

import type { Settings } from "@openx/shared";

import type { ExecutorInfo } from "../api";

import { ModelProviderSettings } from "./ModelProviderSettings";
import { WorkspacePicker } from "./WorkspacePicker";
import { ThemePreferenceControl } from "./ThemePreferenceControl";
import { useTheme } from "../lib/use-theme";



type Props = {

  settings: Settings | null;

  workspaceResolved?: string;

  executors: ExecutorInfo[];

  onSave: (s: Settings) => Promise<void>;

  onWorkspaceSave?: (path: string) => Promise<void>;

  onRefreshExecutors: () => Promise<void>;

  onReloadSettings: () => Promise<void>;

};



export function SettingsPanel({

  settings,

  workspaceResolved,

  executors: _executors,

  onSave,

  onWorkspaceSave,

  onRefreshExecutors: _onRefreshExecutors,

  onReloadSettings,

}: Props) {

  const [local, setLocal] = useState<Settings | null>(settings);

  const [saving, setSaving] = useState(false);

  const [savedFlash, setSavedFlash] = useState(false);
  const { preference: themePreference, setPreference: setThemePreference } = useTheme();



  useEffect(() => {

    setLocal(settings);

  }, [settings]);



  if (!local) {

    return (

      <section className="mech-panel">

        <div className="mech-panel-body">加载中…</div>

      </section>

    );

  }



  const dirty =

    settings && local

      ? JSON.stringify(local) !== JSON.stringify(settings)

      : false;



  const save = async () => {

    setSaving(true);

    try {

      await onSave(local);

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

            onChange={setLocal}

            onReload={onReloadSettings}

          />



          <section className="settings-section">

            <h4 className="settings-section-title">偏好</h4>

            <ThemePreferenceControl
              value={themePreference}
              onChange={setThemePreference}
            />

            <div className="mech-switch">

              <span>完成后通知</span>

              <input

                type="checkbox"

                checked={local.notifyOnComplete}

                onChange={(e) => setLocal({ ...local, notifyOnComplete: e.target.checked })}

              />

            </div>

            {onWorkspaceSave ? (

              <>

                <label className="field-label">系统工作目录</label>

                <WorkspacePicker

                  variant="settings"

                  value={settings?.systemWorkspaceRoot ?? local.systemWorkspaceRoot}

                  resolvedPath={workspaceResolved}

                  onSave={async (path) => {

                    setLocal({ ...local, systemWorkspaceRoot: path });

                    await onWorkspaceSave(path);

                  }}

                />

                <p className="settings-hint settings-hint-tight">

                  调度台、系统任务、Skills 与 MCP 均使用此目录；各项目任务仍以项目目录为准。

                </p>

              </>

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

