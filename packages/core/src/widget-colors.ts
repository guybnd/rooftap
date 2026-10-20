// HOUP-106: Android home-screen widgets (react-native-android-widget /
// RemoteViews) only accept `#rrggbb` hex or `rgba(...)` color strings — unlike
// packages/ui's NativeWind pipeline (resolve-color.ts's "R G B" CSS-var
// triplet) or a browser's native oklch support, there's no other color engine
// in that render path. THEME_TOKENS ships oklch (see theme-colors.ts), so the
// widget needs its own conversion to a literal hex string.
import { clampChroma, converter, parse } from 'culori';

const toRgb = converter('rgb');

function channelHex(value: number): string {
  return Math.round(Math.max(0, Math.min(1, value)) * 255)
    .toString(16)
    .padStart(2, '0');
}

/**
 * Resolve a Hearth oklch token (THEME_TOKENS) to a `#rrggbb` hex string for
 * RemoteViews. Return type is the same `` `#${string}` `` template-literal
 * shape react-native-android-widget's `HexColor`/`ColorProp` types expect, so
 * callers don't need to re-cast at every call site.
 */
export function oklchToHex(oklch: string): `#${string}` {
  const parsed = parse(oklch);
  if (!parsed) throw new Error(`oklchToHex: unresolvable color token "${oklch}"`);
  const rgb = toRgb(clampChroma(parsed, 'oklch'));
  if (!rgb) throw new Error(`oklchToHex: could not convert "${oklch}"`);
  return `#${channelHex(rgb.r)}${channelHex(rgb.g)}${channelHex(rgb.b)}` as `#${string}`;
}
