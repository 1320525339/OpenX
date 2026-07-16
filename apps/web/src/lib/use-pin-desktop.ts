import { useCallback, useMemo, useState } from "react";
import { OXSP_DOCK_TEMPLATES, OXSP_EXTENSION_TEMPLATES, extWidgetId, oxspSlotIcon, oxspSlotLabel, type OxspSlotConfig, type OxspSlotKind } from "@openx/shared";
import {
  applySeamResizeCommit,
  type PinSeam,
  type SeamResizePreview,
} from "./pin-desktop-seam";
import {
  applyPinDropCommit,
  type PinDropZone,
} from "./pin-desktop-drop";
import {
  extensionSlotColumn,
  isDockWidgetId,
  setWidgetSpan as applyWidgetSpan,
  setPinWide,
  slotWidgetLabel,
  unpinWidget,
  slotIdFromWidget,
  resolveBuiltinDockWidget,
  type PinDesktopLayout,
  type PinDesktopScope,
  type PinDockWidgetId,
  type PinWidgetId,
} from "./pin-desktop";
import {
  addOxspSlot,
  addBrowserCardToCatalog,
  findOxspSlot,
  loadOxspCatalog,
  normalizeExtensionUrl,
  removeOxspSlot,
  saveOxspCatalog,
  type OxspSlotCatalog,
} from "./oxsp-catalog";
import {
  cycleActivePage,
  isWidgetPinnedInWorkspace,
  layoutAtPage,
  loadPinWorkspace,
  normalizeWorkspace,
  pageCount,
  pinSlotAtColumnInWorkspace,
  pinSlotInWorkspace,
  pinnedWidgetsInWorkspace,
  savePinWorkspace,
  setActivePage,
  togglePinInWorkspace,
  updateActivePageLayout,
  type PinDesktopWorkspace,
} from "./pin-desktop-workspace";
import { useOxspDesktopSync } from "./use-oxsp-desktop-sync";

