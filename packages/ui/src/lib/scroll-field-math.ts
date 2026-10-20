// HOUP-195: pure step math for scroll-field.tsx, split out so it's testable
// without pulling react-native into vitest (RN's entry file uses Flow syntax
// vitest/rolldown can't parse).

/** Wraps v into the cyclic [min, max] step ring (day/month/year/hour/minute all cycle, never clamp). */
export function wrapValue(v: number, min: number, max: number, step: number): number {
  const span = max - min + step;
  return min + (((v - min) % span) + span) % span;
}
