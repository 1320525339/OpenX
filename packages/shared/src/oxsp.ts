/**
 * OpenX Slot Protocol (OXSP) v1
 * 拓展槽万能视窗：按 kind + config 渲染，LLM 经 REST/MCP 操控
 */
import { z } from "zod";

export const OXSP_PROTOCOL_VERSION = "1";

export const PinDesktopScopeSchema = z.enum(["console", "conversation"]);
export type PinDesktopScope = z.infer<typeof PinDesktopScopeSchema>;

export const OxspSlotKindSchema = z.enum(["web", "markdown", "browser", "react"]);
export type OxspSlotKind = z.infer<typeof OxspSlotKindSchema>;

export const OxspWebConfigSchema = z.object({
  kind: z.literal("web"),
  url: z.string().min(1),
});

export const OxspMarkdownConfigSchema = z.object({
  kind: z.literal("markdown"),
  body: z.string().default(""),
});

export const OxspBrowserConfigSchema = z.object({
  kind: z.literal("browser"),
  startUrl: z.string().optional(),
  sessionId: z.string().optional(),
});

export type OxspReactComponentId = "chat" | "tasks" | "detail" | "evidence";

export const OxspReactComponentIdSchema = z.preprocess(
  (value) => (value === "kanban" ? "tasks" : value),
  z.enum(["chat", "tasks", "detail", "evidence"]),
) as z.ZodType<OxspReactComponentId>;

export function resolveOxspReactComponentId(componentId: string): OxspReactComponentId {
  if (componentId === "kanban") return "tasks";
  if (
    componentId === "chat" ||
    componentId === "tasks" ||
    componentId === "detail" ||
    componentId === "evidence"
  ) {
    return componentId;
  }
  return "chat";
}

export const OxspReactConfigSchema = z.object({
  kind: z.literal("react"),
  componentId: OxspReactComponentIdSchema,
});

export const OxspSlotConfigSchema = z.discriminatedUnion("kind", [
  OxspWebConfigSchema,
  OxspMarkdownConfigSchema,
  OxspBrowserConfigSchema,
  OxspReactConfigSchema,
]);
export type OxspSlotConfig = z.infer<typeof OxspSlotConfigSchema>;

