'use client';

// FLUX-198: the ONE long-press implementation, shared by every hold-to-edit
// surface (Today hero, groceries, recipe ingredients, and the ListItem line-item
// cards). Previously duplicated (a rich version in home/hub-shared.tsx, a
// stripped-down 400ms version in groceries/grocery-item-card.tsx) — promoted here
// as a neutral shared home so no surface re-implements the timer/cancel logic.
//
// Fires after LONG_PRESS_MS of a held pointer with no meaningful movement.
// Movement cancels it (so it becomes a swipe — SwipeActions takes over): a fixed
// 8px on both axes by default, or, when `moveCancelRatio` is set, that fraction of
// the pressed element's width on EITHER axis (the Today hero uses 10% so a
// deliberate hold tolerates jitter while a real drag/scroll still cancels — FLUX-180).
// consumeClick() returns true once if the long-press just fired, so the caller can
// suppress the trailing click (which would otherwise toggle/act on a tap).
//
// The move/up listeners live on `window`, NOT on the element: SwipeActions calls
// setPointerCapture() on pointerdown, which redirects subsequent pointer events to
// its own node — a child's onPointerMove/onPointerUp would then never fire, so the
// timer could never cancel. Captured events still bubble up to window, so window
// listeners see them; the element only needs onPointerDown to arm the gesture.
//
// FLUX-180 opt-in extras (default off, so callers that don't ask for it are unchanged):
//   - `trackProgress` drives a 0→1 `progress` value via requestAnimationFrame so
//     the caller can render a "loading into edit" fill (see <HoldFillOverlay>).
//     Off = no re-renders.
//   - `fillDelayMs` holds `progress` at 0 for a grace window after pointerdown, so
//     starting a swipe/scroll never flashes the fill; `progress` then ramps over the
//     remaining time to the long-press. The edit still fires at LONG_PRESS_MS.

import { useCallback, useEffect, useRef, useState } from 'react';
import { commit } from '@/lib/haptics';

/** Standard hold duration (ms) before a long-press fires. FLUX-198: the one value every surface now shares. */
export const LONG_PRESS_MS = 500;

/** Grace delay (ms) before a `trackProgress` fill starts counting, opt-in per caller. */
export const HOLD_FILL_DELAY_MS = 100;

interface LongPressOptions {
  /** Emit hold progress (0→1) via rAF for a fill affordance. Off = no re-renders. */
  trackProgress?: boolean;
  /** Grace delay (ms) before `progress` starts counting up from 0. */
  fillDelayMs?: number;
  /** Cancel when travel on EITHER axis exceeds this fraction of the element width. Overrides the fixed 8px. */
  moveCancelRatio?: number;
}

export function useLongPress(onLongPress: () => void, enabled = true, options: LongPressOptions = {}) {
  const { trackProgress = false, fillDelayMs = 0, moveCancelRatio } = options;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const moveRef = useRef<((e: PointerEvent) => void) | null>(null);
  const endRef = useRef<(() => void) | null>(null);
  const raf = useRef<number | null>(null);
  const startTime = useRef(0);
  const [progress, setProgress] = useState(0);

  const teardown = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (raf.current !== null) {
      cancelAnimationFrame(raf.current);
      raf.current = null;
    }
    if (moveRef.current) window.removeEventListener('pointermove', moveRef.current);
    if (endRef.current) {
      window.removeEventListener('pointerup', endRef.current);
      window.removeEventListener('pointercancel', endRef.current);
    }
    moveRef.current = null;
    endRef.current = null;
    start.current = null;
    setProgress((p) => (p === 0 ? p : 0));
  }, []);

  useEffect(() => teardown, [teardown]);

  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if (!enabled) return;
      fired.current = false;
      teardown();
      start.current = { x: e.clientX, y: e.clientY };
      // Relative cancel threshold (opt-in) is a fraction of the pressed row's width,
      // measured now; falls back to the fixed 8px for callers that don't set it.
      const width = (e.currentTarget as HTMLElement).getBoundingClientRect().width;
      const cancelPx = moveCancelRatio && width > 0 ? moveCancelRatio * width : 8;
      const move = (ev: PointerEvent) => {
        if (!start.current) return;
        if (Math.abs(ev.clientX - start.current.x) > cancelPx || Math.abs(ev.clientY - start.current.y) > cancelPx) {
          teardown(); // became a swipe/scroll — hand off to SwipeActions
        }
      };
      const end = () => teardown();
      moveRef.current = move;
      endRef.current = end;
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
      if (trackProgress) {
        startTime.current = performance.now();
        setProgress(0);
        const denom = LONG_PRESS_MS - fillDelayMs;
        const tick = () => {
          if (!start.current) return;
          const elapsed = performance.now() - startTime.current;
          const p = denom > 0 ? Math.min(1, Math.max(0, (elapsed - fillDelayMs) / denom)) : 0;
          setProgress(p);
          if (p < 1) raf.current = requestAnimationFrame(tick);
        };
        raf.current = requestAnimationFrame(tick);
      }
      timer.current = setTimeout(() => {
        fired.current = true;
        teardown(); // remove listeners; `fired` stays set for consumeClick()
        // Hearth §9 — the gesture just committed (Phase 2 scope decision: this
        // fan out to every consumer of the shared hook is intended).
        commit();
        onLongPress();
      }, LONG_PRESS_MS);
    },
  };

  const consumeClick = () => {
    if (fired.current) {
      fired.current = false;
      return true;
    }
    return false;
  };

  return { handlers, consumeClick, progress };
}
