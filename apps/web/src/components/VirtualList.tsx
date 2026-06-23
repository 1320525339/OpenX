import { useVirtualizer } from "@tanstack/react-virtual";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type ReactNode,
} from "react";

export type VirtualListHandle = {
  scrollToIndex: (
    index: number,
    opts?: { align?: "start" | "center" | "end" },
  ) => void;
  getScrollElement: () => HTMLDivElement | null;
};

type Props<T> = {
  items: T[];
  estimateSize: number;
  overscan?: number;
  className?: string;
  onReachStart?: () => void;
  onReachEnd?: () => void;
  getItemKey?: (item: T, index: number) => string | number;
  renderItem: (item: T, index: number) => ReactNode;
};

function VirtualListInner<T>(
  {
    items,
    estimateSize,
    overscan = 8,
    className,
    onReachStart,
    onReachEnd,
    getItemKey,
    renderItem,
  }: Props<T>,
  ref: React.ForwardedRef<VirtualListHandle>,
) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan,
    getItemKey: getItemKey ? (index) => getItemKey(items[index]!, index) : undefined,
  });

  useImperativeHandle(ref, () => ({
    scrollToIndex: (index, opts) => {
      rowVirtualizer.scrollToIndex(index, opts);
    },
    getScrollElement: () => parentRef.current,
  }));

  const virtualItems = rowVirtualizer.getVirtualItems();
  const firstIndex = virtualItems[0]?.index ?? -1;
  const lastIndex = virtualItems[virtualItems.length - 1]?.index ?? -1;

  useEffect(() => {
    if (!onReachStart || firstIndex < 0) return;
    if (firstIndex <= 2) onReachStart();
  }, [items.length, firstIndex, onReachStart]);

  useEffect(() => {
    if (!onReachEnd || lastIndex < 0) return;
    if (lastIndex >= items.length - 3) onReachEnd();
  }, [items.length, lastIndex, onReachEnd]);

  return (
    <div ref={parentRef} className={className}>
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualItems.map((virtualRow) => {
          const item = items[virtualRow.index]!;
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={rowVirtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {renderItem(item, virtualRow.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const VirtualList = forwardRef(VirtualListInner) as <T>(
  props: Props<T> & { ref?: React.ForwardedRef<VirtualListHandle> },
) => ReturnType<typeof VirtualListInner>;
