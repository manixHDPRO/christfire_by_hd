export const THEME_STORAGE_KEY = "hd_christfire_theme";

export type ThemePreference = "dark" | "light" | "system";

export function readStoredTheme(): ThemePreference | null {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (v === "dark" || v === "light" || v === "system") return v;
  } catch {
    /* private mode, etc. */
  }
  return null;
}

export function writeStoredTheme(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    /* ignore */
  }
}

/** `true` = appliquer la classe `dark` sur &lt;html&gt; (thème actuel de l’app). */
export function shouldUseDarkClass(preference: ThemePreference): boolean {
  if (preference === "dark") return true;
  if (preference === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyThemeToDocument(preference: ThemePreference): void {
  const dark = shouldUseDarkClass(preference);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}
