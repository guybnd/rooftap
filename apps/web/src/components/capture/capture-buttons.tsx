"use client";

// FLUX-104: the two entry points into the global capture sheet. Both live inside
// CaptureProvider and just trigger it; the sheet does the work.
// FLUX-174: the sheet is now a quick-add launcher (add cost / to-do / grocery,
// search, plus the original doc capture), so the triggers open even offline —
// offline-capable quick-adds still work; the launcher disables only the
// online-only tiles (Doc/Scan, Apartment) itself.

import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCapture } from "@/components/capture/capture-context";

/** Desktop: a prominent "+ Capture" button in the sidebar, above the switcher. */
export function DesktopCaptureButton() {
  const { openCapture } = useCapture();
  return (
    <div className="px-2.5 pt-2.5">
      <button
        onClick={openCapture}
        aria-label="Add"
        title="Add a cost, to-do, grocery, document and more"
        className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[13px] font-semibold text-primary-foreground hover:bg-primary/90 active:translate-y-px disabled:opacity-50 disabled:pointer-events-none transition-all"
      >
        <Plus className="h-4 w-4 shrink-0" />
        Capture
      </button>
    </div>
  );
}

/**
 * Mobile: a raised circular "+" that lives in its own dedicated column in the
 * middle of the bottom tab bar (see SectionTabBar). Positioned relative to that
 * column so it never overlaps a section tab or its badge. Lifted above the bar
 * (z-30) but kept below the drawer overlay (z-40) and drawer (z-50).
 */
export function MobileCaptureFab() {
  const { openCapture } = useCapture();
  return (
    <button
      onClick={openCapture}
      aria-label="Add"
      className={cn(
        "md:hidden absolute left-1/2 -translate-x-1/2 -top-5 z-30 [view-transition-name:capture-fab]",
        "flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground",
        "shadow-lg ring-4 ring-background active:scale-95 disabled:opacity-50 disabled:pointer-events-none transition"
      )}
    >
      <Plus className="h-6 w-6" />
    </button>
  );
}
