// Hearth v2: what a person picks in Appearance settings is a *preference*,
// not a theme id. "system" (the default) follows the device's light/dark
// setting and resolves to the Ember pair; any concrete ThemeId pins it.
// Both apps resolve through here so web and native can never disagree on
// which theme "follow the device" means.
import { THEME_IDS, type ThemeId } from './theme-colors';

export type ThemePreference = 'system' | ThemeId;

export type ColorScheme = 'light' | 'dark';

export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';

/** The theme "system" resolves to for each device color scheme. */
export const SYSTEM_THEME_IDS: Record<ColorScheme, ThemeId> = {
  light: 'ember-day',
  dark: 'ember-night',
};

/**
 * Storage key for the preference on both platforms. Deliberately not the
 * pre-v2 `homeup-theme` key: that one only ever held an Axis Mundi id, and
 * starting fresh moved everyone onto the redesign's default ("system").
 */
export const THEME_PREFERENCE_STORAGE_KEY = 'homeup-theme-pref';

/** Themes whose ground is light (dark status-bar icons, no `.dark` class on web). */
export const LIGHT_THEME_IDS: readonly ThemeId[] = ['ember-day', 'e-ink', 'sorbet-day', 'lavender-day'];

/**
 * Themes for e-paper screens: flat (no glow, shadow or blur), greyscale
 * section tiles, and still (every transition is instant, no tab glide).
 * Both apps gate on isStillTheme rather than naming the id.
 */
export const STILL_THEME_IDS: readonly ThemeId[] = ['e-ink'];

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value);
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || isThemeId(value);
}

/** A stored value that is missing, stale or garbage falls back to the default preference. */
export function parseThemePreference(value: unknown): ThemePreference {
  return isThemePreference(value) ? value : DEFAULT_THEME_PREFERENCE;
}

/** The concrete theme a preference paints with, given the device's current scheme (null/unknown = light). */
export function resolveThemePreference(preference: ThemePreference, scheme: ColorScheme | null | undefined): ThemeId {
  if (preference !== 'system') return preference;
  return SYSTEM_THEME_IDS[scheme === 'dark' ? 'dark' : 'light'];
}

export function isLightTheme(themeId: ThemeId): boolean {
  return LIGHT_THEME_IDS.includes(themeId);
}

export function isStillTheme(themeId: ThemeId): boolean {
  return STILL_THEME_IDS.includes(themeId);
}
