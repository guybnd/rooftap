// Hearth §8 "Tab glide": the tab bar's active highlight is one soft pebble
// that travels from tab to tab instead of a pill that blinks across. It
// rides the page shift's own clock (Hearth `slow`, swift-out), so the bar
// and the page move as one: its centre covers the hop exactly as far as the
// page has slid, and it stretches into a droplet on the same progress,
// widest early in the trip and back to rest as the page lands.
//
// Pure math shared by both bars. Native evaluates it on the UI thread (hence
// the 'worklet' directives, inert strings everywhere else); web steps it in
// requestAnimationFrame. Same constants, same motion.

/**
 * How much the pebble stretches on the way: at its widest it is wider than
 * rest by this share of the hop, and a hop longer than `TAB_GLIDE_MAX_HOP`
 * rest widths stretches no further.
 */
export const TAB_GLIDE_STRETCH = 0.5;
export const TAB_GLIDE_MAX_HOP = 1.5;

/** The pebble's resting size around a tab face (glyph and label). */
export const TAB_GLIDE_SIZE = { width: 58, height: 44 } as const;

/** How far a page shifts on a lateral tab switch, as a share of its width. */
export const TAB_SHIFT_FRACTION = 0.28;

/**
 * Which way a tab switch travels along the bar: 1 toward the end, -1 back
 * toward the start, 0 when either end isn't in the bar (no slide, just the
 * crossfade).
 */
export function tabTravelDirection(order: readonly string[], fromId: string, toId: string): -1 | 0 | 1 {
  const from = order.indexOf(fromId);
  const to = order.indexOf(toId);
  if (from === -1 || to === -1 || from === to) return 0;
  return to > from ? 1 : -1;
}

// Worklet helpers come before every worklet that calls them: the worklets
// Babel plugin turns each worklet function into a `var` built when the module
// runs, capturing its helpers' values at that moment, so a helper declared
// further down is captured as undefined ("clamp is not a function").
function clamp(value: number, min: number, max: number): number {
  'worklet';
  return Math.min(max, Math.max(min, value));
}

function r(value: number): string {
  'worklet';
  return (Math.round(value * 10) / 10).toString();
}

/**
 * Where the pebble's two edges are `progress` (0 to 1, already eased) of the
 * way through a glide from one tab centre to another. The centre moves
 * linearly with progress, so it tracks anything else driven by the same
 * eased value; the width swells by `TAB_GLIDE_STRETCH` of the hop at the
 * midpoint and is back to rest at both ends. Each edge only ever moves
 * toward the new tab.
 */
export function tabGlideEdges(
  fromCx: number,
  toCx: number,
  progress: number,
  restWidth: number,
): { left: number; right: number } {
  'worklet';
  const p = clamp(progress, 0, 1);
  const hop = toCx - fromCx;
  const cx = fromCx + hop * p;
  const peak = TAB_GLIDE_STRETCH * Math.min(Math.abs(hop), restWidth * TAB_GLIDE_MAX_HOP);
  const half = restWidth / 2 + 2 * peak * p * (1 - p);
  return { left: cx - half, right: cx + half };
}

/**
 * The pebble's size and lean between its two edges: stretched wider than
 * rest it thins (roughly keeping its area) and leans toward the travel
 * direction `dir`; squeezed narrower than rest it bulges taller. `lean`
 * is 0 at rest, up to ±1 at double width. Native draws the pebble from these alone (a rounded view, scaled
 * and skewed); web draws the full outline with `tabBlobPath`.
 */
export function tabPebbleMetrics(
  left: number,
  right: number,
  restWidth: number,
  restHeight: number,
  dir: number,
): { cx: number; width: number; height: number; lean: number } {
  'worklet';
  const width = Math.max(right - left, 1);
  const ratio = width / restWidth;
  const height = restHeight * clamp(1 / Math.sqrt(ratio), 0.7, 1.08);
  const stretch = clamp(ratio - 1, 0, 1);
  const lean = stretch * (dir > 0 ? 1 : dir < 0 ? -1 : 0);
  return { cx: (left + right) / 2, width, height, lean };
}

/**
 * The pebble's outline between its two edges, centred on `cy`.
 *
 * At rest it's a gently lopsided rounded shape (top crest a little right of
 * centre, the bottom a little left, the sides at slightly different
 * heights), so it reads as hand-made rather than a stadium. Stretched wider
 * than rest it thins (roughly keeping its area), its crest drifts toward
 * the travel direction `dir`, the leading side swells and the trailing side
 * draws to a soft tail; squeezed narrower than rest it bulges taller. All
 * of that falls back to the rest shape as the glide lands, with no extra
 * state.
 */
export function tabBlobPath(
  left: number,
  right: number,
  cy: number,
  restWidth: number,
  restHeight: number,
  dir: number,
): string {
  'worklet';
  const { cx, width: w, height: h, lean } = tabPebbleMetrics(left, right, restWidth, restHeight, dir);

  const top = cy - h / 2;
  const bottom = cy + h / 2;
  const topX = cx + w * (0.05 + 0.14 * lean);
  const bottomX = cx + w * (-0.04 + 0.1 * lean);
  const leftY = cy - h * 0.04;
  const rightY = cy + h * 0.03;

  // Horizontal handles along the crest and the base: long enough to keep
  // them broad, short of a box.
  const a = 0.72;
  // Vertical handles at the sides: the leading side rounds out, the
  // trailing side tightens toward a tail.
  const base = 0.7;
  const swell = 0.22 * Math.abs(lean);
  const taper = 0.42 * Math.abs(lean);
  const bLeft = clamp(lean < 0 ? base + swell : base - taper, 0.2, 0.95);
  const bRight = clamp(lean > 0 ? base + swell : base - taper, 0.2, 0.95);

  return (
    `M${r(left)} ${r(leftY)}` +
    `C${r(left)} ${r(leftY - bLeft * (leftY - top))} ${r(topX - a * (topX - left))} ${r(top)} ${r(topX)} ${r(top)}` +
    `C${r(topX + a * (right - topX))} ${r(top)} ${r(right)} ${r(rightY - bRight * (rightY - top))} ${r(right)} ${r(rightY)}` +
    `C${r(right)} ${r(rightY + bRight * (bottom - rightY))} ${r(bottomX + a * (right - bottomX))} ${r(bottom)} ${r(bottomX)} ${r(bottom)}` +
    `C${r(bottomX - a * (bottomX - left))} ${r(bottom)} ${r(left)} ${r(leftY + bLeft * (bottom - leftY))} ${r(left)} ${r(leftY)}Z`
  );
}
