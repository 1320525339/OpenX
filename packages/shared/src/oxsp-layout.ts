/**
 * Pin 桌面布局纯函数（服务端 / LLM 与 Web 共用）
 */
import { z } from "zod";
import type { PinDesktopScope } from "./oxsp.js";
import { extWidgetId, isExtWidgetId, isLegacyWebWidgetId } from "./oxsp.js";

export type PinDockWidgetId = "chat" | "tasks" | "kanban" | "detail";
export type PinWebWidgetId = `web:${string}`;
export type PinExtWidgetId = `ext:${string}`;
export type PinWidgetId = PinDockWidgetId | PinWebWidgetId | PinExtWidgetId;

export const MAX_PIN_COLUMNS = 3;

export type PinColumnSlots<T> = [T, T, T];

export const PinDesktopLayoutSchema = z.object({
  cols: z.tuple([z.string().nullable(), z.string().nullable(), z.string().nullable()]),
  wide: z.tuple([z.boolean(), z.boolean(), z.boolean()]),
  split: z.tuple([z.boolean(), z.boolean(), z.boolean()]),
  splitBottom: z.tuple([z.string().nullable(), z.string().nullable(), z.string().nullable()]),
});

export type PinDesktopLayout = {
  cols: PinColumnSlots<PinWidgetId | null>;
  wide: PinColumnSlots<boolean>;
  split: PinColumnSlots<boolean>;
  splitBottom: PinColumnSlots<PinWidgetId | null>;
};

export const PinDesktopWorkspaceSchema = z.object({
  activePage: z.number().int().min(0),
  pages: z.array(PinDesktopLayoutSchema),
});

export type PinDesktopWorkspace = {
  activePage: number;
  pages: PinDesktopLayout[];
};

export const OxspDesktopStateSchema = z.object({
  revision: z.number().int().min(0),
  scope: z.enum(["console", "conversation"]),
  workspace: PinDesktopWorkspaceSchema,
});

export type OxspDesktopState = {
  revision: number;
  scope: PinDesktopScope;
  workspace: PinDesktopWorkspace;
};

const DOCK_WIDGET_SET = new Set<PinDockWidgetId>(["chat", "tasks", "kanban", "detail"]);

export function isWebWidgetId(id: PinWidgetId): id is PinWebWidgetId {
  return id.startsWith("web:");
}

export function isDockWidgetId(id: PinWidgetId): id is PinDockWidgetId {
  return !isWebWidgetId(id) && !isExtWidgetId(id);
}

export function webWidgetId(cardId: string): PinWebWidgetId {
  return `web:${cardId}`;
}

export function emptyPinLayout(): PinDesktopLayout {
  return {
    cols: [null, null, null],
    wide: [false, false, false],
    split: [false, false, false],
    splitBottom: [null, null, null],
  };
}

export function emptyPinWorkspace(): PinDesktopWorkspace {
  return { activePage: 0, pages: [emptyPinLayout()] };
}

function isValidSlotWidget(w: PinWidgetId | null | undefined): w is PinWidgetId {
  if (!w) return false;
  if (isWebWidgetId(w) || isExtWidgetId(w)) return w.length > 4;
  return DOCK_WIDGET_SET.has(w as PinDockWidgetId);
}

export function isColumnMerged(layout: PinDesktopLayout, col: number): boolean {
  if (col === 1 && layout.wide[0]) return true;
  if (col === 2 && layout.wide[1]) return true;
  return false;
}

export function normalizeLayout(layout: PinDesktopLayout): PinDesktopLayout {
  const cols: PinDesktopLayout["cols"] = [null, null, null];
  const wide: PinDesktopLayout["wide"] = [false, false, false];
  const split: PinDesktopLayout["split"] = [false, false, false];
  const splitBottom: PinDesktopLayout["splitBottom"] = [null, null, null];
  const seen = new Set<PinWidgetId>();

  const take = (w: PinWidgetId | null | undefined): PinWidgetId | null => {
    if (w && isValidSlotWidget(w) && !seen.has(w)) {
      seen.add(w);
      return w;
    }
    return null;
  };

  for (let i = 0; i < MAX_PIN_COLUMNS; i++) {
    cols[i] = take(layout.cols[i]);
    const bottom = layout.split?.[i] ? take(layout.splitBottom?.[i]) : null;
    if (cols[i] && bottom) {
      split[i] = true;
      splitBottom[i] = bottom;
    }
  }

  if (cols[0] && layout.wide[0]) wide[0] = true;
  if (cols[1] && layout.wide[1] && !wide[0]) wide[1] = true;

  if (wide[0]) {
    cols[1] = null;
    wide[1] = false;
    split[0] = false;
    splitBottom[0] = null;
    split[1] = false;
    splitBottom[1] = null;
  }
  if (wide[1]) {
    cols[2] = null;
    split[1] = false;
    splitBottom[1] = null;
    split[2] = false;
    splitBottom[2] = null;
  }

  for (let i = 0; i < MAX_PIN_COLUMNS; i++) {
    if (!cols[i]) {
      wide[i] = false;
      split[i] = false;
      splitBottom[i] = null;
    }
    if (wide[i]) {
      split[i] = false;
      splitBottom[i] = null;
    }
    if (split[i] && (!cols[i] || !splitBottom[i])) {
      split[i] = false;
      if (!cols[i] && splitBottom[i]) {
        cols[i] = splitBottom[i];
        splitBottom[i] = null;
      } else {
        splitBottom[i] = null;
      }
    }
  }

  return { cols, wide, split, splitBottom };
}

