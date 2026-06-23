import { useEffect } from "react";
import type { AppView } from "../components/SideNav";

/** 视图切换后延迟触发清理回调，模拟 QRoundedFrame settled trim */
export function useViewSettledCleanup(
  view: AppView,
  onSettled: () => void,
  delayMs = 450,
) {
  useEffect(() => {
    const timer = window.setTimeout(onSettled, delayMs);
    return () => window.clearTimeout(timer);
  }, [view, onSettled, delayMs]);
}
