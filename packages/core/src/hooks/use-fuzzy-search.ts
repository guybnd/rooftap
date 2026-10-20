import { useMemo } from "react";
import Fuse, { type IFuseOptions } from "fuse.js";
import { useDebounce } from "./use-debounce";

// FLUX-110: shared fuzzy search across every main section. HOUP-121: promoted
// from apps/web/src/hooks/use-fuzzy-search.ts to packages/core so
// apps/mobile can share it too — no behavior change, web now re-exports
// this via a thin shim at its old import path.
//
// Filters `items` down to those that fuzzily match `query` over `keys`. The
// query is debounced (300ms) so typing doesn't rebuild on every keystroke, and
// the Fuse index is memoized on [items, keys] so it only rebuilds when the data
// or fields change. An empty query returns the original list UNCHANGED, so the
// caller's existing filters/sort/order are preserved untouched.

// HOUP-7: Fuse's index build calls string methods on each key's resolved
// value. A value of `undefined` (a missing field, not `''`) throws
// "Cannot read properties of undefined (reading 'toLowerCase')" out of the
// useMemo below, crashing the whole route. Wrap the default resolver so a
// missing value coerces to `''` instead — nested paths and array-valued keys
// still resolve normally via Fuse.config.getFn.
export function fuzzySearchGetFn<T>(
  obj: T,
  path: string | string[]
): ReadonlyArray<string> | string {
  const value = Fuse.config.getFn(obj as never, path);
  return value == null ? "" : value;
}

export function useFuzzySearch<T>(
  items: T[],
  query: string,
  keys: (keyof T | string)[],
  options?: IFuseOptions<T>
): T[] {
  const debounced = useDebounce(query, 300);

  // Stable key identity so the index isn't rebuilt when a caller passes an
  // inline array literal each render.
  const keyDeps = keys.join("|");

  const fuse = useMemo(
    () =>
      new Fuse(items, {
        keys: keys as string[],
        threshold: 0.4,
        ignoreLocation: true,
        ...options,
        // After the spread so no caller can accidentally clobber the guard.
        getFn: fuzzySearchGetFn,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, keyDeps, options]
  );

  return useMemo(() => {
    const q = debounced.trim();
    if (!q) return items;
    return fuse.search(q).map((r) => r.item);
  }, [fuse, debounced, items]);
}
