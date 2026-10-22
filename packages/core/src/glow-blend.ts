// Hearth §13.1 "Glow drift": the section glow turns from one section's hue
// to the next as the page shifts. Each section's glow is its own static
// layer (native draws SVG gradients on the CPU, so their colours can't
// animate frame by frame); a switch blends the layers by opacity alone.
//
// The layers are translucent (SECTION_GLOW_OPACITY), so plain opacity
// crossfades go wrong: holding the old layer while the new one fades in on
// top made the glow brighter mid-switch and then drop (Guy 2026-10-22),
// and fading both washed it out. Instead every layer has a weight, the
// weights always sum to 1, and each layer's opacity is solved from its
// weight and how much the layers above it let through. What shows is then
// exactly the weighted mix of the glows, at the same strength from start to
// end, through any number of quick switches.
//
// Native runs `glowLayerAlpha` per layer per frame on the UI thread (hence
// the 'worklet' directives, inert strings elsewhere).

export interface GlowBlendState {
  /** Bottom to top. null is "no glow" (a section without one): it holds weight but draws nothing. */
  readonly layers: readonly (string | null)[];
  /** Each layer's weight when this blend started. */
  readonly from: readonly number[];
  /** Each layer's weight when it ends: 1 for the top layer, 0 for the rest. */
  readonly to: readonly number[];
}

/** A glow showing one section (or none), at rest. */
export function glowBlendAt(section: string | null): GlowBlendState {
  return { layers: [section], from: [1], to: [1] };
}

/** Layer `i`'s weight at blend progress `p` (0 to 1, already eased). */
export function glowLayerWeight(from: readonly number[], to: readonly number[], i: number, p: number): number {
  'worklet';
  const a = from[i] ?? 0;
  const b = to[i] ?? 0;
  return a + (b - a) * p;
}

/**
 * Layer `i`'s opacity at progress `p`, solved top down: a layer shows its
 * weight through what the layers above leave, `alpha = w / T`, and lets
 * `1 - strength * alpha` of the rest through. `strength` is the glow's peak
 * opacity for the theme (SECTION_GLOW_OPACITY).
 */
export function glowLayerAlpha(state: GlowBlendState, i: number, p: number, strength: number): number {
  'worklet';
  let through = 1;
  for (let j = state.layers.length - 1; j >= i; j--) {
    const w = glowLayerWeight(state.from, state.to, j, p);
    let alpha = through > 1e-6 ? w / through : 0;
    if (alpha < 0) alpha = 0;
    if (alpha > 1) alpha = 1;
    if (j === i) return alpha;
    if (state.layers[j] !== null) through *= 1 - strength * alpha;
  }
  return 0;
}

/**
 * Starts a blend to `section` from wherever the current one is (`p`): the
 * layers keep the weights they show now, the section moves to the top (or
 * joins it) and everything heads for it.
 */
export function glowBlendTo(state: GlowBlendState, section: string | null, p: number): GlowBlendState {
  const now = state.layers.map((_, i) => glowLayerWeight(state.from, state.to, i, p));
  const keep = state.layers.map((l, i) => ({ l, w: now[i] })).filter(({ l }) => l !== section);
  const own = state.layers.indexOf(section);
  const layers = [...keep.map((k) => k.l), section];
  const from = [...keep.map((k) => k.w), own === -1 ? 0 : now[own]];
  const to = layers.map((_, i) => (i === layers.length - 1 ? 1 : 0));
  return { layers, from, to };
}

/** Once a blend has landed, drops the layers it faded away. */
export function glowBlendSettle(state: GlowBlendState): GlowBlendState {
  return glowBlendAt(state.layers[state.layers.length - 1] ?? null);
}
