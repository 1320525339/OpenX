import type { ReactNode } from "react";

type Props = {
  strip?: ReactNode;
  canvas: ReactNode;
  dock: ReactNode;
  className?: string;
};

/** HyperOS 柔性桌面壳：顶栏 + 三槽画布 + Pin 底栏 */
export function HyperPinDesktop({ strip, canvas, dock, className = "" }: Props) {
  return (
    <div className={`hyper-pin-desktop ${className}`.trim()}>
      {strip}
      <div className="hyper-pin-stage">{canvas}</div>
      {dock}
    </div>
  );
}
