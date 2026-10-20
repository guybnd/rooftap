// Null-safe string comparator for Array.sort. Store rows can transiently carry
// undefined string fields (partial hydration / tombstoned Legend-State rows,
// see HOUP-299/HOUP-300) — a raw `a.x.localeCompare(b.x)` inside a render-time
// sort crashes the whole page, so every comparator over data-derived strings
// must go through this guard. Missing values sort first, before any non-empty string.
export function compareStrings(a?: string | null, b?: string | null): number {
  return (a ?? '').localeCompare(b ?? '');
}
