import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { PaneDivider } from "./PaneDivider";
import { usePaneResize } from "../lib/use-pane-resize";

function loadSwapped(storageKey: string): boolean {
  try {
    return localStorage.getItem(storageKey) === "1";
  } catch {
    return false;
  }
}

type Props = {
  top: ReactNode;
  bottom: ReactNode;
  className?: string;
  dividerClassName?: string;
  storageKey: string;
  swappedStorageKey?: string;
  defaultRatio?: number;
  minRatio?: number;
  maxRatio?: number;
  ariaLabel?: string;
  swapAriaLabel?: string;
};

export function SplitPaneStack({
  top,
  bottom,
  className = "",
  dividerClassName = "",
  storageKey,
  swappedStorageKey,
  defaultRatio = 0.34,
  minRatio = 0.15,
  maxRatio = 0.85,
  ariaLabel = "调整上下区域高度",
  swapAriaLabel = "交换上下区域位置",
}: Props) {
  const swapKey = swappedStorageKey ?? `${storageKey}.swapped`;
  const containerRef = useRef<HTMLDivElement>(null);
  const {
    value: ratio,
    valueRef: ratioRef,
    setValue: setRatio,
    beginDrag,
    onDividerPointerMove,
    endDrag,
    nudgeRatio,
    persist,
  } = usePaneResize({
    orientation: "vertical",
    storageKey,
    defaultRatio,
    minRatio,
    maxRatio,
  });
  const [swapped, setSwapped] = useState(() => loadSwapped(swapKey));

  const persistSwapped = useCallback(
    (value: boolean) => {
      try {
        localStorage.setItem(swapKey, value ? "1" : "0");
      } catch {
        /* ignore */
      }
    },
    [swapKey],
  );

  const toggleSwap = useCallback(() => {
    const nextSwapped = !swapped;
    const inverted = 1 - ratioRef.current;
    ratioRef.current = inverted;
    setRatio(inverted);
    setSwapped(nextSwapped);
    persistSwapped(nextSwapped);
    persist();
  }, [swapped, persistSwapped, persist, setRatio, ratioRef]);

  const onDividerPointerMoveWrapped = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      onDividerPointerMove(e, containerRef.current);
    },
    [onDividerPointerMove],
  );

  const onDividerPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      beginDrag(e, containerRef.current);
    },
    [beginDrag],
  );

  const topFr = Math.max(1, Math.round(ratio * 1000));
  const bottomFr = Math.max(1, Math.round((1 - ratio) * 1000));

  const firstPane = swapped ? bottom : top;
  const secondPane = swapped ? top : bottom;

  return (
    <div
      ref={containerRef}
      className={`split-pane-stack${swapped ? " split-pane-stack-swapped" : ""} ${className}`.trim()}
      style={
        {
          gridTemplateRows: `minmax(0, ${topFr}fr) var(--pane-divider-hit) minmax(0, ${bottomFr}fr)`,
        } as CSSProperties
      }
    >
      <div className="split-pane-stack-top">{firstPane}</div>
      <PaneDivider
        orientation="horizontal"
        className={`split-pane-stack-divider${dividerClassName ? ` ${dividerClassName}` : ""}`}
        ariaLabel={ariaLabel}
        ariaValueNow={Math.round(ratio * 100)}
        ariaValueMin={Math.round(minRatio * 100)}
        ariaValueMax={Math.round(maxRatio * 100)}
        onPointerDown={onDividerPointerDown}
        onPointerMove={onDividerPointerMoveWrapped}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={(e) => {
          if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
          e.preventDefault();
          nudgeRatio(e.key === "ArrowUp" ? -0.03 : 0.03);
        }}
      >
        <button
          type="button"
          className="split-pane-stack-swap"
          aria-label={swapAriaLabel}
          title={swapAriaLabel}
          onClick={(e) => {
            e.stopPropagation();
            toggleSwap();
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <svg viewBox="0 0 20 20" fill="none" aria-hidden>
            <path
              d="M6.5 4.5 3.5 7.5l3 3M13.5 15.5l3-3-3-3"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M3.5 7.5h9.5M16.5 12.5H7"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </PaneDivider>
      <div className="split-pane-stack-bottom">{secondPane}</div>
    </div>
  );
}
