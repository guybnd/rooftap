// HOUP-84: native counterpart of apps/web's src/components/theme-provider.tsx
// — adds the missing stateful/persisted layer on top of @homeup/ui's
// ThemeProvider (HOUP-68), which only accepts a static `themeId` prop and
// exposes no context/hook (see that file's own header comment). This does
// NOT rebuild ThemeProvider — it wraps it, loading/saving the chosen
// ThemePreference via expo-secure-store (mirroring web's localStorage) and exposing
// a useAppTheme() hook so the Appearance settings panel can switch themes.
import * as React from 'react';
import { useColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider, type Theme } from 'expo-router';
import { ThemeProvider, useThemeMaterial } from '@homeup/ui';
import {
  DEFAULT_THEME_PREFERENCE,
  THEME_PREFERENCE_STORAGE_KEY,
  parseThemePreference,
  resolveThemePreference,
  type ThemeId,
  type ThemePreference,
} from '@homeup/core';
import { nativeStoreEnvironment } from './legend/environment';

// Hearth v2: what Appearance settings stores is a preference: a theme family
// plus Light, Dark or Auto (Auto follows the phone's light/dark setting via
// useColorScheme). `themeId` is what that resolves to right now.
interface AppThemeContextValue {
  preference: ThemePreference;
  themeId: ThemeId;
  setPreference: (preference: ThemePreference) => void;
}

const AppThemeContext = React.createContext<AppThemeContextValue>({
  preference: DEFAULT_THEME_PREFERENCE,
  themeId: resolveThemePreference(DEFAULT_THEME_PREFERENCE, 'light'),
  setPreference: () => {},
});

export function useAppTheme(): AppThemeContextValue {
  return React.useContext(AppThemeContext);
}

// HOUP-199: edge-to-edge is on by default (no `androidStatusBar` config) —
// `ScreenBackground` already paints full-bleed under the transparent status
// bar, so only icon contrast needs driving per theme. Mounted inside
// ThemeProvider (below) so useThemeMaterial() resolves the live theme's
// derived `statusBarStyle`, and re-renders it on every theme switch.
function StatusBarSync() {
  const material = useThemeMaterial();
  return <StatusBar style={material.statusBarStyle} />;
}

// White-flash fix: React Navigation paints every navigator container and
// screen with its own theme, which defaults to a near-white light theme, and
// Android paints the window behind the app white unless told otherwise.
// Either one showed through for a moment whenever a screen mounted before
// drawing, e.g. the first frames after the splash. Both now take the Rooftap
// theme's background.
function NavigationThemeSync({ children }: { children: React.ReactNode }) {
  const material = useThemeMaterial();
  React.useEffect(() => {
    SystemUI.setBackgroundColorAsync(material.background).catch(() => {});
  }, [material.background]);
  const theme = React.useMemo<Theme>(() => {
    const base = material.statusBarStyle === 'light' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: { ...base.colors, background: material.background, card: material.background },
    };
  }, [material.background, material.statusBarStyle]);
  return <NavigationThemeProvider value={theme}>{children}</NavigationThemeProvider>;
}

// Cold-start fix: the preference is mirrored into the synchronous SQLite
// kv-store and read in the useState initializer, so the first frame is
// already the right theme (an async-only SecureStore read flashed the default
// theme on every launch). SecureStore stays the fallback for a mirror that
// failed to write. useColorScheme() is synchronous too, so Auto also
// paints correctly on the first frame.
function readMirroredPreference(): ThemePreference | null {
  try {
    // A value from before the Light/Dark/Auto switch parses too (core parseThemePreference).
    const stored = nativeStoreEnvironment.keyValue.getItem(THEME_PREFERENCE_STORAGE_KEY);
    return stored ? parseThemePreference(stored) : null;
  } catch {
    return null;
  }
}

function mirrorPreference(preference: ThemePreference): void {
  try {
    nativeStoreEnvironment.keyValue.setItem(THEME_PREFERENCE_STORAGE_KEY, preference);
  } catch {
    // kv-store unavailable — SecureStore still has it, at the cost of a flash.
  }
}

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const [mirrored] = React.useState(readMirroredPreference);
  const [preference, setPreferenceState] = React.useState<ThemePreference>(mirrored ?? DEFAULT_THEME_PREFERENCE);
  const scheme = useColorScheme();

  React.useEffect(() => {
    if (mirrored) return;
    let cancelled = false;
    SecureStore.getItemAsync(THEME_PREFERENCE_STORAGE_KEY).then((stored) => {
      if (cancelled || !stored) return;
      const parsed = parseThemePreference(stored);
      setPreferenceState(parsed);
      mirrorPreference(parsed);
    });
    return () => {
      cancelled = true;
    };
  }, [mirrored]);

  const setPreference = React.useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    mirrorPreference(next);
    SecureStore.setItemAsync(THEME_PREFERENCE_STORAGE_KEY, next).catch(() => {
      // Storage unavailable — theme still applies for this session.
    });
  }, []);

  const themeId = resolveThemePreference(preference, scheme === 'dark' ? 'dark' : 'light');
  const value = React.useMemo(() => ({ preference, themeId, setPreference }), [preference, themeId, setPreference]);

  return (
    <AppThemeContext.Provider value={value}>
      <ThemeProvider themeId={themeId}>
        <StatusBarSync />
        <NavigationThemeSync>{children}</NavigationThemeSync>
      </ThemeProvider>
    </AppThemeContext.Provider>
  );
}
