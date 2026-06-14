import {
  DEFAULT_BRIEF_TEMPLATE_SECTIONS,
  type BriefTemplateSection,
} from "@openx/shared";

export function cloneBriefTemplateSections(
  sections: BriefTemplateSection[],
): BriefTemplateSection[] {
  return sections.map((s) => ({ ...s }));
}

type Props = {
  sections: BriefTemplateSection[];
  onChange: (sections: BriefTemplateSection[]) => void;
  inheritedSections?: BriefTemplateSection[];
  inheritedLabel?: string;
  onResetDefaults?: () => void;
};

export function BriefTemplateEditor({
  sections,
  onChange,
  inheritedSections,
  inheritedLabel = "全局模板",
  onResetDefaults,
}: Props) {
  const patchSection = (index: number, patch: Partial<BriefTemplateSection>) => {
    const next = cloneBriefTemplateSections(sections);
    next[index] = { ...next[index]!, ...patch };
    onChange(next);
  };

  const moveSection = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= sections.length) return;
    const next = cloneBriefTemplateSections(sections);
    const tmp = next[index]!;
    next[index] = next[target]!;
    next[target] = tmp;
    onChange(next);
  };

  return (
    <>
      {inheritedSections?.length ? (
        <details className="brief-template-inherited">
          <summary>{inheritedLabel}（只读参考）</summary>
          <pre className="brief-template-inherited-pre">
            {inheritedSections
              .filter((s) => s.enabled !== false)
              .map((s) => s.label)
              .join("\n")}
          </pre>
        </details>
      ) : null}

      <div className="brief-template-list">
        {sections.map((section, index) => (
          <div
            key={`${section.id}-${index}`}
            className={`brief-template-row${section.enabled !== false ? "" : " is-disabled"}`}
          >
            <div className="brief-template-row-head">
              <label className="brief-template-check">
                <input
                  type="checkbox"
                  checked={section.enabled !== false}
                  onChange={(e) =>
                    patchSection(index, { enabled: e.target.checked })
                  }
                />
                <span>启用</span>
              </label>
              <label className="brief-template-check">
                <input
                  type="checkbox"
                  checked={section.requiredForBug}
                  onChange={(e) =>
                    patchSection(index, { requiredForBug: e.target.checked })
                  }
                />
                <span>bug 必填</span>
              </label>
              <div className="brief-template-move">
                <button
                  type="button"
                  className="btn ghost btn-xs"
                  disabled={index === 0}
                  onClick={() => moveSection(index, -1)}
                  aria-label="上移"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn ghost btn-xs"
                  disabled={index === sections.length - 1}
                  onClick={() => moveSection(index, 1)}
                  aria-label="下移"
                >
                  ↓
                </button>
              </div>
            </div>

            <label className="field-label">区块标题</label>
            <input
              className="field-input"
              value={section.label}
              onChange={(e) => patchSection(index, { label: e.target.value })}
              placeholder="【用户期望】"
            />

            <label className="field-label">填写提示</label>
            <input
              className="field-input"
              value={section.hint ?? ""}
              onChange={(e) =>
                patchSection(index, { hint: e.target.value || undefined })
              }
              placeholder="注入 prompt 的说明文字"
            />

            <p className="settings-hint settings-hint-tight brief-template-id">
              id: {section.id}
            </p>
          </div>
        ))}
      </div>

      {onResetDefaults ? (
        <div className="brief-template-actions">
          <button type="button" className="btn ghost" onClick={onResetDefaults}>
            恢复默认模板
          </button>
        </div>
      ) : null}
    </>
  );
}

export { DEFAULT_BRIEF_TEMPLATE_SECTIONS };
