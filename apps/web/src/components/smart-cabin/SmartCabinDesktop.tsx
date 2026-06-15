import {
  useCallback,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import { PaneDivider } from "../PaneDivider";
import { usePaneResize } from "../../lib/use-pane-resize";

type Props = {
  strip: ReactNode;
  left: ReactNode;
  /** 柔性主屏画布（Widget 组合 + resize） */
  canvas: ReactNode;
  dock: ReactNode;
  className?: string;
};

export function SmartCabinDesktop({
  strip,
  left,
  canvas,
  dock,
  className = "",
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  const {
    value: leftRatio,
    valueRef: leftRatioRef,
    setValue: setLeftRatio,
    beginDrag: beginLeftDrag,
    onDividerPointerMove: onLeftMove,
    endDrag: endLeftDrag,
    persist: persistLeft,
  } = usePaneResize({
    storageKey: "openx.smartCabinLeftRatio",
    defaultRatio: 0.18,
    minRatio: 0.12,
    maxRatio: 0.3,
  });

  const onLeftDividerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      onLeftMove(e, containerRef.current);
    },
    [onLeftMove],
  );

  const leftFr = Math.max(1, Math.round(leftRatio * 1000));

  return (
    <div className={`smart-cabin-desktop ${className}`.trim()}>
      {strip}
      <div
        ref={containerRef}
        className="smart-cabin-cards"
        style={
          {
            gridTemplateColumns: `minmax(0, ${leftFr}fr) var(--pane-divider-hit) minmax(0, 1fr)`,
          } as CSSProperties
        }
      >
        <div className="smart-cabin-card smart-cabin-card-left">{left}</div>
        <PaneDivider
          ariaLabel="调整任务索引宽度"
          ariaValueNow={Math.round(leftRatio * 100)}
          ariaValueMin={12}
          ariaValueMax={30}
          onPointerDown={(e) => beginLeftDrag(e, containerRef.current)}
          onPointerMove={onLeftDividerMove}
          onPointerUp={endLeftDrag}
          onPointerCancel={endLeftDrag}
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            const delta = e.key === "ArrowLeft" ? -0.02 : 0.02;
            const next = Math.min(0.3, Math.max(0.12, leftRatioRef.current + delta));
            leftRatioRef.current = next;
            setLeftRatio(next);
            persistLeft();
          }}
        />
        <div className="smart-cabin-card smart-cabin-card-canvas">{canvas}</div>
      </div>
      {dock}
    </div>
  );
}
