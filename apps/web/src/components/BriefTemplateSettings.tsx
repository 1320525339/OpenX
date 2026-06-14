import type { Settings } from "@openx/shared";
import {
  DEFAULT_BRIEF_TEMPLATE_SECTIONS,
} from "@openx/shared";

import { BriefTemplateSectionBlock } from "./BriefTemplateSectionBlock";

type Props = {
  settings: Settings;
  onChange: (next: Settings) => void;
};

export function BriefTemplateSettings({ settings, onChange }: Props) {
  const sections =
    settings.llmContext?.briefTemplate?.sections ??
    DEFAULT_BRIEF_TEMPLATE_SECTIONS;

  return (
    <BriefTemplateSectionBlock
      sections={sections}
      onChange={(nextSections) => {
        onChange({
          ...settings,
          llmContext: {
            ...settings.llmContext,
            briefTemplate: { sections: nextSections },
          },
        });
      }}
    />
  );
}
