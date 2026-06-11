import { useCallback, useEffect, useState } from "react";
import {
  applyThemePreference,
  loadThemePreference,
  resolveTheme,
  setThemePreference,
  type ResolvedTheme,
  type ThemePreference,
} from "./theme";

export function useTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    loadThemePreference(),
  );
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    resolveTheme(loadThemePreference()),
  );

  useEffect(() => {
    setResolved(applyThemePreference(preference));
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    setResolved(setThemePreference(next));
  }, []);

  return { preference, resolved, setPreference };
}
