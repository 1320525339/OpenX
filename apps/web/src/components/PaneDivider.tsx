import type { KeyboardEvent, PointerEvent, ReactNode } from "react";

type Props = {
  orientation?: "vertical" | "horizontal";
  ariaLabel?: string;
  ariaValueNow?: number;
  ariaValueMin?: number;
  ariaValueMax?: number;
  onPointerDown: (e: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (e: PointerEvent<HTMLDivElement>) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  children?: ReactNode;
  className?: string;
};

export function PaneDivider({
  orientation = "vertical",
  ariaLabel = "调整面板宽度",
  ariaValueNow,
  ariaValueMin,
  ariaValueMax,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onKeyDown,
  children,
  className = "",
}: Props) {
  return (
    <div
      className={`pane-divider pane-divider-${orientation}${className ? ` ${className}` : ""}`}
      role="separator"
      aria-orientation={orientation}
      aria-label={ariaLabel}
      aria-valuenow={ariaValueNow}
      aria-valuemin={ariaValueMin}
      aria-valuemax={ariaValueMax}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}
