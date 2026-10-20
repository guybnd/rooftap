"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import {
  DEFAULT_THEME_PREFERENCE,
  THEME_PREFERENCE_STORAGE_KEY,
  isLightTheme,
  parseThemePreference,
  resolveThemePreference,
  type ThemeId,
  type ThemePreference,
} from "@homeup/core";

interface ThemeContext {
  /** What the person picked ("system" follows the device). */
  preference: ThemePreference;
  /** The theme actually painting right now. */
  theme: ThemeId;
  setPreference: (preference: ThemePreference) => void;
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

function deviceScheme(): "light" | "dark" {
  return typeof window !== "undefined" && window.matchMedia?.(DARK_QUERY).matches ? "dark" : "light";
}

const ThemeCtx = createContext<ThemeContext>({
  preference: DEFAULT_THEME_PREFERENCE,
  theme: resolveThemePreference(DEFAULT_THEME_PREFERENCE, "light"),
  setPreference: () => {},
});

function applyTheme(id: ThemeId) {
  document.documentElement.setAttribute("data-theme", id);
  document.documentElement.classList.toggle("dark", !isLightTheme(id));
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(DEFAULT_THEME_PREFERENCE);
  const [scheme, setScheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    setPreferenceState(parseThemePreference(localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY)));
    setScheme(deviceScheme());
    const media = window.matchMedia?.(DARK_QUERY);
    if (!media) return;
    const onChange = () => setScheme(media.matches ? "dark" : "light");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const theme = resolveThemePreference(preference, scheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, next);
  }, []);

  return <ThemeCtx.Provider value={{ preference, theme, setPreference }}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  return useContext(ThemeCtx);
}
