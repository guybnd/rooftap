// Hearth v2: the Ember pair is new and is what the default "Match device"
// preference resolves to; E-Ink and the Sorbet and Lavender pairs stay
// selectable. The Axis Mundi pair was retired.
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
    id: "e-ink",
    name: "E-Ink",
    description: "Flat greys and no motion, for e-paper screens",
    accent: "#1A1A1A",
  },
  {
    id: "sorbet-day",
    name: "Sorbet Day",
    description: "Gummy pastels and a mango accent",
    accent: "#F28A2E",
  },
  {
    id: "sorbet-night",
    name: "Sorbet Night",
    description: "Jelly brights on grape-black",
    accent: "#FFA33E",
  },
  {
    id: "lavender-day",
    name: "Lavender Day",
    description: "Lilac mist with a violet accent",
    accent: "#7B57C8",
  },
  {
    id: "lavender-night",
    name: "Lavender Night",
    description: "Plum dusk with an opal glow",
    accent: "#CAACFF",
  },
];