export function usePinDesktop(scope: PinDesktopScope) {
  const [workspace, setWorkspaceState] = useState<PinDesktopWorkspace>(() =>
    loadPinWorkspace(scope),
  );
  const [slotCatalog, setSlotCatalog] = useState<OxspSlotCatalog>(() => loadOxspCatalog(scope));

  const layout = useMemo(() => layoutAtPage(workspace), [workspace]);
  const activePage = workspace.activePage;
  const pages = pageCount(workspace);
  const pinnedTotal = pinnedWidgetsInWorkspace(workspace).length;

  const extDockItems = useMemo(
    () =>
      slotCatalog.slots.map((slot) => ({
        id: extWidgetId(slot.id) as PinWidgetId,
        label: oxspSlotLabel(slot),
        icon: oxspSlotIcon(slot),
      })),
    [slotCatalog.slots],
  );

  const persist = useCallback(
    (next: PinDesktopWorkspace) => {
      setWorkspaceState(next);
      savePinWorkspace(scope, next);
    },
    [scope],
  );

  const persistCatalog = useCallback(
    (next: OxspSlotCatalog) => {
      setSlotCatalog(next);
      saveOxspCatalog(scope, next);
    },
    [scope],
  );

  const onRemoteSync = useCallback(
    (next: { workspace: PinDesktopWorkspace; catalog: OxspSlotCatalog }) => {
      setWorkspaceState(next.workspace);
      setSlotCatalog(next.catalog);
      savePinWorkspace(scope, next.workspace);
      saveOxspCatalog(scope, next.catalog);
    },
    [scope],
  );

  useOxspDesktopSync(scope, workspace, slotCatalog, onRemoteSync);

  const persistPage = useCallback(
    (pageLayout: PinDesktopLayout) => {
      setWorkspaceState((prev) => {
        const next = updateActivePageLayout(prev, pageLayout);
        savePinWorkspace(scope, next);
        return next;
      });
    },
    [scope],
  );

  const setPage = useCallback(
    (page: number) => {
      persist(setActivePage(workspace, page));
    },
    [persist, workspace],
  );

  const cyclePage = useCallback(
    (delta: 1 | -1) => {
      persist(cycleActivePage(workspace, delta));
    },
    [persist, workspace],
  );

  const togglePin = useCallback(
    (widget: PinWidgetId) => {
      persist(togglePinInWorkspace(workspace, widget));
    },
    [persist, workspace],
  );

  const unpin = useCallback(
    (widget: PinWidgetId) => {
      const pages = workspace.pages.map((page) => unpinWidget(page, widget));
      persist(normalizeWorkspace({ ...workspace, pages }));
    },
    [persist, workspace],
  );

  /** 永久删除扩展：从卡片库和所有页面中同时移除。 */
  const removeExtension = useCallback(
    (widget: PinWidgetId) => {
      const slotId = slotIdFromWidget(widget);
      if (!slotId) return;
      persistCatalog(removeOxspSlot(slotCatalog, slotId));
      const pages = workspace.pages.map((page) => unpinWidget(page, widget));
      persist(normalizeWorkspace({ ...workspace, pages }));
    },
    [persist, persistCatalog, slotCatalog, workspace],
  );

  const addDockCardAtCol = useCallback(
    (col: number, widget: PinDockWidgetId) => {
      if (isWidgetPinnedInWorkspace(workspace, widget)) return false;
      persist(pinSlotAtColumnInWorkspace(workspace, widget, col));
      return true;
    },
    [persist, workspace],
  );

  const pinExtWidget = useCallback(
    (col: number | null, widget: PinWidgetId, catalog: OxspSlotCatalog) => {
      const nextWorkspace =
        col != null
          ? pinSlotAtColumnInWorkspace(workspace, widget, col)
          : pinSlotInWorkspace(workspace, widget);
      if (!isWidgetPinnedInWorkspace(nextWorkspace, widget)) return false;
      persistCatalog(catalog);
      persist(nextWorkspace);
      return true;
    },
    [persist, persistCatalog, workspace],
  );

  const addSlotAtCol = useCallback(
    (col: number, config: OxspSlotConfig, title?: string) => {
      const { catalog, widgetId } = addOxspSlot(slotCatalog, config, title);
      return pinExtWidget(col, widgetId, catalog);
    },
    [pinExtWidget, slotCatalog],
  );

  const addBrowserCardAtCol = useCallback(
    (col: number, input: string) => {
      const url = normalizeExtensionUrl(input);
      if (!url) return false;
      const { catalog, widgetId } = addBrowserCardToCatalog(slotCatalog, url);
      return pinExtWidget(col, widgetId, catalog);
    },
    [pinExtWidget, slotCatalog],
  );

  const addSlotFromTemplate = useCallback(
    (col: number, templateId: string) => {
      const tpl = OXSP_DOCK_TEMPLATES.find((t) => t.id === templateId);
      if (!tpl) return false;
      if (tpl.builtin && tpl.defaultConfig.kind === "react") {
        return addDockCardAtCol(
          col,
          resolveBuiltinDockWidget(tpl.defaultConfig.componentId),
        );
      }
      return addSlotAtCol(col, tpl.defaultConfig, tpl.label);
    },
    [addDockCardAtCol, addSlotAtCol],
  );

  const addDockCardFromSlot = useCallback(
    (widget: PinDockWidgetId) => {
      if (isWidgetPinnedInWorkspace(workspace, widget)) return false;
      persist(pinSlotInWorkspace(workspace, widget));
      return true;
    },
    [persist, workspace],
  );

  const addBrowserCardFromSlot = useCallback(
    (input: string) => {
      const url = normalizeExtensionUrl(input);
      if (!url) return false;
      const { catalog, widgetId } = addBrowserCardToCatalog(slotCatalog, url);
      const col = extensionSlotColumn(layoutAtPage(workspace));
      return pinExtWidget(col, widgetId, catalog);
    },
    [pinExtWidget, slotCatalog, workspace],
  );

  const getSlotLabel = useCallback(
    (widget: PinWidgetId) => {
      const slotId = slotIdFromWidget(widget);
      if (slotId) {
        const slot = findOxspSlot(slotCatalog, slotId);
        return oxspSlotLabel(slot);
      }
      if (isDockWidgetId(widget)) return slotWidgetLabel(widget);
      return "卡片";
    },
    [slotCatalog],
  );

  const applyDrop = useCallback(
    (widget: PinWidgetId, toCol: number, zone: PinDropZone) => {
      persistPage(applyPinDropCommit({ layout, widget, toCol, zone, source: "canvas" }));
    },
    [persistPage, layout],
  );

  const placeAtDrop = useCallback(
    (widget: PinWidgetId, toCol: number, zone: PinDropZone) => {
      persistPage(applyPinDropCommit({ layout, widget, toCol, zone, source: "dock" }));
    },
    [persistPage, layout],
  );

  const setWide = useCallback(
    (col: number, wide: boolean) => {
      persistPage(setPinWide(layout, col, wide));
    },
    [persistPage, layout],
  );

  const setWidgetSpan = useCallback(
    (widget: PinWidgetId, span: 1 | 2 | 3) => {
      persistPage(applyWidgetSpan(layout, widget, span));
    },
    [persistPage, layout],
  );

  const commitSeamResize = useCallback(
    (seam: PinSeam, preview: SeamResizePreview) => {
      persistPage(applySeamResizeCommit(layout, seam, preview));
    },
    [persistPage, layout],
  );

  const registerSlotFromTemplate = useCallback(
    (templateId: string) => {
      if (templateId === "web") return false;
      const tpl = OXSP_EXTENSION_TEMPLATES.find((t) => t.id === templateId);
      if (!tpl) return false;
      const { catalog } = addOxspSlot(slotCatalog, tpl.defaultConfig, tpl.label);
      persistCatalog(catalog);
      return true;
    },
    [persistCatalog, slotCatalog],
  );

  const isPinned = useCallback(
    (widget: PinWidgetId) => isWidgetPinnedInWorkspace(workspace, widget),
    [workspace],
  );

  return {
    workspace,
    layout,
    slotCatalog,
    /** @deprecated 使用 slotCatalog */
    webCatalog: slotCatalog,
    activePage,
    pageCount: pages,
    pinnedCount: pinnedTotal,
    extDockItems,
    dockTemplates: OXSP_EXTENSION_TEMPLATES,
    setPage,
    cyclePage,
    isPinned,
    togglePin,
    unpin,
    removeExtension,
    addDockCardFromSlot,
    addBrowserCardFromSlot,
    addDockCardAtCol,
    addBrowserCardAtCol,
    addSlotAtCol,
    addSlotFromTemplate,
    registerSlotFromTemplate,
    getSlotLabel,
    applyDrop,
    placeAtDrop,
    setWide,
    setWidgetSpan,
    commitSeamResize,
  };
}

export type { OxspSlotKind, OxspSlotConfig };
