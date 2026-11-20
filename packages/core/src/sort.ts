// Null-safe string comparator for Array.sort. Store rows can transiently carry
// undefined string fields (partial hydration / tombstoned Legend-State rows,
// see HOUP-299/HOUP-300) — a raw `a.x.localeCompare(b.x)` inside a render-time
// sort crashes the whole page, so every comparator over data-derived strings
// must go through this guard. Missing values sort first, before any non-empty string.
export function compareStrings(a?: string | null, b?: string | null): number {
  return (a ?? '').localeCompare(b ?? '');
}

// Oldest-first comparator for row timestamps. A row saved on this device carries
// a null created_at until the server stamps it (create-group-store rule 5), so a
// sort on created_at must not call localeCompare on it. An unstamped row is the
// newest one, so it sorts after every stamped row. Flip the arguments for newest-first.
export function compareCreatedAt(a?: string | null, b?: string | null): number {
  if (!a || !b) return (a ? 0 : 1) - (b ? 0 : 1);
  return a.localeCompare(b);
}
