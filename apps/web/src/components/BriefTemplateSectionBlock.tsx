import {
  DEFAULT_BRIEF_TEMPLATE_SECTIONS,
  type BriefTemplateSection,
} from "@openx/shared";

import { BriefTemplateEditor, cloneBriefTemplateSections } from "./BriefTemplateEditor";

type Props = {
  sections: BriefTemplateSection[];
  onChange: (sections: BriefTemplateSection[]) => void;
  onResetDefaults?: () => void;
  inheritedSections?: BriefTemplateSection[];
  inheritedLabel?: string;
  title?: string;
  description?: string;
};

export function BriefTemplateSectionBlock({
  sections,
  onChange,
  onResetDefaults,
  inheritedSections,
  inheritedLabel,
  title = "工头 Brief 模板",
  description = "派单 executionPrompt 的区块结构。工头 prompt 与规则回退均使用此模板；bug 类会强制两阶段 subGoals（侦察 → 修复）。",
}: Props) {
  return (
    <section className="settings-section">
      <h4 className="settings-section-title">{title}</h4>
      <p className="settings-hint settings-hint-tight">{description}</p>
      <BriefTemplateEditor
        sections={sections}
        onChange={onChange}
        inheritedSections={inheritedSections}
        inheritedLabel={inheritedLabel}
        onResetDefaults={
          onResetDefaults ??
          (() => onChange(cloneBriefTemplateSections(DEFAULT_BRIEF_TEMPLATE_SECTIONS)))
        }
      />
    </section>
  );
}

export { cloneBriefTemplateSections } from "./BriefTemplateEditor";