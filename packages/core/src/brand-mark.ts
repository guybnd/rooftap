// The Rooftap mark (the open roof chevron and its tap dot), as geometry both
// apps draw in one colour: the + button wears it in the button's own
// foreground. The full-colour app icon (the spectrum roof on its dark tile)
// stays an asset. Square viewBox, cropped to the mark from the 1024 icon.
export const ROOFTAP_MARK = {
  viewBox: '172 163 680 680',
  roof: 'M232 560 L512 300 L792 560',
  roofStroke: 104,
  dot: { cx: 512, cy: 690, r: 86 },
} as const;

/**
 * A module helper's mark ("Under the roof"): the spectrum roof over the
 * helper's own module icon, in its module's colour, with no tile. On a
 * 0 to 100 square; `icon` is where the module icon sits, as shares of it.
 */
export const HELPER_MARK = {
  viewBox: '0 0 100 100',
  roof: 'M14 50 L50 18 L86 50',
  roofStroke: 11,
  roofX: [14, 86],
  icon: { x: 0.3, y: 0.48, size: 0.4 },
} as const;

/** The app icon's roof colours, left to right (public/icon.svg): coral, sun, mint, sky, lilac, rose. */
export const ROOFTAP_SPECTRUM = ['#FF7A5C', '#FFC93D', '#5FE0B0', '#7CB8FF', '#9C8BFF', '#FF7AB8'] as const;

/** The app icon's dark tile, the ground the spectrum mark sits on. */
export const ROOFTAP_TILE = '#121016';

/**
 * The spectrum ring around the Assistant's chat (Hearth §13, "Living edge"):
 * one full turn of its colours takes this long. It eases from one pace to the
 * next, and reduced motion holds it still.
 */
export const ASSISTANT_EDGE_TURN_MS = { rest: 14_000, listening: 5_000, thinking: 1_400 } as const;
export type AssistantEdgePace = keyof typeof ASSISTANT_EDGE_TURN_MS;

/** The ring's width at each pace, in px: thicker while Rooftap works. */
export const ASSISTANT_EDGE_WIDTH = { rest: 1.5, listening: 2.5, thinking: 3.5 } as const;

/** While Rooftap works the ring's width wobbles by this much either way, once per period, so it reads as busy. */
export const ASSISTANT_EDGE_WOBBLE = { px: 1.25, periodMs: 700 } as const;

/** How long the edge takes to ease from one pace to the next. */
export const ASSISTANT_EDGE_EASE_MS = 600;

/**
 * `count` colours stepping evenly round the spectrum and back to its start,
 * for drawing the edge as a ring of wedges where no conic gradient exists.
 */
export function spectrumRing(count: number): string[] {
  const stops = ROOFTAP_SPECTRUM.map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
  return Array.from({ length: count }, (_, k) => {
    const t = (k / count) * stops.length;
    const a = stops[Math.floor(t) % stops.length];
    const b = stops[(Math.floor(t) + 1) % stops.length];
    const f = t - Math.floor(t);
    return `#${a.map((v, j) => Math.round(v + (b[j] - v) * f).toString(16).padStart(2, '0')).join('')}`;
  });
}
