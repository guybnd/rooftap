import { describe, expect, it } from 'vitest';
import { THEME_TOKENS } from '@homeup/core';
import { resolveBoxShadowOklch, resolveOklchToRgba, resolveOklchToRgbTriplet } from './resolve-color';
import { themeMaterial, themeVars } from './theme-vars';

describe('resolveOklchToRgbTriplet', () => {
  it('resolves every color token of every theme without throwing (no unparsable oklch strings)', () => {
    for (const tokens of Object.values(THEME_TOKENS)) {
      for (const oklch of Object.values(tokens.colors)) {
        expect(() => resolveOklchToRgbTriplet(oklch)).not.toThrow();
      }
    }
  });

  it('drops intrinsic alpha from the triplet (Tailwind\'s <alpha-value> owns alpha at the usage site)', () => {
    const triplet = resolveOklchToRgbTriplet('oklch(0.18 0.005 255 / 0.65)');
    expect(triplet.split(' ')).toHaveLength(3);
    expect(triplet).not.toContain('/');
  });
});

describe('themeVars', () => {
  it('produces one --color-* var per THEME_COLOR_KEYS entry plus the 4 radius vars, memoized per theme', () => {
    const vars = themeVars('axis-mundi-night');
    const colorKeys = Object.keys(vars).filter((k) => k.startsWith('--color-'));
    expect(colorKeys).toHaveLength(Object.keys(THEME_TOKENS['axis-mundi-night'].colors).length);
    expect(vars['--radius-sm']).toBeDefined();
    expect(vars['--radius-lg']).toBeDefined();
    // Same object reference on a second call for the same theme id (cache hit).
    expect(themeVars('axis-mundi-night')).toBe(vars);
  });

  it('emits the material vars alpha-preserved', () => {
    const vars = themeVars('axis-mundi-night');
    // Axis Night's --card-shadow: "0 1px 0 oklch(0.08 0.01 300 / 0.6), 0 3px 10px oklch(0 0 0 / 0.4)"
    // — both oklch layers rewritten to comma-rgba with their alphas intact.
    expect(vars['--card-shadow']).toMatch(
      /^0 1px 0 rgba\(\d+, \d+, \d+, 0\.6\), 0 3px 10px rgba\(0, 0, 0, 0\.4\)$/
    );
    // --glass-bg: "oklch(0.215 0.016 297 / 1)" — alpha survives, unlike resolveOklchToRgbTriplet.
    expect(vars['--glass-bg']).toMatch(/^rgba\(\d+, \d+, \d+, 1\)$/);
    expect(vars['--texture-opacity']).toBe('0');
  });
});

describe('resolveOklchToRgba (HOUP-132)', () => {
  it('preserves intrinsic alpha as the comma rgba(...) form', () => {
    expect(resolveOklchToRgba('oklch(0.18 0.005 255 / 0.65)')).toMatch(/^rgba\(\d+, \d+, \d+, 0\.65\)$/);
  });

  it('defaults alpha to 1 when the token carries none', () => {
    expect(resolveOklchToRgba('oklch(1 0 0)')).toBe('rgba(255, 255, 255, 1)');
  });
});

describe('resolveBoxShadowOklch (HOUP-132)', () => {
  it('rewrites every embedded oklch(...) layer, leaving offsets/blur/inset untouched', () => {
    const input = '0 2px 12px oklch(0 0 0 / 0.4), inset 0 1px 0 oklch(1 0 0 / 0.03)';
    const resolved = resolveBoxShadowOklch(input);
    expect(resolved).toBe('0 2px 12px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.03)');
    expect(resolved).not.toContain('oklch');
  });

  it('passes "none" through unchanged (a shadowless theme stays shadowless)', () => {
    expect(resolveBoxShadowOklch('none')).toBe('none');
  });

  it('resolves every theme\'s cardShadow without throwing', () => {
    for (const tokens of Object.values(THEME_TOKENS)) {
      expect(() => resolveBoxShadowOklch(tokens.material.cardShadow)).not.toThrow();
    }
  });
});

