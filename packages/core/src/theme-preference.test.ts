import { describe, expect, it } from 'vitest';
import {
  isLightTheme,
  isStillTheme,
  isThemePreference,
  parseThemePreference,
  resolveThemePreference,
} from './theme-preference';
import { THEME_IDS } from './theme-colors';

describe('theme preference', () => {
  it('follows the device by default', () => {
    expect(parseThemePreference(null)).toBe('system');
    expect(parseThemePreference('obsidian')).toBe('system');
    expect(resolveThemePreference('system', 'dark')).toBe('ember-night');
    expect(resolveThemePreference('system', 'light')).toBe('ember-day');
    expect(resolveThemePreference('system', null)).toBe('ember-day');
  });

  it('pins a concrete theme regardless of the device', () => {
    expect(resolveThemePreference('lavender-night', 'light')).toBe('lavender-night');
    expect(resolveThemePreference('ember-day', 'dark')).toBe('ember-day');
  });

  it('accepts every shipping theme id as a preference', () => {
    for (const id of THEME_IDS) {
      expect(isThemePreference(id)).toBe(true);
      expect(parseThemePreference(id)).toBe(id);
    }
    expect(isThemePreference('system')).toBe(true);
  });

  it('falls back to "system" for a stored Axis Mundi preference (retired theme)', () => {
    expect(parseThemePreference('axis-mundi-day')).toBe('system');
    expect(parseThemePreference('axis-mundi-night')).toBe('system');
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