export function pinnedWidgets(layout: PinDesktopLayout): PinWidgetId[] {
  const norm = normalizeLayout(layout);
  const out: PinWidgetId[] = [];
  for (let col = 0; col < MAX_PIN_COLUMNS; col++) {
    if (norm.cols[col]) out.push(norm.cols[col]!);
    if (norm.split[col] && norm.splitBottom[col]) out.push(norm.splitBottom[col]!);
  }
  return out;
}

export function widgetColumn(layout: PinDesktopLayout, widget: PinWidgetId): number | null {
  const norm = normalizeLayout(layout);
  for (let col = 0; col < MAX_PIN_COLUMNS; col++) {
    if (norm.cols[col] === widget) return col;
    if (norm.split[col] && norm.splitBottom[col] === widget) return col;
  }
  return null;
}

export function isWidgetPinned(layout: PinDesktopLayout, widget: PinWidgetId): boolean {
  return widgetColumn(normalizeLayout(layout), widget) != null;
}

export function getEmptyColumns(layout: PinDesktopLayout): number[] {
  const norm = normalizeLayout(layout);
  const empty: number[] = [];
  for (let col = 0; col < MAX_PIN_COLUMNS; col++) {
    if (isColumnMerged(norm, col)) continue;
    if (norm.cols[col] === null) empty.push(col);
  }
  return empty;
}

export function extensionSlotColumn(layout: PinDesktopLayout): number | null {
  const norm = normalizeLayout(layout);
  const widgetCount = pinnedWidgets(norm).length;
  if (widgetCount >= MAX_PIN_COLUMNS) return null;

  let col = widgetCount;
  while (col < MAX_PIN_COLUMNS) {
    if (isColumnMerged(norm, col)) {
      col += 1;
      continue;
    }
    if (norm.cols[col] == null) return col;
    return null;
  }
  return null;
}

export function unpinWidget(layout: PinDesktopLayout, widget: PinWidgetId): PinDesktopLayout {
  if (!isWidgetPinned(layout, widget)) return layout;
  const norm = normalizeLayout(layout);
  const cols = [...norm.cols] as PinDesktopLayout["cols"];
  const splitBottom = [...norm.splitBottom] as PinDesktopLayout["splitBottom"];
  const split = [...norm.split] as PinDesktopLayout["split"];
  for (let col = 0; col < MAX_PIN_COLUMNS; col++) {
    if (cols[col] === widget) {
      if (split[col] && splitBottom[col]) {
        cols[col] = splitBottom[col];
        splitBottom[col] = null;
        split[col] = false;
      } else {
        cols[col] = null;
      }
      continue;
    }
    if (splitBottom[col] === widget) {
      splitBottom[col] = null;
      split[col] = false;
    }
  }
  return normalizeLayout({ ...norm, cols, split, splitBottom });
}

export function pinSlotAtColumn(
  layout: PinDesktopLayout,
  widget: PinWidgetId,
  toCol: number,
): PinDesktopLayout {
  if (toCol < 0 || toCol > 2) return layout;
  let norm = normalizeLayout(layout);
  if (isColumnMerged(norm, toCol)) return norm;

  const fromCol = widgetColumn(norm, widget);
  if (fromCol === toCol) return norm;

  if (fromCol != null) {
    norm = unpinWidget(norm, widget);
  }

  if (norm.cols[toCol] != null) return norm;

  const cols = [...norm.cols] as PinDesktopLayout["cols"];
  cols[toCol] = widget;
  return normalizeLayout({ ...norm, cols });
}

function pageHasPins(layout: PinDesktopLayout): boolean {
  return pinnedWidgets(layout).length > 0;
}

function trimPages(ws: PinDesktopWorkspace): PinDesktopWorkspace {
  let lastUsed = 0;
  for (let i = ws.pages.length - 1; i >= 0; i--) {
    if (pageHasPins(ws.pages[i]!)) {
      lastUsed = i;
      break;
    }
  }
  const pages = ws.pages.slice(0, lastUsed + 1);
  if (pages.length === 0) pages.push(emptyPinLayout());
  const activePage = Math.min(Math.max(0, ws.activePage), pages.length - 1);
  return { activePage, pages };
}

