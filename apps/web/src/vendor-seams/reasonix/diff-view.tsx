import { lazy, Suspense } from "react";
import type { ReasonixHljsDiffProps } from "./hljs-diff";

/**
 * 来源：vendors/reasonix/desktop/frontend/src/components/DiffView.tsx
 * lazy 加载 hljs diff 模块，避免 RunConsole 首屏 bundle 膨胀。
 */
const Impl = lazy(() => import("./hljs-diff"));

export function ReasonixDiffView(props: ReasonixHljsDiffProps) {
  return (
    <Suspense fallback={<pre className="tool-diff-body tool-diff-loading">{props.rows[0]?.text ?? ""}</pre>}>
      <Impl {...props} />
    </Suspense>
  );
}
