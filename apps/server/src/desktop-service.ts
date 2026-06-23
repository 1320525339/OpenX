import {
  addOxspSlot,
  buildDefaultConfigForKind,
  extWidgetId,
  findOxspSlot,
  normalizeOxspUrl,
  oxspSlotLabel,
  OXSP_DOCK_TEMPLATES,
  dockExtensionTemplates,
  removeOxspSlot,
  resolveTemplateConfig,
  updateOxspSlot,
  type OxspSlotCatalog,
  type OxspSlotCommandBody,
  type OxspSlotCreateBody,
  type OxspSlotSnapshot,
  type PinDesktopScope,
} from "@openx/shared";
import {
  extensionSlotColumn,
  isWidgetPinnedInWorkspace,
  layoutAtPage,
  normalizeWorkspace,
  pinSlotAtColumnInWorkspace,
  pinSlotInWorkspace,
  pinnedWidgetsInWorkspace,
  slotIdFromWidgetId,
  unpinWidget,
  type PinDesktopWorkspace,
  type PinWidgetId,
} from "@openx/shared";
import { loadDesktopState, loadSlotCatalog, saveDesktopBundle } from "./desktop-store.js";
import {
  browserDomSnapshot,
  browserNetworkLog,
  clickBrowserSession,
  closeBrowserSession,
  navigateBrowserSession,
  screenshotBrowserSession,
  typeBrowserSession,
} from "./browser-session.js";

export type DesktopBundle = {
  revision: number;
  scope: PinDesktopScope;
  workspace: PinDesktopWorkspace;
  catalog: OxspSlotCatalog;
  templates: typeof OXSP_DOCK_TEMPLATES;
  pinnedWidgets: PinWidgetId[];
};

export function getDesktopBundle(scope: PinDesktopScope): DesktopBundle {
  const state = loadDesktopState(scope);
  const catalog = loadSlotCatalog(scope);
  const workspace = normalizeWorkspace(state.workspace);
  return {
    revision: state.revision,
    scope,
    workspace,
    catalog,
    templates: dockExtensionTemplates(),
    pinnedWidgets: pinnedWidgetsInWorkspace(workspace),
  };
}

function persistBundle(
  scope: PinDesktopScope,
  workspace: PinDesktopWorkspace,
  catalog: OxspSlotCatalog,
  baseRevision?: number,
): DesktopBundle {
  saveDesktopBundle(scope, normalizeWorkspace(workspace), catalog, baseRevision);
  return getDesktopBundle(scope);
}

export function createOxspSlot(
  scope: PinDesktopScope,
  body: OxspSlotCreateBody,
  baseRevision?: number,
): { bundle: DesktopBundle; slotId: string; widgetId: string } {
  let catalog = loadSlotCatalog(scope);
  const state = loadDesktopState(scope);
  let workspace = normalizeWorkspace(state.workspace);

  let config = body.config;
  if (!config && body.templateId) {
    config = resolveTemplateConfig(body.templateId) ?? undefined;
  }
  if (!config) {
    config = buildDefaultConfigForKind(body.kind);
  }

  const { catalog: nextCatalog, slot, widgetId } = addOxspSlot(catalog, config, body.title);
  catalog = nextCatalog;
  if (slot.config.kind === "browser") {
    catalog = updateOxspSlot(catalog, slot.id, {
      config: { ...slot.config, sessionId: slot.id },
    });
  }

  if (body.pinCol != null) {
    workspace = pinSlotAtColumnInWorkspace(workspace, widgetId, body.pinCol);
  } else {
    const col = extensionSlotColumn(layoutAtPage(workspace));
    workspace =
      col != null
        ? pinSlotAtColumnInWorkspace(workspace, widgetId, col)
        : pinSlotInWorkspace(workspace, widgetId);
  }

  if (!isWidgetPinnedInWorkspace(workspace, widgetId)) {
    throw new Error("SLOT_PIN_FAILED");
  }

  const bundle = persistBundle(scope, workspace, catalog, baseRevision);
  return { bundle, slotId: slot.id, widgetId };
}

