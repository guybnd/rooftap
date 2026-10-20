"use client";

import { useEffect, useState } from "react";
import { useDataCache } from "@/lib/data-cache";
import { Loader2Icon } from "lucide-react";

// Only surfaces once a background revalidation (after an already-painted
// cache-first render) has been in flight for a beat — a fetch that resolves
// in under a second shouldn't flicker anything onto the screen.
const SHOW_DELAY_MS = 1000;

export function RevalidatingIndicator() {
  const { revalidating } = useDataCache();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!revalidating) {
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [revalidating]);

  if (!visible) return null;

  // HOUP-319: this used to be a block banner in the page flow, so mounting it
  // pushed the whole page down and unmounting pulled it back up on every
  // background refresh. It now floats over the top of the scroll region: the
  // outer wrapper is a zero-height sticky rail (no layout footprint), and the
  // chip is positioned inside it, so nothing below moves. Fade/slide at the
  // Hearth fast token (MO: transform/opacity only; reduced motion collapses
  // --motion-fast to 0ms).
  return (
    <div className="pointer-events-none sticky top-0 z-20 h-0" data-testid="revalidating-rail">
      <div
        role="status"
        className="absolute left-1/2 top-2 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-border/50 bg-muted/80 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur-md animate-in fade-in-0 slide-in-from-top-1 duration-[var(--motion-fast)] ease-[var(--motion-ease-out)]"
      >
        <Loader2Icon className="h-3.5 w-3.5 shrink-0 animate-spin" />
        <span>Refreshing…</span>
      </div>
    </div>
  );
}
