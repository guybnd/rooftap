import { describe, expect, it } from 'vitest';
import {
  THEME_FAMILIES,
  familyHasModes,
  isLightTheme,
  isStillTheme,
  isThemePreference,
  parseThemePreference,
  preferenceFamily,
  preferenceMode,
  resolveThemePreference,
  themePreference,
} from './theme-preference';
import { THEME_IDS } from './theme-colors';

describe('theme preference', () => {
  it('follows the device by default', () => {
    expect(parseThemePreference(null)).toBe('ember:auto');
    expect(parseThemePreference('obsidian')).toBe('ember:auto');
    expect(resolveThemePreference('ember:auto', 'dark')).toBe('ember-night');
    expect(resolveThemePreference('ember:auto', 'light')).toBe('ember-day');
    expect(resolveThemePreference('ember:auto', null)).toBe('ember-day');
  });

  it('applies the mode to whichever family is picked', () => {
    expect(resolveThemePreference('sorbet:auto', 'dark')).toBe('sorbet-night');
    expect(resolveThemePreference('sorbet:auto', 'light')).toBe('sorbet-day');
    expect(resolveThemePreference('lavender:dark', 'light')).toBe('lavender-night');
    expect(resolveThemePreference('lavender:light', 'dark')).toBe('lavender-day');
    expect(resolveThemePreference('e-ink:dark', 'dark')).toBe('e-ink');
    expect(familyHasModes('e-ink')).toBe(false);
    expect(familyHasModes('ember')).toBe(true);
  });

  it('every theme id belongs to exactly one family', () => {
    for (const id of THEME_IDS) {
      const owners = THEME_FAMILIES.filter((f) => f.variants.light === id || f.variants.dark === id);
      expect(owners, id).toHaveLength(1);
    }
  });

  it('round-trips a family and mode', () => {
    const pref = themePreference('lavender', 'dark');
    expect(pref).toBe('lavender:dark');
    expect(isThemePreference(pref)).toBe(true);
    expect(preferenceFamily(pref)).toBe('lavender');
    expect(preferenceMode(pref)).toBe('dark');
    expect(isThemePreference('lavender:dusk')).toBe(false);
    expect(isThemePreference('ember-day')).toBe(false);
  });

  it('reads values stored before the mode switch', () => {
    expect(parseThemePreference('system')).toBe('ember:auto');
    expect(parseThemePreference('ember-night')).toBe('ember:dark');
    expect(parseThemePreference('sorbet-day')).toBe('sorbet:light');
    expect(parseThemePreference('lavender-night')).toBe('lavender:dark');
    expect(parseThemePreference('e-ink')).toBe('e-ink:auto');
  });

  it('falls back to the default for a stored Axis Mundi preference (retired theme)', () => {
    expect(parseThemePreference('axis-mundi-day')).toBe('ember:auto');
    expect(parseThemePreference('axis-mundi-night')).toBe('ember:auto');
  });

  it('knows which themes are light', () => {
    expect(isLightTheme('ember-day')).toBe(true);
    expect(isLightTheme('ember-night')).toBe(false);
    expect(isLightTheme('e-ink')).toBe(true);
    expect(isLightTheme('sorbet-day')).toBe(true);
    expect(isLightTheme('sorbet-night')).toBe(false);
  });

  it('keeps motion still only under the e-paper theme', () => {
    expect(isStillTheme('e-ink')).toBe(true);
    for (const id of THEME_IDS.filter((t) => t !== 'e-ink')) expect(isStillTheme(id), id).toBe(false);
  });
});
