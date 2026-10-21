'use client';

// Ids that just arrived (a re-added suggestion), each held for `holdMs` so its
// row can play Hearth §8 "Pop out, pop in" (`.row-pop-in`). Web twin of
// @homeup/ui's useArrivals.
import { useCallback, useState } from 'react';

export function useArrivals(holdMs: number) {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());
  const mark = useCallback(
    (list: readonly string[]) => {
      if (list.length === 0) return;
      setIds((prev) => new Set([...prev, ...list]));
      setTimeout(() => {
        setIds((prev) => {
          const next = new Set(prev);
          for (const id of list) next.delete(id);
          return next;
        });
      }, holdMs);
    },
    [holdMs],
  );
  return { ids, mark };
}
