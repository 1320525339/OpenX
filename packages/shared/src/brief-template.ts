import { z } from "zod";
import type { LlmContextSettings } from "./llm-context-config.js";

/** Brief 模板中的一个可编辑区块 */
export const BriefTemplateSectionSchema = z.object({
  id: z.string().min(1),
  /** 区块标题，如「【用户期望】」 */
  label: z.string().min(1),
  /** 填写提示（注入 prompt 与 UI） */
  hint: z.string().optional(),
  /** bug/异常类是否必填 */
  requiredForBug: z.boolean().default(false),
  enabled: z.boolean().default(true),
});
export type BriefTemplateSection = z.infer<typeof BriefTemplateSectionSchema>;

export const DEFAULT_BRIEF_TEMPLATE_SECTIONS: BriefTemplateSection[] = [
  {
    id: "issueType",
    label: "【问题类型】",
    hint: "bug / 表现异常 / 新功能 / 优化 / 只读侦察",
    requiredForBug: true,
    enabled: true,
  },
  {
    id: "userExpectation",
    label: "【用户期望】",
    hint: "用户认为应该怎样",
    requiredForBug: true,
    enabled: true,
  },
  {
    id: "actualPhenomenon",
    label: "【实际现象】",
    hint: "当前看到什么、报错、异常行为",
    requiredForBug: true,
    enabled: true,
  },
  {
    id: "knownFacts",
    label: "【已知事实】",
    hint: "仅对话/上下文已确认的信息，不臆造",
    requiredForBug: true,
    enabled: true,
  },
  {
    id: "toVerify",
    label: "【待核实项】",
    hint: "工人需调查的具体问题，逐条列出",
    requiredForBug: true,
    enabled: true,
  },
  {
    id: "investigationEntry",
    label: "【调查入口】",
    hint: "关键词、文件/组件/路由/API、报错片段",
    requiredForBug: true,
    enabled: true,
  },
  {
    id: "pathComparison",
    label: "【正常路径 vs 异常路径】",
    hint: "从哪一步开始偏离（若适用）",
    requiredForBug: false,
    enabled: true,
  },
  {
    id: "scopeBoundary",
    label: "【范围与边界】",
    hint: "改什么、不改什么、非目标",
    requiredForBug: true,
    enabled: true,
  },
  {
    id: "steps",
    label: "【执行步骤】",
    hint: "具体可执行步骤",
    requiredForBug: false,
    enabled: true,
  },
  {
    id: "acceptanceCriteria",
    label: "【验收标准】",
    hint: "可验证的完成标准",
    requiredForBug: false,
    enabled: true,
  },
  {
    id: "constraints",
    label: "【约束】",
    hint: "禁止事项、范围限制",
    requiredForBug: false,
    enabled: true,
  },
];

export function resolveBriefTemplateSections(
  settings?: Partial<LlmContextSettings> | null,
): BriefTemplateSection[] {
  const custom = settings?.briefTemplate?.sections;
  if (!custom?.length) return DEFAULT_BRIEF_TEMPLATE_SECTIONS;
  return custom.map((s) => BriefTemplateSectionSchema.parse(s));
}

/** 注入 system prompt 的 brief 模板块 */
export function formatBriefTemplateBlock(
  sections: BriefTemplateSection[] = DEFAULT_BRIEF_TEMPLATE_SECTIONS,
): string {
  const enabled = sections.filter((s) => s.enabled !== false);
  const lines = enabled.map((s) => {
    const hint = s.hint?.trim();
    const req = s.requiredForBug ? "（bug/异常类必填）" : "";
    return hint
      ? `${s.label}${req}\n  ${hint}`
      : `${s.label}${req}…`;
  });
  return lines.join("\n");
}

/** 按模板组装 executionPrompt 正文 */
export function buildBriefExecutionPrompt(
  sections: BriefTemplateSection[],
  values: Record<string, string | undefined>,
  footer?: string,
): string {
  const parts: string[] = [];
  for (const section of sections) {
    if (section.enabled === false) continue;
    const val = values[section.id]?.trim();
    parts.push(`${section.label}\n${val || section.hint || "（待填写）"}`);
  }
  if (footer?.trim()) parts.push(footer.trim());
  return parts.join("\n\n");
}

export function mergeBriefTemplateSections(
  global?: BriefTemplateSection[],
  project?: BriefTemplateSection[],
): BriefTemplateSection[] {
  if (!project?.length) {
    return global?.length ? global.map((s) => ({ ...s })) : DEFAULT_BRIEF_TEMPLATE_SECTIONS;
  }
  const base = global?.length ? global : DEFAULT_BRIEF_TEMPLATE_SECTIONS;
  const byId = new Map(base.map((s) => [s.id, { ...s }]));
  for (const s of project) {
    byId.set(s.id, BriefTemplateSectionSchema.parse(s));
  }
  const order = base.map((s) => s.id);
  for (const s of project) {
    if (!order.includes(s.id)) order.push(s.id);
  }
  return order.map((id) => byId.get(id)!);
}
