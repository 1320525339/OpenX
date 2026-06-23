import type { ReactNode } from "react";
import type { OxspSlotInstance, PinDesktopScope } from "@openx/shared";
import { isExtWidgetId, isLegacyWebWidgetId } from "@openx/shared";
import { resolveBuiltinDockWidget, type PinWidgetId } from "../../lib/pin-desktop";
import { findOxspSlot, type OxspSlotCatalog } from "../../lib/oxsp-catalog";
import { OxspBrowserSlot } from "./OxspBrowserSlot";

type Props = {
  widget: PinWidgetId;
  catalog: OxspSlotCatalog;
  builtinWidgets: Partial<Record<PinWidgetId, ReactNode>>;
  desktopScope?: PinDesktopScope;
};

function resolveSlot(catalog: OxspSlotCatalog, widget: PinWidgetId): OxspSlotInstance | null {
  if (isExtWidgetId(widget)) return findOxspSlot(catalog, widget.slice(4));
  if (isLegacyWebWidgetId(widget)) return findOxspSlot(catalog, widget.slice(4));
  return null;
}

export function OxspSlotRenderer({ widget, catalog, builtinWidgets, desktopScope }: Props) {
  const slot = resolveSlot(catalog, widget);
  if (!slot) {
    return builtinWidgets[widget] ?? <p className="empty-hint">面板加载中…</p>;
  }

  if (slot.config.kind === "react") {
    const componentId = resolveBuiltinDockWidget(slot.config.componentId);
    return builtinWidgets[componentId] ?? <p className="empty-hint">内置面板不可用</p>;
  }

  if (slot.config.kind === "web") {
    return (
      <div className="flexible-widget-fill pin-extension-webview-wrap">
        <OxspBrowserSlot slotId={slot.id} startUrl={slot.config.url} scope={desktopScope} />
      </div>
    );
  }

  if (slot.config.kind === "markdown") {
    return (
      <div className="flexible-widget-fill pin-extension-blank-shell">
        <p className="pin-extension-empty-title">笔记槽已停用</p>
        <p className="pin-extension-empty-hint">请取消 Pin 后改用浏览器拓展槽。</p>
      </div>
    );
  }

  if (slot.config.kind === "browser") {
    return (
      <div className="flexible-widget-fill pin-extension-webview-wrap">
        <OxspBrowserSlot
          slotId={slot.id}
          startUrl={slot.config.startUrl}
          sessionId={slot.config.sessionId}
          scope={desktopScope}
        />
      </div>
    );
  }

  return <p className="empty-hint">未知拓展槽类型</p>;
}
