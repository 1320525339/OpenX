import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

const STORAGE_KEY = "openx.workspaceSplit";
const SWAPPED_KEY = "openx.workspaceSwapped";
const DEFAULT_RATIO = 0.54;
const MIN_RATIO = 0.32;
const MAX_RATIO = 0.78;

function loadSwapped(): boolean {
  try {
    return localStorage.getItem(SWAPPED_KEY) === "1";
  } catch {
    return false;
  }
}

function loadRatio(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_RATIO;
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n)) return DEFAULT_RATIO;
    return Math.min(MAX_RATIO, Math.max(MIN_RATIO, n));
  } catch {
    return DEFAULT_RATIO;
  }
}

type Props = {
  left: ReactNode;
  right: ReactNode;
  className?: string;
};

export function SplitWorkspace({ left, right, className = "" }: Props) {
  const [ratio, setRatio] = useState(loadRatio);
  const [swapped, setSwapped] = useState(loadSwapped);
  const ratioRef = useRef(ratio);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    ratioRef.current = ratio;
  }, [ratio]);

  const persistRatio = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(ratioRef.current));
    } catch {
      /* ignore */
    }
  }, []);

  const persistSwapped = useCallback((value: boolean) => {
    try {
      localStorage.setItem(SWAPPED_KEY, value ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const toggleSwap = useCallback(() => {
    const nextSwapped = !swapped;
    const inverted = 1 - ratioRef.current;
    ratioRef.current = inverted;
    setRatio(inverted);
    setSwapped(nextSwapped);
    persistSwapped(nextSwapped);
    persistRatio();
  }, [swapped, persistSwapped, persistRatio]);

  const onDividerPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.classList.add("split-dragging");
  }, []);

  const onDividerPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const next = (e.clientX - rect.left) / rect.width;
    const clamped = Math.min(MAX_RATIO, Math.max(MIN_RATIO, next));
    ratioRef.current = clamped;
    setRatio(clamped);
  }, []);

  const endDrag = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.classList.remove("split-dragging");
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      persistRatio();
    },
    [persistRatio],
  );

  const leftPct = `${(ratio * 100).toFixed(2)}%`;
  const rightPct = `${((1 - ratio) * 100).toFixed(2)}%`;

  const firstPane = swapped ? right : left;
  const secondPane = swapped ? left : right;

  return (
    <div
      ref={containerRef}
      className={`split-workspace${swapped ? " split-workspace-swapped" : ""} ${className}`.trim()}
      style={
        {
          "--split-left": leftPct,
          "--split-right": rightPct,
        } as CSSProperties
      }
    >
      <div className="split-workspace-left">{firstPane}</div>
      <div
        className="split-workspace-divider"
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={Math.round(MIN_RATIO * 100)}
        aria-valuemax={Math.round(MAX_RATIO * 100)}
        aria-label="调整左右窗口宽度"
        tabIndex={0}
        onPointerDown={onDividerPointerDown}
        onPointerMove={onDividerPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          const delta = e.key === "ArrowLeft" ? -0.03 : 0.03;
          const next = Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratioRef.current + delta));
          ratioRef.current = next;
          setRatio(next);
          persistRatio();
        }}
      >
        <button
          type="button"
          className="split-workspace-swap"
          aria-label="交换目标与助手位置"
          title="交换目标与助手位置"
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
      </div>
      <div className="split-workspace-right">{secondPane}</div>
    </div>
  );
}
