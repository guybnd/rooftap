// HOUP-68: injects a theme's resolved CSS custom properties via NativeWind's
// `vars()` so every descendant's `bg-primary` / `text-foreground` / etc.
// (declared as `var(--color-x)` in ../../tailwind-preset.js) resolves.
//
// Decision 2 (original plan, updated by HOUP-295 and Hearth v2): the static
// fallback is Ember Day — `DEFAULT_THEME_ID` below is the ONE place it lives.
// The app's real default is the "system" preference (apps/mobile's
// theme-context resolves it via @homeup/core's resolveThemePreference).
// `themeId` is swappable per-render (src/lib/theme-context.tsx in apps/mobile
// wraps this with a stateful/persisted theme switcher).
//
// HOUP-132: also provides the resolved material tokens (card shadow, glass
// edges, background texture) to descendants via useThemeMaterial(), and
// mounts the shared BackgroundTexture overlay once here so every themed
// subtree gets it for free.
import * as React from 'react';
import { View, type ViewProps } from 'react-native';
import { vars } from 'nativewind';
import type { ThemeId } from '@homeup/core';
import { BackgroundTexture } from '../components/background-texture';
import { themeMaterial, themeVars, type ResolvedThemeMaterial } from './theme-vars';

export const DEFAULT_THEME_ID: ThemeId = 'ember-day';

const ThemeMaterialContext = React.createContext<ResolvedThemeMaterial>(themeMaterial(DEFAULT_THEME_ID));

/** The active theme's resolved material tokens — card shadow, glass edges, background texture. */
export function useThemeMaterial(): ResolvedThemeMaterial {
  return React.useContext(ThemeMaterialContext);
}

export interface ThemeProviderProps extends ViewProps {
  themeId?: ThemeId;
  children: React.ReactNode;
}

export function ThemeProvider({ themeId = DEFAULT_THEME_ID, style, children, ...props }: ThemeProviderProps) {
  const themeStyle = React.useMemo(() => vars(themeVars(themeId)), [themeId]);
  const material = React.useMemo(() => themeMaterial(themeId), [themeId]);
  return (
    // Painted here too, not only by each screen's ScreenBackground: anything
    // that shows through before a screen draws (a navigator container, a
    // lazily mounted tab) then lands on the theme, not on white.
    <View style={[{ flex: 1, backgroundColor: material.background }, themeStyle, style]} {...props}>
      <ThemeMaterialContext.Provider value={material}>
        <BackgroundTexture kind={material.textureKind} opacity={material.textureOpacity} color={material.textureColor} />
        {children}
      </ThemeMaterialContext.Provider>
    </View>
  );
}
