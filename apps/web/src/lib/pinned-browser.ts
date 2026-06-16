import type { OxspSlotCatalog } from "@openx/shared";
import { extWidgetId } from "@openx/shared";
import type { PinDesktopLayout } from "./pin-desktop";
import { pinnedWidgets } from "./pin-desktop";

export function hasPinnedBrowserSlot(catalog: OxspSlotCatalog, layout: PinDesktopLayout): boolean {
  const pinned = new Set(pinnedWidgets(layout));
  return catalog.slots.some(
    (slot) => slot.config.kind === "browser" && pinned.has(extWidgetId(slot.id)),
  );
}
