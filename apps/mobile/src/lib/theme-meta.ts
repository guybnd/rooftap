// HOUP-84: display metadata (name/description/accent swatch) for the
// Appearance settings panel — mirrors apps/web/src/lib/themes.ts's ThemeMeta
// list verbatim. Kept as a small per-platform data duplicate (same pattern as
// apps/mobile/src/lib/section-icons.ts from HOUP-74) rather than moved into
// @homeup/core: it's the same category of "web-local display data" the
// settings-registry itself stays app-level for (see HOUP-84 Decision 4).
import type { ThemePreference } from '@homeup/core';

export interface ThemeMeta {
  id: ThemePreference;
  name: string;
  description: string;
  /** Swatch fill(s); two values draw a split swatch (light | dark). */
  accent: string | [string, string];
}

// Hearth v2: "Match device" (Ember Day/Night) is the default; the Axis Mundi
// pair (HOUP-295) stays selectable.
export const themeMeta: ThemeMeta[] = [
  { id: 'system', name: 'Match device', description: 'Ember Day or Night, set by your device', accent: ['#F6F3EF', '#121016'] },
  { id: 'ember-day', name: 'Ember Day', description: 'Warm paper, one coral accent', accent: '#C8462A' },
  { id: 'ember-night', name: 'Ember Night', description: 'Warm ink with a coral glow', accent: '#FF7A5C' },
  { id: 'axis-mundi-day', name: 'Axis Day', description: 'Sunlit limestone and deep gilt', accent: '#a87a1f' },
  { id: 'axis-mundi-night', name: 'Axis Night', description: 'Cut basalt, gilt and working blue', accent: '#d9a441' },
];

export function themeMetaFor(id: ThemePreference): ThemeMeta | undefined {
  return themeMeta.find((t) => t.id === id);
}