describe('themeMaterial (HOUP-132)', () => {
  it('is a no-op background texture for both axis-mundi themes (kind "none")', () => {
    expect(themeMaterial('axis-mundi-night').textureKind).toBe('none');
    expect(themeMaterial('axis-mundi-night').textureOpacity).toBe(0);
    expect(themeMaterial('axis-mundi-day').textureKind).toBe('none');
  });

  it('formats textureColor as a comma rgb(...) string every theme can consume', () => {
    for (const themeId of Object.keys(THEME_TOKENS) as Array<keyof typeof THEME_TOKENS>) {
      expect(themeMaterial(themeId).textureColor).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    }
  });

  it('HOUP-171: axisColor resolves for both axis-mundi themes and is null under Ember (no meridian)', () => {
    expect(themeMaterial('axis-mundi-day').axisColor).toMatch(/^rgba\(\d+, \d+, \d+, 1\)$/);
    expect(themeMaterial('axis-mundi-night').axisColor).toMatch(/^rgba\(\d+, \d+, \d+, 1\)$/);
    expect(themeMaterial('ember-day').axisColor).toBeNull();
    expect(themeMaterial('ember-night').axisColor).toBeNull();
  });

  it('HOUP-199: statusBarStyle tracks background lightness — dark icons by day, light by night', () => {
    expect(themeMaterial('axis-mundi-day').statusBarStyle).toBe('dark');
    expect(themeMaterial('axis-mundi-night').statusBarStyle).toBe('light');
    expect(themeMaterial('ember-day').statusBarStyle).toBe('dark');
    expect(themeMaterial('ember-night').statusBarStyle).toBe('light');
  });

  it('Hearth v2: picks the section-hue scheme from the ground and glows only under Ember', () => {
    expect(themeMaterial('ember-day').scheme).toBe('light');
    expect(themeMaterial('ember-night').scheme).toBe('dark');
    expect(themeMaterial('axis-mundi-night').scheme).toBe('dark');
    expect(themeMaterial('ember-day').sectionGlow).toBe(true);
    expect(themeMaterial('ember-night').sectionGlow).toBe(true);
    expect(themeMaterial('axis-mundi-day').sectionGlow).toBe(false);
    expect(themeMaterial('axis-mundi-night').sectionGlow).toBe(false);
  });

  it('E-Ink: grey hue scheme, no glow, still motion, dark status bar icons', () => {
    const ink = themeMaterial('e-ink');
    expect(ink.scheme).toBe('ink');
    expect(ink.sectionGlow).toBe(false);
    expect(ink.still).toBe(true);
    expect(ink.statusBarStyle).toBe('dark');
    expect(ink.cardShadow).toBe('none');
    expect(themeMaterial('ember-day').still).toBe(false);
  });

  it('Sorbet and Lavender: wear their own hue set, keeps the glow, Fredoka on the Hero', () => {
    expect(themeMaterial('sorbet-day').scheme).toBe('sorbet-day');
    expect(themeMaterial('sorbet-night').scheme).toBe('sorbet-night');
    expect(themeMaterial('sorbet-day').sectionGlow).toBe(true);
    expect(themeMaterial('sorbet-day').statusBarStyle).toBe('dark');
    expect(themeMaterial('sorbet-night').statusBarStyle).toBe('light');
    expect(themeVars('sorbet-day')['--font-hero']).toBe('Fredoka_700Bold');
    expect(themeVars('lavender-night')['--font-hero']).toBe('Fraunces_700Bold');
    expect(themeMaterial('lavender-day').scheme).toBe('lavender-day');
    expect(themeVars('ember-day')['--font-hero']).toBe('BricolageGrotesque_800ExtraBold');
  });

  it('formats background as a comma rgb(...) string matching --color-background', () => {
    for (const themeId of Object.keys(THEME_TOKENS) as Array<keyof typeof THEME_TOKENS>) {
      const [r, g, b] = themeVars(themeId)['--color-background'].split(' ');
      expect(themeMaterial(themeId).background).toBe(`rgb(${r}, ${g}, ${b})`);
    }
  });
});

describe('themeVars --font-inscription (HOUP-170 web-parity contract)', () => {
  // Mirrors web's `[data-theme="axis-mundi-night"|"axis-mundi-day"] .cap-inscription`
  // gating (apps/web/src/app/globals.css) — Cinzel under the Axis Mundi themes,
  // which is the whole roster since HOUP-295.
  it('resolves to Cinzel under both Axis Mundi themes', () => {
    expect(themeVars('axis-mundi-night')['--font-inscription']).toBe('Cinzel_600SemiBold');
    expect(themeVars('axis-mundi-day')['--font-inscription']).toBe('Cinzel_600SemiBold');
  });

  it('falls back to the body face under Ember (Hearth v2 retires inscription capitals)', () => {
    expect(themeVars('ember-night')['--font-inscription']).toBe('Geist_500Medium');
    expect(themeVars('ember-day')['--font-inscription']).toBe('Geist_500Medium');
  });
});
