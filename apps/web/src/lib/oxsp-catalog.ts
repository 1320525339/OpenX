import {
  emptyOxspCatalog,
  extWidgetId,
  migrateLegacyWebCards,
  OxspSlotCatalogSchema,
  type OxspSlotCatalog,
  type OxspSlotConfig,
  type OxspSlotInstance,
  type PinDesktopScope,
} from "@openx/shared";
import {
  addOxspSlot,
  findOxspSlot,
  normalizeOxspUrl,
  oxspSlotLabel,
  removeOxspSlot,
  updateOxspSlot,
} from "@openx/shared";

const CATALOG_STORAGE_KEY = "openx.oxsp.catalog";
const LEGACY_EXTENSION_KEY = "openx.pinDesktop.extension";

function catalogKey(scope: PinDesktopScope): string {
  return `${CATALOG_STORAGE_KEY}.${scope}`;
}

function legacyKey(scope: PinDesktopScope): string {
  return `${LEGACY_EXTENSION_KEY}.${scope}`;
}

function upgradeWebSlotsToBrowser(catalog: OxspSlotCatalog): OxspSlotCatalog {
  let changed = false;
  const slots = catalog.slots.map((slot): OxspSlotInstance => {
    if (slot.config.kind !== "web") return slot;
    changed = true;
    return {
      ...slot,
      kind: "browser",
      title: slot.title === "网页" ? "浏览器" : slot.title,
      config: { kind: "browser", startUrl: slot.config.url },
      updatedAt: Date.now(),
    };
  });
  return changed ? { slots } : catalog;
}

export function loadOxspCatalog(scope: PinDesktopScope): OxspSlotCatalog {
  try {
    const raw = localStorage.getItem(catalogKey(scope));
    if (raw) {
      const parsed = OxspSlotCatalogSchema.safeParse(JSON.parse(raw));
      if (parsed.success) {
        const upgraded = upgradeWebSlotsToBrowser(parsed.data);
        if (upgraded !== parsed.data) saveOxspCatalog(scope, upgraded);
        return upgraded;
      }
    }
  } catch {
    /* fall through */
  }
  try {
    const legacy = localStorage.getItem(legacyKey(scope));
    if (legacy) {
      const migrated = upgradeWebSlotsToBrowser(migrateLegacyWebCards(JSON.parse(legacy)));
      if (migrated.slots.length > 0) {
        saveOxspCatalog(scope, migrated);
        return migrated;
      }
    }
  } catch {
    /* ignore */
  }
  return emptyOxspCatalog();
}

export function saveOxspCatalog(scope: PinDesktopScope, catalog: OxspSlotCatalog): void {
  try {
    localStorage.setItem(catalogKey(scope), JSON.stringify(catalog));
  } catch {
    /* ignore */
  }
}

export {
  addOxspSlot,
  findOxspSlot,
  normalizeOxspUrl,
  oxspSlotLabel,
  removeOxspSlot,
  updateOxspSlot,
  extWidgetId,
  emptyOxspCatalog,
};

export type { OxspSlotCatalog, OxspSlotConfig };

/** @deprecated 兼容旧名 */
export type PinExtensionCatalog = OxspSlotCatalog;

export function loadPinExtensionCatalog(scope: PinDesktopScope): OxspSlotCatalog {
  return loadOxspCatalog(scope);
}

export function savePinExtensionCatalog(scope: PinDesktopScope, catalog: OxspSlotCatalog): void {
  saveOxspCatalog(scope, catalog);
}

export function addBrowserCardToCatalog(
  catalog: OxspSlotCatalog,
  startUrl: string,
  title?: string,
): ReturnType<typeof addOxspSlot> {
  return addOxspSlot(catalog, { kind: "browser", startUrl }, title);
}

/** @deprecated 使用 addBrowserCardToCatalog */
export function addWebCardToCatalog(
  catalog: OxspSlotCatalog,
  url: string,
  title?: string,
): ReturnType<typeof addOxspSlot> {
  return addBrowserCardToCatalog(catalog, url, title);
}

export function removeWebCardFromCatalog(catalog: OxspSlotCatalog, cardId: string): OxspSlotCatalog {
  return removeOxspSlot(catalog, cardId);
}

export function findWebCard(catalog: OxspSlotCatalog, cardId: string) {
  return findOxspSlot(catalog, cardId);
}

export function webCardLabel(slot: ReturnType<typeof findOxspSlot>) {
  return oxspSlotLabel(slot);
}

export const PIN_EXTENSION_DEMO_URL = "/demo/crew-game/";

export function normalizeExtensionUrl(input: string, baseHref?: string) {
  return normalizeOxspUrl(input, baseHref);
}

export function newWebCardId(): string {
  return `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function webWidgetId(cardId: string) {
  return extWidgetId(cardId);
}
