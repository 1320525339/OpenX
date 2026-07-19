import type { ReactNode, MutableRefObject } from "react";
import type { PinDesktopLayout, PinWidgetId } from "../../lib/pin-desktop";
import type { PinDockDragState } from "../../lib/use-pin-dock-drag";
import { HyperPinDesktop } from "./HyperPinDesktop";
import { PinDesktopCanvas } from "./PinDesktopCanvas";
import { PinDesktopPager } from "./PinDesktopPager";
import { PinDock, type PinDockItem } from "./PinDock";

type Props = {
  className: string;
  layout: PinDesktopLayout;
  widgets: Partial<Record<PinWidgetId, ReactNode>>;
  activePage: number;
  pageCount: number;
  setPage: (page: number) => void;
  getSlotLabel: (widget: PinWidgetId) => string;
  unpin: (widget: PinWidgetId) => void;
  applyDrop: NonNullable<React.ComponentProps<typeof PinDesktopCanvas>["onApplyDrop"]>;
  commitSeamResize: NonNullable<React.ComponentProps<typeof PinDesktopCanvas>["onSeamCommit"]>;
  dockDrag: PinDockDragState | null;
  onGridRectChange: (rect: DOMRect) => void;
  getCellRectRef: MutableRefObject<(col: number) => DOMRect | null>;
  addDockCardAtCol: NonNullable<
    React.ComponentProps<typeof PinDesktopCanvas>["onPinWidgetAtCol"]
  >;
  addSlotFromTemplate: NonNullable<
    React.ComponentProps<typeof PinDesktopCanvas>["onAddTemplateAtCol"]
  >;
  isPinned: (widget: PinWidgetId) => boolean;
  pinnedCount: number;
  togglePin: (widget: PinWidgetId) => void;
  registerSlotFromTemplate: NonNullable<
    React.ComponentProps<typeof PinDock>["onRegisterTemplate"]
  >;
  extDockItems: PinDockItem[];
  onDockDragStart: NonNullable<React.ComponentProps<typeof PinDock>["onDockDragStart"]>;
  onDockDragMove: NonNullable<React.ComponentProps<typeof PinDock>["onDockDragMove"]>;
  onDockDragEnd: NonNullable<React.ComponentProps<typeof PinDock>["onDockDragEnd"]>;
  onDockDragCancel: NonNullable<React.ComponentProps<typeof PinDock>["onDockDragCancel"]>;
  onSettings?: () => void;
  onEnableRoundtable?: () => void;
  roundtableActive?: boolean;
};

/** Console / Conversation 共用的 Pin 桌面壳（pager + canvas + dock） */
export function PinWorkspaceShell({
  className,
  layout,
  widgets,
  activePage,
  pageCount,
  setPage,
  getSlotLabel,
  unpin,
  applyDrop,
  commitSeamResize,
  dockDrag,
  onGridRectChange,
  getCellRectRef,
  addDockCardAtCol,
  addSlotFromTemplate,
  isPinned,
  pinnedCount,
  togglePin,
  registerSlotFromTemplate,
  extDockItems,
  onDockDragStart,
  onDockDragMove,
  onDockDragEnd,
  onDockDragCancel,
  onSettings,
  onEnableRoundtable,
  roundtableActive,
}: Props) {
  return (
    <HyperPinDesktop
      className={className}
      canvas={
        <PinDesktopPager pageIndex={activePage} pageCount={pageCount} onPageChange={setPage}>
          <PinDesktopCanvas
            layout={layout}
            widgets={widgets}
            getSlotLabel={getSlotLabel}
            onUnpin={unpin}
            onApplyDrop={applyDrop}
            onSeamCommit={commitSeamResize}
            dockDragWidget={dockDrag?.widget ?? null}
            dockDragOverCol={dockDrag?.overCol ?? null}
            dockDragOverZone={dockDrag?.overZone ?? null}
            onGridRectChange={onGridRectChange}
            onBindCellRect={(getter) => {
              getCellRectRef.current = getter;
            }}
            onPinWidgetAtCol={addDockCardAtCol}
            onAddTemplateAtCol={addSlotFromTemplate}
            isDockWidgetPinned={isPinned}
            pageIndex={activePage}
            pageCount={pageCount}
          />
        </PinDesktopPager>
      }
      dock={
        <PinDock
          extItems={extDockItems}
          isPinned={isPinned}
          pinnedCount={pinnedCount}
          onTogglePin={togglePin}
          onRegisterTemplate={registerSlotFromTemplate}
          onDockDragStart={onDockDragStart}
          onDockDragMove={onDockDragMove}
          onDockDragEnd={onDockDragEnd}
          onDockDragCancel={onDockDragCancel}
          onRemoveTab={unpin}
          onSettings={onSettings}
          onEnableRoundtable={onEnableRoundtable}
          roundtableActive={roundtableActive}
        />
      }
    />
  );
}