function coerceLayout(raw: unknown): PinDesktopLayout | null {
  if (!raw || typeof raw !== "object") return null;
  const page = raw as Record<string, unknown>;
  if (page.kind === "extension") return null;
  const layoutSource =
    page.kind === "desktop" && page.layout && typeof page.layout === "object"
      ? (page.layout as PinDesktopLayout)
      : (page as PinDesktopLayout);
  if (!("cols" in layoutSource)) return null;
  return normalizeLayout({
    cols: [
      (layoutSource.cols?.[0] as PinWidgetId | null) ?? null,
      (layoutSource.cols?.[1] as PinWidgetId | null) ?? null,
      (layoutSource.cols?.[2] as PinWidgetId | null) ?? null,
    ],
    wide: [Boolean(layoutSource.wide?.[0]), Boolean(layoutSource.wide?.[1]), false],
    split: [
      Boolean(layoutSource.split?.[0]),
      Boolean(layoutSource.split?.[1]),
      Boolean(layoutSource.split?.[2]),
    ],
    splitBottom: [
      (layoutSource.splitBottom?.[0] as PinWidgetId | null) ?? null,
      (layoutSource.splitBottom?.[1] as PinWidgetId | null) ?? null,
      (layoutSource.splitBottom?.[2] as PinWidgetId | null) ?? null,
    ],
  });
}

export function parsePinDesktopWorkspace(raw: unknown): PinDesktopWorkspace {
  return normalizeWorkspace(PinDesktopWorkspaceSchema.parse(raw) as PinDesktopWorkspace);
}

export function normalizeWorkspace(ws: PinDesktopWorkspace): PinDesktopWorkspace {
  const pages =
    ws.pages.length > 0
      ? ws.pages
          .map((page) => coerceLayout(page))
          .filter((page): page is PinDesktopLayout => page != null)
      : [emptyPinLayout()];
  const activePage = Math.min(Math.max(0, ws.activePage ?? 0), pages.length - 1);
  return trimPages({ activePage, pages });
}

export function layoutAtPage(ws: PinDesktopWorkspace, page = ws.activePage): PinDesktopLayout {
  const norm = normalizeWorkspace(ws);
  const index = Math.min(Math.max(0, page), norm.pages.length - 1);
  return norm.pages[index] ?? emptyPinLayout();
}

export function pinnedWidgetsInWorkspace(ws: PinDesktopWorkspace): PinWidgetId[] {
  const norm = normalizeWorkspace(ws);
  const out: PinWidgetId[] = [];
  for (const layout of norm.pages) {
    for (const widget of pinnedWidgets(layout)) {
      if (!out.includes(widget)) out.push(widget);
    }
  }
  return out;
}

export function isWidgetPinnedInWorkspace(ws: PinDesktopWorkspace, widget: PinWidgetId): boolean {
  return pinnedWidgetsInWorkspace(ws).includes(widget);
}

function pinWidgetOnPage(layout: PinDesktopLayout, widget: PinWidgetId): PinDesktopLayout | null {
  const norm = normalizeLayout(layout);
  if (isWidgetPinned(norm, widget)) return norm;
  const empty = getEmptyColumns(norm);
  const emptyCol = empty[0] ?? null;
  if (emptyCol == null) return null;
  const cols = [...norm.cols] as PinDesktopLayout["cols"];
  cols[emptyCol] = widget;
  return normalizeLayout({ ...norm, cols });
}

export function pinSlotAtColumnInWorkspace(
  ws: PinDesktopWorkspace,
  slot: PinWidgetId,
  col: number,
): PinDesktopWorkspace {
  const norm = normalizeWorkspace(ws);
  const pageIndex = norm.activePage;
  const page = norm.pages[pageIndex] ?? emptyPinLayout();
  const nextLayout = pinSlotAtColumn(page, slot, col);
  if (!isWidgetPinned(nextLayout, slot)) return norm;
  const pages = [...norm.pages];
  pages[pageIndex] = nextLayout;
  return normalizeWorkspace({ ...norm, pages });
}

export function pinSlotInWorkspace(ws: PinDesktopWorkspace, slot: PinWidgetId): PinDesktopWorkspace {
  if (isWidgetPinnedInWorkspace(ws, slot)) return normalizeWorkspace(ws);

  const norm = normalizeWorkspace(ws);
  const tryOrder = [
    norm.activePage,
    ...norm.pages.map((_, index) => index).filter((index) => index !== norm.activePage),
  ];

  for (const pageIndex of tryOrder) {
    const nextLayout = pinWidgetOnPage(norm.pages[pageIndex]!, slot);
    if (nextLayout) {
      const pages = [...norm.pages];
      pages[pageIndex] = nextLayout;
      return normalizeWorkspace({ activePage: pageIndex, pages });
    }
  }

  const newLayout = pinWidgetOnPage(emptyPinLayout(), slot);
  if (!newLayout) return norm;

  return normalizeWorkspace({
    activePage: norm.pages.length,
    pages: [...norm.pages, newLayout],
  });
}

export function widgetIdForSlotId(slotId: string, legacy = false): PinWidgetId {
  return legacy ? webWidgetId(slotId) : extWidgetId(slotId);
}

export function slotIdFromWidgetId(widget: PinWidgetId): string | null {
  if (isExtWidgetId(widget)) return widget.slice(4);
  if (isLegacyWebWidgetId(widget)) return widget.slice(4);
  return null;
}
