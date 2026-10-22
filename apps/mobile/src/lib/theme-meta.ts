// HOUP-84: display metadata (name/description/accent swatch) for the
// Appearance settings panel — mirrors apps/web/src/lib/themes.ts verbatim.
// Kept as a small per-platform data duplicate (same pattern as
// apps/mobile/src/lib/section-icons.ts from HOUP-74) rather than moved into
// @homeup/core: it's the same category of "web-local display data" the
// settings-registry itself stays app-level for (see HOUP-84 Decision 4).
import { preferenceFamily, preferenceMode, familyHasModes, type ThemeFamilyId, type ThemeMode, type ThemePreference } from '@homeup/core';

export interface ThemeMeta {
  id: ThemeFamilyId;
  name: string;
  description: string;
  /** Swatch fill(s); two values draw a split swatch (light | dark). */
  accent: string | [string, string];
}

// Hearth v2: Appearance lists theme families, and a Light / Dark / Auto
// switch picks the variant (core theme-preference.ts). Ember on Auto is the default.
export const themeMeta: ThemeMeta[] = [
  { id: 'ember', name: 'Ember', description: 'Warm paper and ink, one coral accent', accent: ['#C8462A', '#FF7A5C'] },
  { id: 'sorbet', name: 'Sorbet', description: 'Gummy pastels and a mango accent', accent: ['#F28A2E', '#FFA33E'] },
  { id: 'lavender', name: 'Lavender', description: 'Lilac mist and plum dusk, a violet accent', accent: ['#7B57C8', '#CAACFF'] },
  { id: 'e-ink', name: 'E-Ink', description: 'Flat greys and no motion, for e-paper screens', accent: '#1A1A1A' },
];

export const themeModes: { value: ThemeMode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function themeMetaFor(id: ThemeFamilyId): ThemeMeta | undefined {
  return themeMeta.find((t) => t.id === id);
}

/** "Sorbet, Auto": the Settings row's current value. A one-variant family shows its name only. */
export function themePreferenceLabel(preference: ThemePreference): string {
  const family = preferenceFamily(preference);
  const name = themeMetaFor(family)?.name ?? family;
  if (!familyHasModes(family)) return name;
  const mode = themeModes.find((m) => m.value === preferenceMode(preference))?.label;
  return mode ? `${name}, ${mode}` : name;
}
