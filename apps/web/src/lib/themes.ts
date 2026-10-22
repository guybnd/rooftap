// Hearth v2: the Ember pair is new and is what the default "Match device"
// preference resolves to; the Axis Mundi pair (HOUP-295) and E-Ink stay
// selectable.
// Preference parsing/resolution lives in @homeup/core (theme-preference.ts)
// so web and native agree on it; this file is only display metadata.
import type { ThemeId, ThemePreference } from "@homeup/core";

export type { ThemeId, ThemePreference };

export interface ThemeMeta {
  id: ThemePreference;
  name: string;
  description: string;
  /** Swatch fill(s); two values draw a split swatch (light | dark). */
  accent: string | [string, string];
}

export const themes: ThemeMeta[] = [
  {
    id: "system",
    name: "Match device",
    description: "Ember Day or Night, set by your device",
    accent: ["#F6F3EF", "#121016"],
  },
  {
    id: "ember-day",
    name: "Ember Day",
    description: "Warm paper, one coral accent",
    accent: "#C8462A",
  },
  {
    id: "ember-night",
    name: "Ember Night",
    description: "Warm ink with a coral glow",
    accent: "#FF7A5C",
  },
  {
    id: "axis-mundi-day",
    name: "Axis Day",
    description: "Sunlit limestone and deep gilt",
    accent: "#a87a1f",
  },
  {
    id: "axis-mundi-night",
    name: "Axis Night",
    description: "Cut basalt, gilt and working blue",
    accent: "#d9a441",
  },
  {
    id: "e-ink",
    name: "E-Ink",
    description: "Flat greys and no motion, for e-paper screens",
    accent: "#1A1A1A",
  },
];
