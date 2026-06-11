export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "openx.theme";

export function loadThemePreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    /* ignore */
  }
  return "system";
}

export function saveThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    /* ignore */
  }
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "light" || preference === "dark") return preference;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyResolvedTheme(resolved: ResolvedTheme): void {
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

export function applyThemePreference(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference);
  applyResolvedTheme(resolved);
  return resolved;
}

let systemListener: ((e: MediaQueryListEvent) => void) | null = null;

export function initTheme(): ResolvedTheme {
  const preference = loadThemePreference();
  const resolved = applyThemePreference(preference);
  bindSystemThemeListener(preference);
  return resolved;
}

export function setThemePreference(preference: ThemePreference): ResolvedTheme {
  saveThemePreference(preference);
  const resolved = applyThemePreference(preference);
  bindSystemThemeListener(preference);
  return resolved;
}

function bindSystemThemeListener(preference: ThemePreference): void {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  if (systemListener) {
    mq.removeEventListener("change", systemListener);
    systemListener = null;
  }
  if (preference !== "system") return;
  systemListener = () => applyThemePreference("system");
  mq.addEventListener("change", systemListener);
}
