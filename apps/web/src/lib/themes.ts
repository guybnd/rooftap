// Hearth v2: Appearance lists theme families, and a Light / Dark / Auto
// switch picks the variant (core theme-preference.ts). Ember is the default,
// on Auto. Preference parsing and resolution live in @homeup/core so web and
// native agree on it; this file is only display metadata.
import { familyHasModes, preferenceFamily, preferenceMode, type ThemeFamilyId, type ThemeId, type ThemeMode, type ThemePreference } from "@homeup/core";

export type { ThemeId, ThemePreference };

export interface ThemeMeta {
  id: ThemeFamilyId;
  name: string;
  description: string;
  /** Swatch fill(s); two values draw a split swatch (light | dark). */
  accent: string | [string, string];
}

export const themes: ThemeMeta[] = [
  {
    id: "ember",
    name: "Ember",
    description: "Warm paper and ink, one coral accent",
    accent: ["#C8462A", "#FF7A5C"],
  },
  {
    id: "sorbet",
    name: "Sorbet",
    description: "Gummy pastels and a mango accent",
    accent: ["#F28A2E", "#FFA33E"],
  },
  {
    id: "lavender",
    name: "Lavender",
    description: "Lilac mist and plum dusk, a violet accent",
    accent: ["#7B57C8", "#CAACFF"],
  },
  {
    id: "e-ink",
    name: "E-Ink",
    description: "Flat greys and no motion, for e-paper screens",
    accent: "#1A1A1A",
  },
];

export const themeModes: { value: ThemeMode; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** "Ember, Auto": the folded Appearance row's current value. A one-variant family shows its name only. Native twin: themePreferenceLabel in apps/mobile/src/lib/theme-meta.ts. */
export function themePreferenceLabel(preference: ThemePreference): string {
  const family = preferenceFamily(preference);
  const name = themes.find((t) => t.id === family)?.name ?? family;
  if (!familyHasModes(family)) return name;
  const mode = themeModes.find((m) => m.value === preferenceMode(preference))?.label;
  return mode ? `${name}, ${mode}` : name;
}
