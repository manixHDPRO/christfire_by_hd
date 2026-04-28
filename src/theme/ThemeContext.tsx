import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  applyThemeToDocument,
  readStoredTheme,
  type ThemePreference,
  shouldUseDarkClass,
  writeStoredTheme,
} from "./themeStorage";

type ThemeContextValue = {
  preference: ThemePreference;
  /** Thème réellement affiché après résolution (système inclus). */
  resolvedDark: boolean;
  setPreference: (p: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const DEFAULT_PREFERENCE: ThemePreference = "dark";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => readStoredTheme() ?? DEFAULT_PREFERENCE);
  const [resolvedDark, setResolvedDark] = useState(() => shouldUseDarkClass(readStoredTheme() ?? DEFAULT_PREFERENCE));

  useEffect(() => {
    applyThemeToDocument(preference);
    setResolvedDark(shouldUseDarkClass(preference));
  }, [preference]);

  useEffect(() => {
    if (preference !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      applyThemeToDocument("system");
      setResolvedDark(mq.matches);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [preference]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== "hd_christfire_theme" || !e.newValue) return;
      if (e.newValue !== "dark" && e.newValue !== "light" && e.newValue !== "system") return;
      setPreferenceState(e.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setPreference = useCallback((p: ThemePreference) => {
    writeStoredTheme(p);
    setPreferenceState(p);
  }, []);

  const value = useMemo(
    () => ({
      preference,
      resolvedDark,
      setPreference,
    }),
    [preference, resolvedDark, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme doit être utilisé dans un ThemeProvider");
  return ctx;
}
