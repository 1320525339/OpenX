import { useCallback, useEffect, useRef, useState } from "react";
import { OXSP_EXTENSION_TEMPLATES } from "@openx/shared";
import { PIN_DOCK_ITEMS, type PinDockWidgetId } from "../../lib/pin-desktop";
import { FlexibleWidgetFrame } from "./FlexibleWidgetFrame";

type Props = {
  col: number;
  onPinWidget: (col: number, widget: PinDockWidgetId) => boolean;
  onAddTemplate: (col: number, templateId: string) => boolean;
  isWidgetPinned: (widget: PinDockWidgetId) => boolean;
};

const EXTENSION_TEMPLATES = OXSP_EXTENSION_TEMPLATES;

/** 网格内拓展槽卡片：空列占位，点击 + 添加内容 */
export function PinExtensionCard({
  col,
  onPinWidget,
  onAddTemplate,
  isWidgetPinned,
}: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  const handlePinWidget = useCallback(
    (widget: PinDockWidgetId) => {
      onPinWidget(col, widget);
      closeMenu();
    },
    [closeMenu, col, onPinWidget],
  );

  const handleAddTemplate = useCallback(
    (templateId: string) => {
      onAddTemplate(col, templateId);
      closeMenu();
    },
    [closeMenu, col, onAddTemplate],
  );

  useEffect(() => {
    if (!menuOpen) return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest(".pin-extension-add-menu, .pin-extension-add-trigger")) return;
      closeMenu();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };

    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen, closeMenu]);

  return (
    <div ref={shellRef} className="pin-extension-cell">
      <FlexibleWidgetFrame title="拓展槽" pinnable={false}>
        <div className="pin-extension-slot-body">
          <button
            type="button"
            className="pin-extension-add-trigger"
            aria-label="添加卡片"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="pin-extension-add-glyph" aria-hidden>
              +
            </span>
          </button>

          {menuOpen ? (
            <div className="pin-extension-add-menu" role="menu">
              <p className="pin-extension-add-menu-title">选择卡片内容</p>
              <div className="pin-extension-add-dock" role="group" aria-label="底栏面板">
                {PIN_DOCK_ITEMS.map((item) => {
                  const pinned = isWidgetPinned(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="menuitem"
                      className={`pin-extension-add-dock-btn${pinned ? " pinned" : ""}`}
                      disabled={pinned}
                      title={pinned ? `${item.label} 已在桌面` : `添加 ${item.label}`}
                      onClick={() => handlePinWidget(item.id)}
                    >
                      <span className="pin-extension-add-dock-icon" aria-hidden>
                        {item.icon}
                      </span>
                      <span className="pin-extension-add-dock-label">{item.label}</span>
                    </button>
                  );
                })}
              </div>
              <div className="pin-extension-add-extensions" role="group" aria-label="拓展槽模板">
                {EXTENSION_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    role="menuitem"
                    className="pin-extension-add-url"
                    onClick={() => handleAddTemplate(tpl.id)}
                  >
                    {tpl.icon} {tpl.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </FlexibleWidgetFrame>
    </div>
  );
}
