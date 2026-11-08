"use client";

// FLUX-104: the two entry points into the global capture sheet. Both live inside
// CaptureProvider and just trigger it; the sheet does the work.
// FLUX-174: the sheet is now a quick-add launcher (add cost / to-do / grocery,
// search, plus the original doc capture), so the triggers open even offline —
// offline-capable quick-adds still work; the launcher disables only the
// online-only tiles (Doc/Scan, Apartment) itself.

// The mobile "+" (assistant on) is also the way into the pop-up chat
// (components/assistant-chat-popup.tsx): swipe up from it, or hold it and the
// slide's zipper ramps up into the pop that opens the chat. With a module
// helper on, the hold grows a short list of chats instead (core holdChoices):
// the helper for this page first, then Ask Rooftap next to the +; slide up
// to one and let go. A tap still opens the sheet.
// Native twin: apps/mobile/src/components/nav/capture-fab.tsx.

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ASK_HOLD_MS, askHoldZipperMs, holdChoiceAt, holdChoices, openAssistantPopup, sectionHue, useAssistantUnread, useModules, type ChatChoice } from "@homeup/core";
import { cn } from "@/lib/utils";
import { commit, pop, tick, zipper } from "@/lib/haptics";
import { useDataCache } from "@/lib/data-cache";
import { useCapture } from "@/components/capture/capture-context";
import { RooftapMark, RooftapTile } from "@/components/brand/rooftap-mark";
import { LeadingTile } from "@/components/ui/leading-tile";
import { sectionIconFor } from "@/lib/section-icons";

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
  return <CaptureFab />;
}

/**
 * Desktop (Hearth §13 "Desktop shell"): the same roof + docked at the bottom
 * right of the screen, with the same tap, hold and swipe. Capture and the
 * pop-up chat open out of it, like a messenger window.
 */
export function DockCaptureFab() {
  return <CaptureFab dock />;
}

function CaptureFab({ dock = false }: { dock?: boolean }) {
  const { openCapture } = useCapture();
  const router = useRouter();
  const modules = useModules();
  const { isOnline } = useDataCache();
  const canAsk = modules.feature("capture.ask") && isOnline;
  const unread = useAssistantUnread();
  // 0..1: how charged the hold is, or how far the swipe has climbed.
  const [charge, setCharge] = useState(0);
  const [lift, setLift] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const start = useRef<{ x: number; y: number; at: number } | null>(null);
  const swiping = useRef(false);
  const armed = useRef(false);
  const handled = useRef(false);
  // The hold's list of chats while it is up, and the one under the finger.
  const pathname = usePathname();
  const choices = canAsk && modules.server("assistant.helpers") ? holdChoices(pathname, (id) => modules.isEnabled(id)) : [];
  const [fan, setFan] = useState(false);
  const fanOpen = useRef(false);
  const [pick, setPick] = useState(0);
  const pickRef = useRef(0);

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
    fanOpen.current = false;
    setFan(false);
  };
  useEffect(() => stop, []);

  const openChat = (choice?: ChatChoice) => {
    handled.current = true;
    reset();
    const request = choice?.helper ? { helper: choice.helper } : choice ? { plain: true } : {};
    if (!openAssistantPopup(request)) router.push("/assistant/new?kind=quick");
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
              // With helpers on, the hold grows the list; letting go picks.
              if (choices.length > 1) {
                fanOpen.current = true;
                handled.current = true;
                pickRef.current = choices.length - 1;
                setPick(choices.length - 1);
                setFan(true);
                setCharge(0);
              } else openChat();
            }, ASK_HOLD_MS)
          );
        },
        onPointerMove: (e: ReactPointerEvent) => {
          const s = start.current;
          if (!s) return;
          const dy = e.clientY - s.y;
          if (fanOpen.current) {
            const at = holdChoiceAt(dy, choices.length);
            if (at !== pickRef.current) {
              pickRef.current = at;
              setPick(at);
              tick();
            }
            return;
          }
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
          if (fanOpen.current) {
            commit();
            openChat(choices[pickRef.current]);
            return;
          }
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
        transform: `${dock ? "" : "translateX(-50%) "}translateY(${lift}px) scale(${1 + 0.14 * charge - lift / 400})`,
        // The assistant's glow gathers round the + as the hold charges or the swipe climbs.
        ...(glow > 0 && {
          boxShadow: `0 0 0 4px var(--background), 0 0 0 ${4 + 10 * glow}px color-mix(in oklch, var(--hue-glow) ${Math.round(85 * glow)}%, transparent)`,
        }),
      }}
      className={cn(
        dock
          ? "desk-top fixed bottom-6 right-6 z-40 hidden h-14 w-14 md:flex [view-transition-name:capture-dock-fab]"
          : "md:hidden absolute left-1/2 -top-5 z-30 flex h-12 w-12 [view-transition-name:capture-fab]",
        "select-none touch-none [-webkit-touch-callout:none] items-center justify-center rounded-full bg-primary text-primary-foreground",
        "shadow-lg ring-4 ring-background disabled:opacity-50 disabled:pointer-events-none motion-safe:transition-[transform,box-shadow]",
        charge > 0 ? "duration-[560ms] ease-linear" : "duration-[var(--motion-fast)]"
      )}
    >
      <RooftapMark className={dock ? "h-7 w-7" : "h-6 w-6"} />
      {fan && <HoldChoices choices={choices} pick={pick} dock={dock} />}
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

/**
 * The hold's list of chats, rising above the +: one row per chat, the one
 * under the finger filled. Ask Rooftap sits next to the +.
 */
function HoldChoices({ choices, pick, dock }: { choices: ChatChoice[]; pick: number; dock: boolean }) {
  return (
    <span
      role="listbox"
      aria-label="Open a chat"
      className={cn(
        "pointer-events-none absolute bottom-[calc(100%+12px)] flex w-56 flex-col gap-1 rounded-2xl bg-popover p-1.5 text-left shadow-[var(--card-shadow)] ring-1 ring-border",
        dock ? "right-0" : "left-1/2 -translate-x-1/2"
      )}
    >
      {choices.map((c, i) => (
        <span
          key={c.helper ?? "rooftap"}
          role="option"
          aria-selected={i === pick}
          className={cn(
            "flex h-11 items-center gap-2.5 rounded-xl px-2.5 text-sm font-medium",
            i === pick ? "bg-muted text-foreground" : "text-muted-foreground"
          )}
        >
          {c.helper ? (
            <LeadingTile sectionId={c.helper} Icon={sectionIconFor(c.helper)} size="sm" />
          ) : (
            <RooftapTile size="sm" />
          )}
          {c.label}
        </span>
      ))}
    </span>
  );
}
