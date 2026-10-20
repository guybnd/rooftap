// HOUP-7: on a realtime DELETE, the Supabase sync plugin marks the row with
// Legend-State's internal `symbolDelete` sentinel (`old[symbolDelete] = true`
// in @legendapp/state/sync-plugins/supabase) before merging it into the
// observable tree. That symbol-keyed property then reaches the IndexedDB
// persist plugin's `set()` as part of a change's `valueAtPath`, and symbols
// aren't structured-clone-able, so `IDBObjectStore.put` throws
// `DataCloneError` — a *local cache* write failure only (there are no hard
// deletes; `softDeleteRow` just flips a `deleted` column, per
// create-group-store.ts). Strip symbol-keyed properties before they reach the
// real plugin so the write succeeds and the local cache stays in sync.
//
// Only allocates when a symbol is actually found (the common case has none),
// so this stays cheap on the hot per-write path across all 11 tables.
export function stripSymbolKeys<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    let changed = false;
    const next: unknown[] = [];
    for (const item of value) {
      // A symbol VALUE (e.g. a row marked `symbolDelete` itself) is just as
      // unclonable as a symbol key — drop it from the persisted shape.
      if (typeof item === 'symbol') { changed = true; continue; }
      const stripped = stripSymbolKeys(item);
      if (stripped !== item) changed = true;
      next.push(stripped);
    }
    return (changed ? next : value) as T;
  }

  let changed = Object.getOwnPropertySymbols(value).length > 0;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as object)) {
    const original = (value as Record<string, unknown>)[key];
    // Same for symbol values under string keys: Legend's realtime DELETE can
    // leave `row[id] = symbolDelete`, which the key-only sweep missed and
    // IndexedDB's structured clone rejected (DataCloneError in doSave).
    if (typeof original === 'symbol') { changed = true; continue; }
    const stripped = stripSymbolKeys(original);
    if (stripped !== original) changed = true;
    out[key] = stripped;
  }
  return (changed ? out : value) as T;
}
