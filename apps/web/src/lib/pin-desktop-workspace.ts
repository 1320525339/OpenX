import {
  emptyPinLayout,
  getEmptyColumns,
  isWidgetPinned,
  loadPinLayout,
  normalizeLayout,
  pinSlotAtColumn,
  pinnedWidgets,
  savePinLayout,
  unpinWidget,
  type PinDesktopLayout,
  type PinDesktopScope,
  type PinWidgetId,
} from "./pin-desktop";

const WORKSPACE_STORAGE_KEY = "openx.pinDesktop.workspace";

export type PinDesktopWorkspace = {
  activePage: number;
  pages: PinDesktopLayout[];
};

function workspaceKey(scope: PinDesktopScope): string {
  return `${WORKSPACE_STORAGE_KEY}.${scope}`;
}

export function emptyPinWorkspace(): PinDesktopWorkspace {
  return { activePage: 0, pages: [emptyPinLayout()] };
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
      layoutSource.cols?.[0] ?? null,
      layoutSource.cols?.[1] ?? null,
      layoutSource.cols?.[2] ?? null,
    ],
    wide: [Boolean(layoutSource.wide?.[0]), Boolean(layoutSource.wide?.[1]), false],
    split: [
      Boolean(layoutSource.split?.[0]),
      Boolean(layoutSource.split?.[1]),
      Boolean(layoutSource.split?.[2]),
    ],
    splitBottom: [
      layoutSource.splitBottom?.[0] ?? null,
      layoutSource.splitBottom?.[1] ?? null,
      layoutSource.splitBottom?.[2] ?? null,
    ],
  });
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

export function pageCount(ws: PinDesktopWorkspace): number {
  return normalizeWorkspace(ws).pages.length;
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

export function isWidgetPinnedInWorkspace(
  ws: PinDesktopWorkspace,
  widget: PinWidgetId,
): boolean {
  return pinnedWidgetsInWorkspace(ws).includes(widget);
}

export function setActivePage(ws: PinDesktopWorkspace, page: number): PinDesktopWorkspace {
  const norm = normalizeWorkspace(ws);
  const count = norm.pages.length;
  if (count <= 0) return norm;
  const activePage = ((page % count) + count) % count;
  return { ...norm, activePage };
}

export function cycleActivePage(ws: PinDesktopWorkspace, delta: 1 | -1): PinDesktopWorkspace {
  return setActivePage(ws, ws.activePage + delta);
}

function firstEmptyColumnOnPage(layout: PinDesktopLayout): number | null {
  const empty = getEmptyColumns(normalizeLayout(layout));
  return empty[0] ?? null;
}

function pinWidgetOnPage(layout: PinDesktopLayout, widget: PinWidgetId): PinDesktopLayout | null {
  const norm = normalizeLayout(layout);
  if (isWidgetPinned(norm, widget)) return norm;
  const emptyCol = firstEmptyColumnOnPage(norm);
  if (emptyCol == null) return null;
  const cols = [...norm.cols] as PinDesktopLayout["cols"];
  cols[emptyCol] = widget;
  return normalizeLayout({ ...norm, cols });
}

/** 将槽位 Pin 到当前页指定列 */
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

/** 将槽位 Pin 到桌面（已存在则不变；当前页满则翻页） */
export function pinSlotInWorkspace(
  ws: PinDesktopWorkspace,
  slot: PinWidgetId,
): PinDesktopWorkspace {
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

/** 底栏 Pin：当前页 → 其它页 → 新建页并自动翻过去 */
export function togglePinInWorkspace(
  ws: PinDesktopWorkspace,
  widget: PinWidgetId,
): PinDesktopWorkspace {
  const norm = normalizeWorkspace(ws);

  if (isWidgetPinnedInWorkspace(norm, widget)) {
    const pages = norm.pages.map((layout) => unpinWidget(layout, widget));
    return normalizeWorkspace(trimPages({ ...norm, pages }));
  }

  const tryOrder = [
    norm.activePage,
    ...norm.pages.map((_, index) => index).filter((index) => index !== norm.activePage),
  ];

  for (const pageIndex of tryOrder) {
    const nextLayout = pinWidgetOnPage(norm.pages[pageIndex]!, widget);
    if (nextLayout) {
      const pages = [...norm.pages];
      pages[pageIndex] = nextLayout;
      return normalizeWorkspace({ activePage: pageIndex, pages });
    }
  }

  const newLayout = pinWidgetOnPage(emptyPinLayout(), widget);
  if (!newLayout) return norm;

  return normalizeWorkspace({
    activePage: norm.pages.length,
    pages: [...norm.pages, newLayout],
  });
}

export function updatePageLayout(
  ws: PinDesktopWorkspace,
  pageIndex: number,
  layout: PinDesktopLayout,
): PinDesktopWorkspace {
  const norm = normalizeWorkspace(ws);
  const pages = [...norm.pages];
  pages[pageIndex] = normalizeLayout(layout);
  return normalizeWorkspace({ ...norm, pages });
}

export function updateActivePageLayout(
  ws: PinDesktopWorkspace,
  layout: PinDesktopLayout,
): PinDesktopWorkspace {
  return updatePageLayout(ws, normalizeWorkspace(ws).activePage, layout);
}

export function loadPinWorkspace(scope: PinDesktopScope): PinDesktopWorkspace {
  try {
    const raw = localStorage.getItem(workspaceKey(scope));
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (
        parsed &&
        typeof parsed === "object" &&
        "pages" in parsed &&
        Array.isArray((parsed as PinDesktopWorkspace).pages)
      ) {
        const p = parsed as PinDesktopWorkspace;
        const pages = p.pages
          .map((page) => coerceLayout(page))
          .filter((page): page is PinDesktopLayout => page != null);
        if (pages.length > 0) {
          return normalizeWorkspace({
            activePage: Number(p.activePage) || 0,
            pages,
          });
        }
      }
    }
  } catch {
    /* fall through */
  }

  return normalizeWorkspace({
    activePage: 0,
    pages: [loadPinLayout(scope)],
  });
}

export function savePinWorkspace(scope: PinDesktopScope, ws: PinDesktopWorkspace): void {
  const norm = normalizeWorkspace(ws);
  try {
    localStorage.setItem(workspaceKey(scope), JSON.stringify(norm));
    savePinLayout(scope, norm.pages[0] ?? emptyPinLayout());
  } catch {
    /* ignore */
  }
}
