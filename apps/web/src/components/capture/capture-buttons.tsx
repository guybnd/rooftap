"use client";

// FLUX-104: the two entry points into the global capture sheet. Both live inside
// CaptureProvider and just trigger it; the sheet does the work.
// FLUX-174: the sheet is now a quick-add launcher (add cost / to-do / grocery,
// search, plus the original doc capture), so the triggers open even offline —
// offline-capable quick-adds still work; the launcher disables only the
// online-only tiles (Doc/Scan, Apartment) itself.

// Hold the mobile "+" (assistant on): it fans out into Add and Ask, so the
// assistant is one hold away from every screen. A tap still opens the sheet.

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Plus, Sparkles } from "lucide-react";
import { sectionHue, useModules } from "@homeup/core";
import { cn } from "@/lib/utils";
import { commit } from "@/lib/haptics";
import { useDataCache } from "@/lib/data-cache";
import { useCapture } from "@/components/capture/capture-context";

// Same hold as the tab bar's slot picker (section-switcher.tsx).
const ASK_HOLD_MS = 450;
const HOLD_SLOP_PX = 10;

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
  const router = useRouter();
  const modules = useModules();
  const { isOnline } = useDataCache();
  const canAsk = modules.isEnabled("assistant") && isOnline;
  const [fanOpen, setFanOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const held = useRef(false);

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };
  useEffect(() => cancel, []);

  const openFan = () => {
    held.current = true;
    cancel();
    commit();
    setFanOpen(true);
  };

  const holdHandlers = canAsk
    ? {
        onPointerDown: (e: ReactPointerEvent) => {
          if (e.pointerType === "mouse" && e.button !== 0) return;
          held.current = false;
          cancel();
          start.current = { x: e.clientX, y: e.clientY };
          timer.current = setTimeout(openFan, ASK_HOLD_MS);
        },
        onPointerMove: (e: ReactPointerEvent) => {
          const s = start.current;
          if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > HOLD_SLOP_PX) cancel();
        },
        onPointerUp: cancel,
        onPointerCancel: cancel,
        onPointerLeave: cancel,
        onContextMenu: (e: ReactMouseEvent) => {
          e.preventDefault();
          openFan();
        },
      }
    : {};

  return (
    <>
      <button
        {...holdHandlers}
        onClick={() => {
          // The click that ends a hold belongs to the fan, not the sheet.
          if (held.current) {
            held.current = false;
            return;
          }
          openCapture();
        }}
        aria-label={canAsk ? "Add (hold to ask Rooftap)" : "Add"}
        className={cn(
          "md:hidden absolute left-1/2 -translate-x-1/2 -top-5 z-30 [view-transition-name:capture-fab] select-none [-webkit-touch-callout:none]",
          "flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground",
          "shadow-lg ring-4 ring-background active:scale-95 disabled:opacity-50 disabled:pointer-events-none transition"
        )}
      >
        <Plus className="h-6 w-6" />
      </button>
      {fanOpen && (
        <AskFan
          onClose={() => setFanOpen(false)}
          onAdd={() => {
            setFanOpen(false);
            openCapture();
          }}
          onAsk={() => {
            setFanOpen(false);
            router.push("/assistant/new?kind=quick");
          }}
        />
      )}
    </>
  );
}

/** The two choices a held "+" offers, over a dimmed screen. */
function AskFan({ onClose, onAdd, onAsk }: { onClose: () => void; onAdd: () => void; onAsk: () => void }) {
  const askRef = useRef<HTMLButtonElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    askRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const choice =
    "flex flex-col items-center gap-2 text-sm font-medium transition-[opacity,translate] duration-[var(--motion-base)] ease-[var(--motion-ease-out)]";
  return createPortal(
    <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-label="Add or ask">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className={cn(
          "absolute inset-0 bg-black/60 transition-opacity duration-[var(--motion-base)]",
          shown ? "opacity-100" : "opacity-0"
        )}
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+6.5rem)] flex justify-center gap-20">
        <button
          type="button"
          onClick={onAdd}
          className={cn(choice, "pointer-events-auto text-foreground", shown ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0")}
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-full border border-border bg-card">
            <Plus className="h-7 w-7" />
          </span>
          Add
        </button>
        <button
          ref={askRef}
          type="button"
          data-hue={sectionHue("assistant")}
          onClick={onAsk}
          className={cn(choice, "pointer-events-auto text-[var(--hue-glyph)]", shown ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0")}
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-[var(--hue-glow)] bg-[var(--hue-tile)]">
            <Sparkles className="h-7 w-7" />
          </span>
          Ask
        </button>
      </div>
    </div>,
    document.body
  );
}