export async function runOxspSlotCommand(
  scope: PinDesktopScope,
  slotId: string,
  body: OxspSlotCommandBody,
  baseRevision?: number,
): Promise<{ bundle: DesktopBundle; result?: unknown }> {
  let catalog = loadSlotCatalog(scope);
  const state = loadDesktopState(scope);
  let workspace = normalizeWorkspace(state.workspace);
  const slot = findOxspSlot(catalog, slotId);
  if (!slot) throw new Error("SLOT_NOT_FOUND");

  const widgetId = extWidgetId(slotId);
  let result: unknown;

  switch (body.action) {
    case "pin": {
      if (body.pinCol != null) {
        workspace = pinSlotAtColumnInWorkspace(workspace, widgetId, body.pinCol);
      } else {
        workspace = pinSlotInWorkspace(workspace, widgetId);
      }
      if (!isWidgetPinnedInWorkspace(workspace, widgetId)) throw new Error("SLOT_PIN_FAILED");
      break;
    }
    case "unpin": {
      const pages = workspace.pages.map((page) => unpinWidget(page, widgetId));
      workspace = normalizeWorkspace({ ...workspace, pages });
      break;
    }
    case "set_config": {
      if (!body.config) throw new Error("CONFIG_REQUIRED");
      catalog = updateOxspSlot(catalog, slotId, { config: body.config });
      break;
    }
    case "set_title": {
      if (body.title == null) throw new Error("TITLE_REQUIRED");
      catalog = updateOxspSlot(catalog, slotId, { title: body.title });
      break;
    }
    case "set_url":
    case "navigate": {
      const raw = body.url ?? "";
      const url = normalizeOxspUrl(raw);
      if (!url) throw new Error("INVALID_URL");
      if (slot.config.kind === "web") {
        catalog = updateOxspSlot(catalog, slotId, {
          config: { kind: "web", url },
        });
      } else if (slot.config.kind === "browser") {
        const sessionId = slot.config.sessionId ?? slotId;
        await navigateBrowserSession(sessionId, url);
        catalog = updateOxspSlot(catalog, slotId, {
          config: { kind: "browser", startUrl: url, sessionId },
        });
      } else {
        throw new Error("UNSUPPORTED_SLOT_KIND");
      }
      break;
    }
    case "browser_click": {
      if (slot.config.kind !== "browser") throw new Error("NOT_BROWSER_SLOT");
      if (body.x == null || body.y == null) throw new Error("COORDS_REQUIRED");
      const sessionId = slot.config.sessionId ?? slotId;
      await clickBrowserSession(sessionId, body.x, body.y);
      result = { clicked: { x: body.x, y: body.y } };
      break;
    }
    case "browser_type": {
      if (slot.config.kind !== "browser") throw new Error("NOT_BROWSER_SLOT");
      if (!body.text) throw new Error("TEXT_REQUIRED");
      const sessionId = slot.config.sessionId ?? slotId;
      await typeBrowserSession(sessionId, body.text);
      result = { typed: body.text.length };
      break;
    }
    case "browser_screenshot": {
      if (slot.config.kind !== "browser") throw new Error("NOT_BROWSER_SLOT");
      const sessionId = slot.config.sessionId ?? slotId;
      result = await screenshotBrowserSession(sessionId);
      break;
    }
    case "browser_dom": {
      if (slot.config.kind !== "browser") throw new Error("NOT_BROWSER_SLOT");
      const sessionId = slot.config.sessionId ?? slotId;
      result = await browserDomSnapshot(sessionId);
      break;
    }
    case "browser_network": {
      if (slot.config.kind !== "browser") throw new Error("NOT_BROWSER_SLOT");
      const sessionId = slot.config.sessionId ?? slotId;
      result = { entries: browserNetworkLog(sessionId) };
      break;
    }
    case "snapshot": {
      result = buildSlotSnapshot(catalog, workspace, slotId);
      break;
    }
    default:
      throw new Error("UNKNOWN_ACTION");
  }

  const bundle = persistBundle(scope, workspace, catalog, baseRevision);
  return { bundle, result };
}

export async function removeOxspSlotInstance(
  scope: PinDesktopScope,
  slotId: string,
  baseRevision?: number,
): Promise<DesktopBundle> {
  let catalog = loadSlotCatalog(scope);
  const state = loadDesktopState(scope);
  let workspace = normalizeWorkspace(state.workspace);
  const widgetId = extWidgetId(slotId);
  const slot = findOxspSlot(catalog, slotId);
  if (slot?.config.kind === "browser") {
    await closeBrowserSession(slot.config.sessionId ?? slotId);
  }
  const pages = workspace.pages.map((page) => unpinWidget(page, widgetId));
  workspace = normalizeWorkspace({ ...workspace, pages });
  catalog = removeOxspSlot(catalog, slotId);
  return persistBundle(scope, workspace, catalog, baseRevision);
}

export function buildSlotSnapshot(
  catalog: OxspSlotCatalog,
  workspace: PinDesktopWorkspace,
  slotId: string,
): OxspSlotSnapshot {
  const slot = findOxspSlot(catalog, slotId);
  if (!slot) throw new Error("SLOT_NOT_FOUND");
  const widgetId = extWidgetId(slotId);
  const pinned = isWidgetPinnedInWorkspace(workspace, widgetId);
  let snapshotText = "";
  if (slot.config.kind === "markdown") {
    snapshotText = slot.config.body;
  } else if (slot.config.kind === "web") {
    snapshotText = `web url=${slot.config.url}`;
  } else if (slot.config.kind === "browser") {
    snapshotText = `browser startUrl=${slot.config.startUrl ?? ""} session=${slot.config.sessionId ?? "pending"}`;
  } else if (slot.config.kind === "react") {
    snapshotText = `react component=${slot.config.componentId}`;
  }
  return {
    slotId,
    kind: slot.kind,
    title: oxspSlotLabel(slot),
    config: slot.config,
    pinned,
    widgetId: pinned ? widgetId : null,
    snapshotText,
  };
}

export function syncDesktopFromClient(
  scope: PinDesktopScope,
  workspace: PinDesktopWorkspace,
  catalog: OxspSlotCatalog,
  baseRevision?: number,
): DesktopBundle {
  return persistBundle(scope, workspace, catalog, baseRevision);
}

export function listSlotSnapshots(scope: PinDesktopScope): OxspSlotSnapshot[] {
  const bundle = getDesktopBundle(scope);
  return bundle.catalog.slots.map((s) => buildSlotSnapshot(bundle.catalog, bundle.workspace, s.id));
}

export function widgetIdsInWorkspace(workspace: PinDesktopWorkspace): string[] {
  return pinnedWidgetsInWorkspace(workspace)
    .map((w) => slotIdFromWidgetId(w))
    .filter((id): id is string => id != null);
}
