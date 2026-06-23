import { useCallback, useState } from "react";
import { ThemeRippleLayer } from "../components/ThemeRippleLayer";
import {
  loadThemePreference,
  resolveTheme,
  setThemePreference as persistThemePreference,
  type ResolvedTheme,
  type ThemePreference,
} from "./theme";

export type ThemeTransitionRequest = {
  preference: ThemePreference;
  originX: number;
  originY: number;
};

let visualTransitionActive = false;

export function isThemeTransitionActive(): boolean {
  return visualTransitionActive;
}

export function beginThemeTransition(): void {
  visualTransitionActive = true;
}

export function endThemeTransition(): void {
  visualTransitionActive = false;
}

export function useThemeRipple() {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    loadThemePreference(),
  );
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    resolveTheme(loadThemePreference()),
  );
  const [ripple, setRipple] = useState<{
    active: boolean;
    originX: number;
    originY: number;
    next: ResolvedTheme;
  } | null>(null);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    const resolvedNext = persistThemePreference(next);
    setResolved(resolvedNext);
    return resolvedNext;
  }, []);

  const changeWithRipple = useCallback(
    (request: ThemeTransitionRequest) => {
      const nextResolved = resolveTheme(request.preference);
      if (nextResolved === resolved && request.preference === preference) {
        setPreference(request.preference);
        return;
      }
      beginThemeTransition();
      setRipple({
        active: true,
        originX: request.originX,
        originY: request.originY,
        next: nextResolved,
      });
      const lowMemory = document.documentElement.dataset.lowMemory === "true";
      window.setTimeout(() => {
        setPreferenceState(request.preference);
        const applied = persistThemePreference(request.preference);
        setResolved(applied);
      }, lowMemory ? 120 : 180);
    },
    [preference, resolved, setPreference],
  );

  const rippleLayer =
    ripple?.active ? (
      <ThemeRippleLayer
        active
        originX={ripple.originX}
        originY={ripple.originY}
        mode={ripple.next}
        lowMemory={document.documentElement.dataset.lowMemory === "true"}
        onComplete={() => {
          endThemeTransition();
          setRipple(null);
        }}
      />
    ) : null;

  return { preference, resolved, setPreference, changeWithRipple, rippleLayer };
}
