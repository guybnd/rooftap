"use client";

// FLUX-104: the two entry points into the global capture sheet. Both live inside
// CaptureProvider and just trigger it; the sheet does the work.
// FLUX-174: the sheet is now a quick-add launcher (add cost / to-do / grocery,
// search, plus the original doc capture), so the triggers open even offline —
// offline-capable quick-adds still work; the launcher disables only the
// online-only tiles (Doc/Scan, Apartment) itself.

// The mobile "+" (assistant on) is also the way into the pop-up chat
// (components/assistant-chat-popup.tsx): swipe up from it, or hold it and the
// slide's zipper ramps up into the pop that opens the chat. A tap still opens
// the sheet. Native twin: apps/mobile/src/components/nav/capture-fab.tsx.

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useRouter } from "next/navigation";
import { ASK_HOLD_MS, askHoldZipperMs, openAssistantPopup, sectionHue, useAssistantUnread, useModules } from "@homeup/core";
import { cn } from "@/lib/utils";
import { commit, pop, tick, zipper } from "@/lib/haptics";
import { useDataCache } from "@/lib/data-cache";
import { useCapture } from "@/components/capture/capture-context";
import { RooftapMark } from "@/components/brand/rooftap-mark";

const HOLD_SLOP_PX = 10;
/** How far up a swipe must travel to open the chat. */
const SWIPE_OPEN_PX = 40;
/** The + follows a swipe at this fraction of the finger, up to this far. */
const SWIPE_FOLLOW = 0.6;
const SWIPE_MAX_LIFT = 36;

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
        <RooftapMark className="h-4 w-4 shrink-0" />
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
  const unread = useAssistantUnread();
  // 0..1: how charged the hold is, or how far the swipe has climbed.
  const [charge, setCharge] = useState(0);
  const [lift, setLift] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const start = useRef<{ x: number; y: number; at: number } | null>(null);
  const swiping = useRef(false);
  const armed = useRef(false);
  const handled = useRef(false);

  const stop = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  const reset = () => {
    stop();
    start.current = null;
    swiping.current = false;
    armed.current = false;
    setCharge(0);
    setLift(0);
  };
  useEffect(() => stop, []);

  const openChat = () => {
    handled.current = true;
    reset();
    if (!openAssistantPopup()) router.push("/assistant/new?kind=quick");
  };

  const gestureHandlers = canAsk
    ? {
        onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
          if (e.pointerType === "mouse" && e.button !== 0) return;
          reset();
          handled.current = false;
          start.current = { x: e.clientX, y: e.clientY, at: Date.now() };
          e.currentTarget.setPointerCapture?.(e.pointerId);
          setCharge(1);
          timers.current = askHoldZipperMs().map((ms, step) => setTimeout(() => zipper(step), ms));
          timers.current.push(
            setTimeout(() => {
              pop();
              openChat();
            }, ASK_HOLD_MS)
          );
        },
        onPointerMove: (e: ReactPointerEvent) => {
          const s = start.current;
          if (!s) return;
          const dy = e.clientY - s.y;
          if (!swiping.current && Math.hypot(e.clientX - s.x, dy) > HOLD_SLOP_PX) {
            // Moving ends the hold; moving up turns it into the swipe.
            stop();
            setCharge(0);
            if (dy < 0 && Math.abs(e.clientX - s.x) < Math.abs(dy)) swiping.current = true;
            else start.current = null;
          }
          if (swiping.current) {
            setLift(Math.max(-SWIPE_MAX_LIFT, Math.min(0, dy * SWIPE_FOLLOW)));
            const past = dy < -SWIPE_OPEN_PX;
            if (past !== armed.current) {
              armed.current = past;
              if (past) tick();
            }
          }
        },
        onPointerUp: () => {
          if (swiping.current) {
            if (armed.current) {
              commit();
              openChat();
              return;
            }
            handled.current = true;
          }
          reset();
        },
        onPointerCancel: reset,
        onContextMenu: (e: ReactMouseEvent) => e.preventDefault(),
      }
    : {};

  const glow = Math.max(charge, -lift / SWIPE_MAX_LIFT);
  return (
    <button
      {...gestureHandlers}
      onClick={() => {
        // The click that ends a hold or a swipe belongs to the chat, not the sheet.
        if (handled.current) {
          handled.current = false;
          return;
        }
        openCapture();
      }}
      aria-label={canAsk ? (unread > 0 ? "Add (hold or swipe up to chat with Rooftap, new answer waiting)" : "Add (hold or swipe up to chat with Rooftap)") : "Add"}
      data-hue={sectionHue("assistant")}
      style={{
        transform: `translateX(-50%) translateY(${lift}px) scale(${1 + 0.14 * charge - lift / 400})`,
        // The assistant's glow gathers round the + as the hold charges or the swipe climbs.
        ...(glow > 0 && {
          boxShadow: `0 0 0 4px var(--background), 0 0 0 ${4 + 10 * glow}px color-mix(in oklch, var(--hue-glow) ${Math.round(85 * glow)}%, transparent)`,
        }),
      }}
      className={cn(
        "md:hidden absolute left-1/2 -top-5 z-30 [view-transition-name:capture-fab] select-none touch-none [-webkit-touch-callout:none]",
        "flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground",
        "shadow-lg ring-4 ring-background disabled:opacity-50 disabled:pointer-events-none motion-safe:transition-[transform,box-shadow]",
        charge > 0 ? "duration-[560ms] ease-linear" : "duration-[var(--motion-fast)]"
      )}
    >
      <RooftapMark className="h-6 w-6" />
      {/* A reply you haven't opened yet: the assistant's glow, in a small dose. */}
      {canAsk && unread > 0 && (
        <span
          aria-hidden
          data-hue={sectionHue("assistant")}
          className="absolute right-0 top-0 size-3.5 rounded-full border-2 border-background bg-[var(--hue-glow)]"
        />
      )}
    </button>
  );
}