export const OxspSlotInstanceSchema = z.object({
  id: z.string().min(1),
  kind: OxspSlotKindSchema,
  title: z.string().optional(),
  config: OxspSlotConfigSchema,
  state: z.record(z.unknown()).optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type OxspSlotInstance = z.infer<typeof OxspSlotInstanceSchema>;

export const OxspSlotCatalogSchema = z.object({
  slots: z.array(OxspSlotInstanceSchema),
});
export type OxspSlotCatalog = z.infer<typeof OxspSlotCatalogSchema>;

export type OxspDockTemplate = {
  id: string;
  label: string;
  icon: string;
  kind: OxspSlotKind;
  defaultConfig: OxspSlotConfig;
  /** 内置 react 面板，对应 PinDockWidgetId */
  builtin?: boolean;
};

/** 开发环境下浏览器槽可加载的打砖块示例页 */
export const OXSP_DEMO_BROWSER_URL = "/demo/crew-game/";

/** @deprecated 使用 OXSP_DEMO_BROWSER_URL */
export const OXSP_DEMO_WEB_URL = OXSP_DEMO_BROWSER_URL;

export const OXSP_DOCK_TEMPLATES: OxspDockTemplate[] = [
  {
    id: "chat",
    label: "对话",
    icon: "💬",
    kind: "react",
    defaultConfig: { kind: "react", componentId: "chat" },
    builtin: true,
  },
  {
    id: "tasks",
    label: "任务台",
    icon: "📋",
    kind: "react",
    defaultConfig: { kind: "react", componentId: "tasks" },
    builtin: true,
  },
  {
    id: "detail",
    label: "任务详情",
    icon: "📄",
    kind: "react",
    defaultConfig: { kind: "react", componentId: "detail" },
    builtin: true,
  },
  {
    id: "evidence",
    label: "交付证据",
    icon: "📦",
    kind: "react",
    defaultConfig: { kind: "react", componentId: "evidence" },
    builtin: true,
  },
  {
    id: "browser",
    label: "浏览器",
    icon: "🌐",
    kind: "browser",
    defaultConfig: { kind: "browser" },
  },
  {
    id: "demo-game",
    label: "打砖块 Demo",
    icon: "🕹️",
    kind: "browser",
    defaultConfig: { kind: "browser", startUrl: OXSP_DEMO_BROWSER_URL },
  },
  {
    id: "genshin-web",
    label: "原神",
    icon: "🎮",
    kind: "browser",
    defaultConfig: { kind: "browser", startUrl: "https://ys.mihoyo.com/main/" },
  },
];

/** 底栏「新增 / 拓展槽」可选模板（不含内置 react、不含已废弃 web/markdown） */
export function dockExtensionTemplates(): OxspDockTemplate[] {
  return OXSP_DOCK_TEMPLATES.filter(
    (t) => !t.builtin && t.kind !== "web" && t.kind !== "markdown" && t.id !== "web",
  );
}

export const OXSP_EXTENSION_TEMPLATES = dockExtensionTemplates();

export function emptyOxspCatalog(): OxspSlotCatalog {
  return { slots: [] };
}

export function newOxspSlotId(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export type OxspExtWidgetId = `ext:${string}`;
export type OxspLegacyWebWidgetId = `web:${string}`;

export function extWidgetId(slotId: string): OxspExtWidgetId {
  return `ext:${slotId}`;
}

export function legacyWebWidgetId(cardId: string): OxspLegacyWebWidgetId {
  return `web:${cardId}`;
}

export function isExtWidgetId(id: string): id is OxspExtWidgetId {
  return id.startsWith("ext:") && id.length > 4;
}

export function isLegacyWebWidgetId(id: string): id is OxspLegacyWebWidgetId {
  return id.startsWith("web:") && id.length > 4;
}

export function extSlotIdFromWidget(id: OxspExtWidgetId): string {
  return id.slice(4);
}

export function legacyWebIdFromWidget(id: OxspLegacyWebWidgetId): string {
  return id.slice(4);
}

/** 将用户输入规范为可在 web/browser 中加载的 URL */
export function normalizeOxspUrl(
  input: string,
  baseHref = "http://127.0.0.1:5173/",
): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^file:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;

  try {
    if (trimmed.startsWith("/")) {
      return new URL(trimmed, baseHref).href;
    }
    if (trimmed.startsWith("./") || trimmed.startsWith("../")) {
      return new URL(trimmed, baseHref).href;
    }
    if (!trimmed.includes("://") && /^[\w.-]+:\d+(\/|$)/i.test(trimmed)) {
      return `http://${trimmed}`;
    }
    if (!trimmed.includes("://") && /^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) {
      return `https://${trimmed}`;
    }
    return new URL(trimmed, baseHref).href;
  } catch {
    return null;
  }
}

export function findOxspSlot(catalog: OxspSlotCatalog, slotId: string): OxspSlotInstance | null {
  return catalog.slots.find((s) => s.id === slotId) ?? null;
}

export function oxspSlotLabel(slot: OxspSlotInstance | null | undefined): string {
  if (!slot) return "拓展槽";
  if (slot.title?.trim()) return slot.title.trim();
  if (slot.config.kind === "web") {
    try {
      return new URL(slot.config.url).hostname || slot.config.url;
    } catch {
      return slot.config.url;
    }
  }
  if (slot.config.kind === "browser") {
    return slot.config.startUrl?.trim() || "浏览器";
  }
  if (slot.config.kind === "markdown") return "已停用";
  const tpl = OXSP_DOCK_TEMPLATES.find((t) => t.defaultConfig.kind === slot.config.kind);
  return tpl?.label ?? "拓展槽";
}

export function oxspSlotIcon(slot: OxspSlotInstance | null | undefined): string {
  if (!slot) return "📌";
  const tpl = OXSP_DOCK_TEMPLATES.find((t) => t.defaultConfig.kind === slot.config.kind);
  return tpl?.icon ?? "📌";
}

export function addOxspSlot(
  catalog: OxspSlotCatalog,
  config: OxspSlotConfig,
  title?: string,
): { catalog: OxspSlotCatalog; slot: OxspSlotInstance; widgetId: OxspExtWidgetId } {
  const now = Date.now();
  const slot: OxspSlotInstance = {
    id: newOxspSlotId(),
    kind: config.kind,
    title,
    config,
    createdAt: now,
    updatedAt: now,
  };
  return {
    catalog: { slots: [...catalog.slots, slot] },
    slot,
    widgetId: extWidgetId(slot.id),
  };
}

export function removeOxspSlot(catalog: OxspSlotCatalog, slotId: string): OxspSlotCatalog {
  return { slots: catalog.slots.filter((s) => s.id !== slotId) };
}

export function updateOxspSlot(
  catalog: OxspSlotCatalog,
  slotId: string,
  patch: Partial<Pick<OxspSlotInstance, "title" | "config" | "state">>,
): OxspSlotCatalog {
  return {
    slots: catalog.slots.map((s) =>
      s.id === slotId ? { ...s, ...patch, updatedAt: Date.now() } : s,
    ),
  };
}

/** 从旧 PinExtensionCatalog 迁移 */
export function migrateLegacyWebCards(raw: unknown): OxspSlotCatalog {
  if (!raw || typeof raw !== "object") return emptyOxspCatalog();
  const data = raw as Record<string, unknown>;
  if (Array.isArray(data.cards)) {
    const slots: OxspSlotInstance[] = [];
    for (const entry of data.cards) {
      if (!entry || typeof entry !== "object") continue;
      const card = entry as { id?: string; url?: string; title?: string };
      if (typeof card.id !== "string" || typeof card.url !== "string") continue;
      const now = Date.now();
      slots.push({
        id: card.id,
        kind: "browser",
        title: card.title,
        config: { kind: "browser", startUrl: card.url },
        createdAt: now,
        updatedAt: now,
      });
    }
    return { slots };
  }
  return emptyOxspCatalog();
}

export const OxspSlotCreateBodySchema = z.object({
  kind: OxspSlotKindSchema,
  config: OxspSlotConfigSchema.optional(),
  title: z.string().optional(),
  pinCol: z.number().int().min(0).max(2).optional(),
  templateId: z.string().optional(),
});
export type OxspSlotCreateBody = z.infer<typeof OxspSlotCreateBodySchema>;

export const OxspSlotCommandBodySchema = z.object({
  action: z.enum([
    "pin",
    "unpin",
    "set_config",
    "set_title",
    "set_url",
    "navigate",
    "snapshot",
    "browser_click",
    "browser_type",
    "browser_screenshot",
    "browser_dom",
    "browser_network",
  ]),
  pinCol: z.number().int().min(0).max(2).optional(),
  config: OxspSlotConfigSchema.optional(),
  title: z.string().optional(),
  body: z.string().optional(),
  url: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  text: z.string().optional(),
});
export type OxspSlotCommandBody = z.infer<typeof OxspSlotCommandBodySchema>;

export type OxspSlotSnapshot = {
  slotId: string;
  kind: OxspSlotKind;
  title: string;
  config: OxspSlotConfig;
  pinned: boolean;
  widgetId: string | null;
  snapshotText: string;
};

export function resolveTemplateConfig(
  templateId: string,
  overrides?: Partial<OxspSlotConfig>,
): OxspSlotConfig | null {
  if (templateId === "web") {
    return {
      kind: "browser",
      startUrl: normalizeOxspUrl(OXSP_DEMO_BROWSER_URL) ?? OXSP_DEMO_BROWSER_URL,
    };
  }
  const tpl = OXSP_DOCK_TEMPLATES.find((t) => t.id === templateId);
  if (!tpl || tpl.kind === "web" || tpl.kind === "markdown") return null;
  if (!overrides) return tpl.defaultConfig;
  return { ...tpl.defaultConfig, ...overrides } as OxspSlotConfig;
}

export function buildDefaultConfigForKind(
  kind: OxspSlotKind,
  input?: { url?: string; body?: string; startUrl?: string },
): OxspSlotConfig {
  switch (kind) {
    case "web": {
      const url = normalizeOxspUrl(input?.url ?? OXSP_DEMO_BROWSER_URL) ?? OXSP_DEMO_BROWSER_URL;
      return { kind: "browser", startUrl: url };
    }
    case "markdown":
      return { kind: "markdown", body: input?.body ?? "" };
    case "browser": {
      const trimmed = input?.startUrl?.trim();
      if (!trimmed) return { kind: "browser" };
      return {
        kind: "browser",
        startUrl: normalizeOxspUrl(trimmed) ?? trimmed,
      };
    }
    case "react":
      return { kind: "react", componentId: "chat" };
    default:
      return { kind: "browser" };
  }
}
