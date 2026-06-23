import { createContext, useContext, type ReactNode } from "react";
import { useThemeRipple } from "./use-theme-ripple";
import type { ThemePreference } from "./theme";
import type { ThemeTransitionRequest } from "./use-theme-ripple";

type ThemeRippleContextValue = {
  preference: ThemePreference;
  changeWithRipple: (request: ThemeTransitionRequest) => void;
  setPreference: (preference: ThemePreference) => void;
  rippleLayer: ReactNode;
};

const ThemeRippleContext = createContext<ThemeRippleContextValue | null>(null);

export function ThemeRippleProvider({ children }: { children: ReactNode }) {
  const ripple = useThemeRipple();
  return (
    <ThemeRippleContext.Provider value={ripple}>
      {children}
      {ripple.rippleLayer}
    </ThemeRippleContext.Provider>
  );
}

export function useThemeRippleContext(): ThemeRippleContextValue | null {
  return useContext(ThemeRippleContext);
}
