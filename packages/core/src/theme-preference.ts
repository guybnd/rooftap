// Hearth v2: what a person picks in Appearance settings is a *preference*,
// not a theme id: a theme family (Ember, Sorbet, Lavender, E-Ink) plus a
// mode, Light, Dark or Auto. Auto follows the device's light/dark setting.
// The mode applies to whichever family is picked; a family with one variant
// (E-Ink) wears it in every mode. Both apps resolve through here so web and
// native can never disagree on which theme a preference paints with.
import { THEME_IDS, type ThemeId } from './theme-colors';

export type ColorScheme = 'light' | 'dark';

export type ThemeFamilyId = 'ember' | 'sorbet' | 'lavender' | 'e-ink';

export type ThemeMode = 'auto' | 'light' | 'dark';

/** Stored as one string, `family:mode`, e.g. `ember:auto`. */
export type ThemePreference = `${ThemeFamilyId}:${ThemeMode}`;

export interface ThemeFamily {
  id: ThemeFamilyId;
  /** The variant for each scheme. A single-variant family names it twice. */
  variants: Record<ColorScheme, ThemeId>;
}

export const THEME_FAMILIES: readonly ThemeFamily[] = [
  { id: 'ember', variants: { light: 'ember-day', dark: 'ember-night' } },
  { id: 'sorbet', variants: { light: 'sorbet-day', dark: 'sorbet-night' } },
  { id: 'lavender', variants: { light: 'lavender-day', dark: 'lavender-night' } },
  { id: 'e-ink', variants: { light: 'e-ink', dark: 'e-ink' } },
];

export const THEME_MODES: readonly ThemeMode[] = ['auto', 'light', 'dark'];

export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'ember:auto';

/** The theme the default preference resolves to for each device color scheme. */
export const SYSTEM_THEME_IDS: Record<ColorScheme, ThemeId> = {
  light: 'ember-day',
  dark: 'ember-night',
};

/**
 * Storage key for the preference on both platforms. Deliberately not the
 * pre-v2 `homeup-theme` key: that one only ever held an Axis Mundi id, and
 * starting fresh moved everyone onto the redesign's default.
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

export function themeFamily(id: ThemeFamilyId): ThemeFamily {
  return THEME_FAMILIES.find((f) => f.id === id) ?? THEME_FAMILIES[0];
}

/** The family a theme id belongs to. */
export function familyOfTheme(themeId: ThemeId): ThemeFamily {
  return THEME_FAMILIES.find((f) => f.variants.light === themeId || f.variants.dark === themeId) ?? THEME_FAMILIES[0];
}

/** True when the family's light and dark variants differ, so the mode switch means something. */
export function familyHasModes(id: ThemeFamilyId): boolean {
  const { variants } = themeFamily(id);
  return variants.light !== variants.dark;
}

export function themePreference(family: ThemeFamilyId, mode: ThemeMode): ThemePreference {
  return `${family}:${mode}`;
}

export function preferenceFamily(preference: ThemePreference): ThemeFamilyId {
  return preference.slice(0, preference.indexOf(':')) as ThemeFamilyId;
}

export function preferenceMode(preference: ThemePreference): ThemeMode {
  return preference.slice(preference.indexOf(':') + 1) as ThemeMode;
}

export function isThemePreference(value: unknown): value is ThemePreference {
  if (typeof value !== 'string') return false;
  const [family, mode, extra] = value.split(':');
  return (
    extra === undefined &&
    THEME_FAMILIES.some((f) => f.id === family) &&
    (THEME_MODES as readonly string[]).includes(mode)
  );
}

/**
 * Reads a stored value. Values from before the mode switch still parse:
 * `system` was Ember on Auto, and a pinned theme id keeps its family with
 * the mode its ground had. Anything missing, stale (a retired theme) or
 * garbage falls back to the default.
 */
export function parseThemePreference(value: unknown): ThemePreference {
  if (isThemePreference(value)) return value;
  if (value === 'system') return DEFAULT_THEME_PREFERENCE;
  if (isThemeId(value)) {
    const family = familyOfTheme(value);
    if (!familyHasModes(family.id)) return themePreference(family.id, 'auto');
    return themePreference(family.id, family.variants.light === value ? 'light' : 'dark');
  }
  return DEFAULT_THEME_PREFERENCE;
}

/** The concrete theme a preference paints with, given the device's current scheme (null/unknown = light). */
export function resolveThemePreference(preference: ThemePreference, scheme: ColorScheme | null | undefined): ThemeId {
  const mode = preferenceMode(preference);
  const resolved: ColorScheme = mode === 'auto' ? (scheme === 'dark' ? 'dark' : 'light') : mode;
  return themeFamily(preferenceFamily(preference)).variants[resolved];
}

export function isLightTheme(themeId: ThemeId): boolean {
  return LIGHT_THEME_IDS.includes(themeId);
}

export function isStillTheme(themeId: ThemeId): boolean {
  return STILL_THEME_IDS.includes(themeId);
}
