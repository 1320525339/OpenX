import { useEffect, useMemo, useState } from "react";

import type { Project } from "@openx/shared";
import {
  DEFAULT_BRIEF_TEMPLATE_SECTIONS,
  mergeBriefTemplateSections,
  resolveBriefTemplateSections,
} from "@openx/shared";

import { api } from "../api";
import { useAppState } from "../lib/app-state";

import {
  BriefTemplateSectionBlock,
  cloneBriefTemplateSections,
} from "./BriefTemplateSectionBlock";

type Props = {
  project: Project;
};

export function ProjectBriefTemplatePanel({ project }: Props) {
  const { state, dispatch } = useAppState();
  const globalSections = resolveBriefTemplateSections(state.settings?.llmContext);

  const hasStoredOverride = Boolean(
    project.llmContext?.briefTemplate?.sections?.length,
  );

  const [overrideEnabled, setOverrideEnabled] = useState(hasStoredOverride);
  const [sections, setSections] = useState(() =>
    hasStoredOverride
      ? cloneBriefTemplateSections(project.llmContext!.briefTemplate!.sections!)
      : cloneBriefTemplateSections(globalSections),
  );
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = Boolean(project.llmContext?.briefTemplate?.sections?.length);
    const global = resolveBriefTemplateSections(state.settings?.llmContext);
    setOverrideEnabled(stored);
    setSections(
      stored
        ? cloneBriefTemplateSections(project.llmContext!.briefTemplate!.sections!)
        : cloneBriefTemplateSections(global),
    );
  }, [
    project.id,
    project.llmContext,
    state.settings?.llmContext?.briefTemplate,
  ]);

  const dirty = useMemo(() => {
    if (!overrideEnabled && !hasStoredOverride) return false;
    if (overrideEnabled !== hasStoredOverride) return true;
    if (!overrideEnabled) return false;
    const baseline = mergeBriefTemplateSections(
      globalSections,
      project.llmContext?.briefTemplate?.sections,
    );
    return JSON.stringify(sections) !== JSON.stringify(baseline);
  }, [
    overrideEnabled,
    hasStoredOverride,
    sections,
    globalSections,
    project.llmContext?.briefTemplate?.sections,
  ]);

  const enableOverride = () => {
    setOverrideEnabled(true);
    setSections(cloneBriefTemplateSections(globalSections));
  };

  const disableOverride = () => {
    setOverrideEnabled(false);
    setSections(cloneBriefTemplateSections(globalSections));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const nextLlmContext = { ...project.llmContext };
      if (overrideEnabled) {
        nextLlmContext.briefTemplate = { sections };
      } else {
        delete nextLlmContext.briefTemplate;
      }
      const res = await api.patchProject(project.id, {
        llmContext: nextLlmContext,
      });
      dispatch({ type: "upsert_project", project: res.project });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="project-section project-brief-template">
      <div className="project-section-head">
        <h3>项目 Brief 模板</h3>
        <div className="project-brief-template-actions">
          {savedFlash ? (
            <span className="settings-saved">已保存</span>
          ) : dirty ? (
            <span className="settings-dirty">有未保存更改</span>
          ) : null}
          <button
            type="button"
            className="btn compact primary"
            disabled={saving || !dirty}
            onClick={() => void save()}
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>

      <p className="settings-hint settings-hint-tight">
        为本项目覆盖全局 Brief 模板。仅影响该项目下对话的工头派单结构；未启用时继承「设置 →
        工头 Brief 模板」。
      </p>

      <label className="brief-template-override-toggle">
        <input
          type="checkbox"
          checked={overrideEnabled}
          onChange={(e) => (e.target.checked ? enableOverride() : disableOverride())}
        />
        <span>启用项目级 Brief 模板覆盖</span>
      </label>

      {overrideEnabled ? (
        <BriefTemplateSectionBlock
          title="项目 Brief 区块"
          description="保存后将按 id 与全局模板合并；同名区块以项目配置为准。"
          sections={sections}
          onChange={setSections}
          inheritedSections={globalSections}
          inheritedLabel="当前全局模板"
          onResetDefaults={() =>
            setSections(cloneBriefTemplateSections(DEFAULT_BRIEF_TEMPLATE_SECTIONS))
          }
        />
      ) : (
        <details className="brief-template-inherited">
          <summary>查看继承的全局模板</summary>
          <pre className="brief-template-inherited-pre">
            {globalSections
              .filter((s) => s.enabled !== false)
              .map((s) => `${s.label} ${s.hint ? `— ${s.hint}` : ""}`)
              .join("\n")}
          </pre>
        </details>
      )}

      {error ? <p className="settings-hint settings-hint-warn">{error}</p> : null}
    </section>
  );
}
