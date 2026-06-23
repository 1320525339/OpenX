export type ThemePreference = "light" | "dark" | "system" | "geek";
export type ResolvedTheme = "light" | "dark" | "geek";

const STORAGE_KEY = "openx.theme";
const ACCENT_LIGHT_KEY = "openx.theme.accent.light";
const ACCENT_DARK_KEY = "openx.theme.accent.dark";
const ACCENT_GEEK_KEY = "openx.theme.accent.geek";

const DEFAULT_ACCENTS: Record<ResolvedTheme, string> = {
  light: "#3b82f6",
  dark: "#60a5fa",
  geek: "#22c55e",
};

export function loadThemePreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system" || raw === "geek") return raw;
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

export function loadThemeAccent(resolved: ResolvedTheme): string {
  const key =
    resolved === "light"
      ? ACCENT_LIGHT_KEY
      : resolved === "geek"
        ? ACCENT_GEEK_KEY
        : ACCENT_DARK_KEY;
  try {
    const raw = localStorage.getItem(key);
    if (raw && /^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
  } catch {
    /* ignore */
  }
  return DEFAULT_ACCENTS[resolved];
}

export function saveThemeAccent(resolved: ResolvedTheme, color: string): void {
  const key =
    resolved === "light"
      ? ACCENT_LIGHT_KEY
      : resolved === "geek"
        ? ACCENT_GEEK_KEY
        : ACCENT_DARK_KEY;
  try {
    localStorage.setItem(key, color);
  } catch {
    /* ignore */
  }
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "light" || preference === "dark" || preference === "geek") return preference;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** 供 index.html 内联脚本使用的首屏主题解析（无 geek 以外的 system 分支） */
export function resolveBootTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "light" || preference === "dark" || preference === "geek") return preference;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyResolvedTheme(resolved: ResolvedTheme): void {
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved === "light" ? "light" : "dark";
  document.documentElement.style.setProperty("--accent", loadThemeAccent(resolved));
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
