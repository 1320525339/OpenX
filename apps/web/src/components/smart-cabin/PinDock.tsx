import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { OXSP_EXTENSION_TEMPLATES } from "@openx/shared";
import {
  PIN_DOCK_ITEMS,
  isExtWidgetId,
  type PinWidgetId,
} from "../../lib/pin-desktop";
import { PIN_DRAG_MOVE_THRESHOLD } from "../../lib/pin-desktop-drag";

const PIN_DOCK_LONG_PRESS_MS = 500;

export type PinDockItem = {
  id: PinWidgetId;
  label: string;
  icon: string;
};

type Props = {
  extItems?: PinDockItem[];
  isPinned: (widget: PinWidgetId) => boolean;
  pinnedCount: number;
  onTogglePin: (widget: PinWidgetId) => void;
  onRegisterTemplate?: (templateId: string) => boolean;
  onDockDragStart?: (widget: PinWidgetId) => void;
  onDockDragMove?: (clientX: number, clientY: number) => void;
  onDockDragEnd?: (widget: PinWidgetId, clientX: number, clientY: number) => void;
  onDockDragCancel?: () => void;
  onRemoveTab?: (widget: PinWidgetId) => void;
  onSettings?: () => void;
};

const EXTENSION_TEMPLATES = OXSP_EXTENSION_TEMPLATES;

type PendingDockDrag = {
  widget: PinWidgetId;
  pointerId: number;
  startX: number;
  startY: number;
  icon: string;
  label: string;
  pinned: boolean;
};

type DockDragGhost = {
  widget: PinWidgetId;
  icon: string;
  label: string;
  pinned: boolean;
};

