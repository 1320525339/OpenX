import { useEffect, useState } from "react";

const DEFAULT_BREAKPOINT = 1280;

export function useWideKanban(breakpoint = DEFAULT_BREAKPOINT): boolean {
  const [wide, setWide] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia(`(min-width: ${breakpoint}px)`).matches;
  });

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${breakpoint}px)`);
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [breakpoint]);

  return wide;
}
