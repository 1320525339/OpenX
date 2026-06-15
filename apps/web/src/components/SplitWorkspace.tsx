import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { PaneDivider } from "./PaneDivider";
import { usePaneResize } from "../lib/use-pane-resize";

const DEFAULT_STORAGE_KEY = "openx.workspaceSplit";
const DEFAULT_SWAPPED_KEY = "openx.workspaceSwapped";
const DEFAULT_RATIO = 0.54;
const DEFAULT_MIN_RATIO = 0.32;
const DEFAULT_MAX_RATIO = 0.78;

type Props = {
  left: ReactNode;
  right: ReactNode;
  className?: string;
  storageKey?: string;
  swappedStorageKey?: string;
  defaultRatio?: number;
  minRatio?: number;
  maxRatio?: number;
  dividerAriaLabel?: string;
  swapAriaLabel?: string;
};

function loadSwappedForKey(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function SplitWorkspace({
  left,
  right,
  className = "",
  storageKey = DEFAULT_STORAGE_KEY,
  swappedStorageKey = DEFAULT_SWAPPED_KEY,
  defaultRatio = DEFAULT_RATIO,
  minRatio = DEFAULT_MIN_RATIO,
  maxRatio = DEFAULT_MAX_RATIO,
  dividerAriaLabel = "调整任务与对话宽度",
  swapAriaLabel = "交换目标与助手位置",
}: Props) {
  const { value: ratio, valueRef: ratioRef, setValue: setRatio, beginDrag, onDividerPointerMove, endDrag, nudgeRatio, persist } =
    usePaneResize({
      storageKey,
      defaultRatio,
      minRatio,
      maxRatio,
    });
  const [swapped, setSwapped] = useState(() => loadSwappedForKey(swappedStorageKey));
  const containerRef = useRef<HTMLDivElement>(null);

  const persistSwapped = useCallback(
    (value: boolean) => {
      try {
        localStorage.setItem(swappedStorageKey, value ? "1" : "0");
      } catch {
        /* ignore */
      }
    },
    [swappedStorageKey],
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

  const leftFr = Math.max(1, Math.round(ratio * 1000));
  const rightFr = Math.max(1, Math.round((1 - ratio) * 1000));

  const firstPane = swapped ? right : left;
  const secondPane = swapped ? left : right;

  return (
    <div
      ref={containerRef}
      className={`split-workspace${swapped ? " split-workspace-swapped" : ""} ${className}`.trim()}
      style={
        {
          gridTemplateColumns: `minmax(0, ${leftFr}fr) var(--pane-divider-hit) minmax(0, ${rightFr}fr)`,
        } as CSSProperties
      }
    >
      <div className="split-workspace-left">{firstPane}</div>
      <PaneDivider
        ariaLabel={dividerAriaLabel}
        ariaValueNow={Math.round(ratio * 100)}
        ariaValueMin={Math.round(minRatio * 100)}
        ariaValueMax={Math.round(maxRatio * 100)}
        onPointerDown={onDividerPointerDown}
        onPointerMove={onDividerPointerMoveWrapped}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          nudgeRatio(e.key === "ArrowLeft" ? -0.03 : 0.03);
        }}
      >
        <button
          type="button"
          className="split-workspace-swap"
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
      <div className="split-workspace-right">{secondPane}</div>
    </div>
  );
}