export function PinDock({
  extItems = [],
  isPinned,
  pinnedCount,
  onTogglePin,
  onRegisterTemplate,
  onDockDragStart,
  onDockDragMove,
  onDockDragEnd,
  onDockDragCancel,
  onRemoveTab,
  onSettings,
}: Props) {
  const pendingRef = useRef<PendingDockDrag | null>(null);
  const draggingRef = useRef<PinWidgetId | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressActivatedRef = useRef(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const pointerRef = useRef({ x: 0, y: 0 });
  const [trackPointer, setTrackPointer] = useState(false);
  const [draggingWidget, setDraggingWidget] = useState<PinWidgetId | null>(null);
  const [dragGhost, setDragGhost] = useState<DockDragGhost | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [deleteModeWidget, setDeleteModeWidget] = useState<PinWidgetId | null>(null);

  const dockItems: PinDockItem[] = [
    ...PIN_DOCK_ITEMS.map((item) => ({ id: item.id, label: item.label, icon: item.icon })),
    ...extItems,
  ];

  const closeAddMenu = useCallback(() => setAddMenuOpen(false), []);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const dismissDeleteMode = useCallback(() => {
    setDeleteModeWidget(null);
  }, []);

  const removeTab = useCallback(
    (widget: PinWidgetId) => {
      onRemoveTab?.(widget);
      dismissDeleteMode();
    },
    [dismissDeleteMode, onRemoveTab],
  );

  const handleAddTemplate = useCallback(
    (templateId: string) => {
      onRegisterTemplate?.(templateId);
      closeAddMenu();
    },
    [closeAddMenu, onRegisterTemplate],
  );

  useEffect(() => {
    if (!addMenuOpen) return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest(".pin-dock-add-menu, .pin-dock-add-btn")) return;
      closeAddMenu();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAddMenu();
    };

    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [addMenuOpen, closeAddMenu]);

  useEffect(() => {
    if (!deleteModeWidget) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest(".pin-dock-delete-badge, .pin-dock-btn.delete-mode")) return;
      dismissDeleteMode();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismissDeleteMode();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [deleteModeWidget, dismissDeleteMode]);

  useEffect(() => {
    return () => clearLongPressTimer();
  }, [clearLongPressTimer]);

  const applyGhostTransform = useCallback((x: number, y: number) => {
    const el = overlayRef.current;
    if (!el) return;
    const icon = el.querySelector<HTMLElement>(".pin-dock-drag-ghost-icon");
    const anchor = icon ?? el;
    const anchorX = anchor.offsetLeft + anchor.offsetWidth / 2;
    const anchorY = anchor.offsetTop + anchor.offsetHeight / 2;
    el.style.transform = `translate3d(${x - anchorX}px, ${y - anchorY}px, 0) scale(1.06)`;
  }, []);

  const clearDrag = useCallback(() => {
    clearLongPressTimer();
    longPressActivatedRef.current = false;
    pendingRef.current = null;
    draggingRef.current = null;
    setDraggingWidget(null);
    setDragGhost(null);
    setTrackPointer(false);
    document.body.classList.remove("pin-dock-body-dragging");
  }, [clearLongPressTimer]);

  const resolveItem = useCallback(
    (widget: PinWidgetId) => dockItems.find((entry) => entry.id === widget),
    [dockItems],
  );

  const onBtnPointerDown = useCallback(
    (widget: PinWidgetId, e: ReactPointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      if (deleteModeWidget && deleteModeWidget !== widget) {
        dismissDeleteMode();
      }
      if (deleteModeWidget === widget) return;

      if (!onDockDragStart) {
        if (!longPressActivatedRef.current) onTogglePin(widget);
        return;
      }

      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);

      const item = resolveItem(widget);
      longPressActivatedRef.current = false;
      clearLongPressTimer();

      pendingRef.current = {
        widget,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        icon: item?.icon ?? "📌",
        label: item?.label ?? widget,
        pinned: isPinned(widget),
      };
      setTrackPointer(true);

      if (isExtWidgetId(widget) && onRemoveTab) {
        longPressTimerRef.current = setTimeout(() => {
          longPressTimerRef.current = null;
          if (!pendingRef.current || pendingRef.current.widget !== widget) return;
          if (draggingRef.current) return;
          longPressActivatedRef.current = true;
          setDeleteModeWidget(widget);
        }, PIN_DOCK_LONG_PRESS_MS);
      }
    },
    [
      clearLongPressTimer,
      deleteModeWidget,
      dismissDeleteMode,
      isPinned,
      onDockDragStart,
      onRemoveTab,
      onTogglePin,
      resolveItem,
    ],
  );

  useLayoutEffect(() => {
    if (!dragGhost) return;
    applyGhostTransform(pointerRef.current.x, pointerRef.current.y);
  }, [dragGhost, applyGhostTransform]);

  useEffect(() => {
    if (!trackPointer) return;

    const onMove = (e: PointerEvent) => {
      const pending = pendingRef.current;
      if (!pending || e.pointerId !== pending.pointerId) return;

      if (draggingRef.current) {
        e.preventDefault();
        pointerRef.current = { x: e.clientX, y: e.clientY };
        applyGhostTransform(e.clientX, e.clientY);
        onDockDragMove?.(e.clientX, e.clientY);
        return;
      }

      const dx = e.clientX - pending.startX;
      const dy = e.clientY - pending.startY;
      if (Math.hypot(dx, dy) < PIN_DRAG_MOVE_THRESHOLD) return;

      clearLongPressTimer();
      if (deleteModeWidget === pending.widget) {
        dismissDeleteMode();
      }

      draggingRef.current = pending.widget;
      setDraggingWidget(pending.widget);
      pointerRef.current = { x: e.clientX, y: e.clientY };
      setDragGhost({
        widget: pending.widget,
        icon: pending.icon,
        label: pending.label,
        pinned: pending.pinned,
      });
      onDockDragStart?.(pending.widget);
      onDockDragMove?.(e.clientX, e.clientY);
      document.body.classList.add("pin-dock-body-dragging");
    };

    const finish = (e: PointerEvent) => {
      const pending = pendingRef.current;
      if (!pending || e.pointerId !== pending.pointerId) return;

      if (draggingRef.current) {
        onDockDragEnd?.(draggingRef.current, e.clientX, e.clientY);
      } else if (!longPressActivatedRef.current) {
        onTogglePin(pending.widget);
      }

      clearDrag();
    };

    const cancel = (e: PointerEvent) => {
      const pending = pendingRef.current;
      if (!pending || e.pointerId !== pending.pointerId) return;
      if (draggingRef.current) onDockDragCancel?.();
      clearDrag();
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [
    trackPointer,
    applyGhostTransform,
    clearDrag,
    onDockDragStart,
    onDockDragMove,
    onDockDragEnd,
    onDockDragCancel,
    onTogglePin,
    clearLongPressTimer,
    deleteModeWidget,
    dismissDeleteMode,
  ]);

  useEffect(() => {
    return () => {
      document.body.classList.remove("pin-dock-body-dragging");
    };
  }, []);

  return (
    <>
      <footer className="pin-dock" aria-label="桌面 Pin 底栏">
        <div className="pin-dock-modes" role="toolbar">
          {dockItems.map((item) => {
            const pinned = isPinned(item.id);
            const dragging = draggingWidget === item.id;
            const deleteMode = deleteModeWidget === item.id;
            const deletable = isExtWidgetId(item.id) && Boolean(onRemoveTab);
            return (
              <div key={item.id} className="pin-dock-btn-wrap">
                <button
                  type="button"
                  className={`pin-dock-btn${pinned ? " pinned" : ""}${dragging ? " dragging" : ""}${deleteMode ? " delete-mode" : ""}`}
                  aria-pressed={pinned}
                  title={
                    deletable
                      ? pinned
                        ? `拖动换位 · 点击取消固定 · 长按删除 ${item.label}`
                        : `拖动 Pin · 点击固定 · 长按删除 ${item.label}`
                      : pinned
                        ? `拖动到桌面槽位换位 · 点击取消固定 ${item.label}`
                        : `拖动到桌面槽位 Pin ${item.label} · 点击快速固定`
                  }
                  onPointerDown={(e) => onBtnPointerDown(item.id, e)}
                >
                  <span className="pin-dock-icon" aria-hidden>
                    {item.icon}
                  </span>
                  <span className="pin-dock-label">{item.label}</span>
                  {pinned ? <span className="pin-dock-pin-mark">已固定</span> : null}
                </button>
                {deleteMode && deletable ? (
                  <button
                    type="button"
                    className="pin-dock-delete-badge"
                    aria-label={`删除 ${item.label}`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeTab(item.id);
                    }}
                  >
                    ×
                  </button>
                ) : null}
              </div>
            );
          })}

          {onRegisterTemplate ? (
            <div className="pin-dock-add-wrap">
              <button
                type="button"
                className="pin-dock-btn pin-dock-add-btn"
                aria-label="新增面板"
                aria-expanded={addMenuOpen}
                title="注册新的拓展面板"
                onClick={() => setAddMenuOpen((open) => !open)}
              >
                <span className="pin-dock-icon pin-dock-add-icon" aria-hidden>
                  +
                </span>
                <span className="pin-dock-label">新增</span>
              </button>

              {addMenuOpen ? (
                <div className="pin-dock-add-menu" role="menu">
                  <p className="pin-dock-add-menu-title">选择面板类型</p>
                  <div className="pin-dock-add-templates" role="group">
                    {EXTENSION_TEMPLATES.map((tpl) => (
                      <button
                        key={tpl.id}
                        type="button"
                        role="menuitem"
                        className="pin-dock-add-template-btn"
                        onClick={() => handleAddTemplate(tpl.id)}
                      >
                        <span aria-hidden>{tpl.icon}</span> {tpl.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <span className="pin-dock-meta">
          已 Pin <strong>{pinnedCount}</strong>
          <span className="pin-dock-meta-edit"> · 拖图标到槽位</span>
        </span>
        {onSettings ? (
          <button
            type="button"
            className="pin-dock-settings"
            title="打开设置"
            aria-label="打开设置"
            onClick={onSettings}
          >
            <span className="pin-dock-settings-icon" aria-hidden>
              ⚙
            </span>
            <span className="pin-dock-settings-label">设置</span>
          </button>
        ) : null}
      </footer>

      {dragGhost &&
        createPortal(
          <div
            ref={overlayRef}
            className={`pin-dock-drag-ghost${dragGhost.pinned ? " pinned" : ""}`}
            aria-hidden
          >
            <span className="pin-dock-drag-ghost-icon">{dragGhost.icon}</span>
            <span className="pin-dock-drag-ghost-label">{dragGhost.label}</span>
          </div>,
          document.body,
        )}
    </>
  );
}
