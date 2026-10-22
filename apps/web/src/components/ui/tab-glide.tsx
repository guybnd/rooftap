"use client";

// Hearth §8 "Tab glide" (web): the tab bar's one travelling highlight. The
// bar measures its tabs and hands this the active face's centre; this draws
// the pebble (core tab-glide.ts) behind the tabs and glides it to the new
// tab whenever that centre moves. During a tab switch the glide reads the
// page's own Shift animation clock (navShiftElapsedMs) on the page's curve
// (`--motion-slow`, swift-out), so the pebble and the page move as one; any
// other move runs the same timing on its own clock. It's stepped here in
// requestAnimationFrame and written straight to the path, so a glide never
// re-renders the bar. The fill is the active section's tile hue
// (`data-hue`) and eases between hues with CSS on the same timing.
// Native twin: packages/ui/src/components/tab-glide.tsx.

import { useEffect, useRef } from "react";
import { MOTION_DURATIONS_MS, TAB_GLIDE_SIZE, motionEaseOut, tabBlobPath, tabGlideEdges } from "@homeup/core";
import { navShiftElapsedMs } from "@/lib/view-transitions";
import { prefersStillMotion } from "@/lib/still-motion";

const GLIDE_MS = MOTION_DURATIONS_MS.slow;

export interface TabGlideTarget {
  /** Centre of the active tab's face, in the bar's own coordinates. */
  cx: number;
  cy: number;
}

interface Glide {
  /** The trip in flight: from one tab centre to the next. */
  from: number;
  to: number;
  /** Where the pebble's centre is now. */
  cx: number;
  cy: number;
  dir: number;
  /** When this trip's own clock started (null while the page's drives it), and how far in it has got (ms). */
  start: number | null;
  elapsed: number;
  frame: number | null;
  placed: boolean;
}

function prefersReducedMotion(): boolean {
  return prefersStillMotion();
}

export function TabGlide({ target, hue }: { target: TabGlideTarget | null; hue: string | undefined }) {
  const pathRef = useRef<SVGPathElement>(null);
  const glide = useRef<Glide>({
    from: 0,
    to: 0,
    cx: 0,
    cy: 0,
    dir: 0,
    start: null,
    elapsed: 0,
    frame: null,
    placed: false,
  });

  const cx = target?.cx;
  const cy = target?.cy;

  useEffect(() => {
    const path = pathRef.current;
    if (!path) return;
    const g = glide.current;
    const draw = (progress: number) => {
      const { left, right } = tabGlideEdges(g.from, g.to, progress, TAB_GLIDE_SIZE.width);
      g.cx = (left + right) / 2;
      path.setAttribute(
        "d",
        tabBlobPath(left, right, g.cy, TAB_GLIDE_SIZE.width, TAB_GLIDE_SIZE.height, g.dir)
      );
    };
    const stop = () => {
      if (g.frame != null) cancelAnimationFrame(g.frame);
      g.frame = null;
    };

    if (cx == null || cy == null) {
      stop();
      g.placed = false;
      path.style.opacity = "0";
      return;
    }

    g.cy = cy;
    if (!g.placed || prefersReducedMotion()) {
      // First placement (or reduced motion): land in place, no travel.
      stop();
      Object.assign(g, { from: cx, to: cx, dir: 0, placed: true });
      draw(1);
      path.style.opacity = "1";
      return;
    }
    if (cx === g.to) {
      if (g.frame == null) draw(1);
      return;
    }

    // Set off from wherever the pebble is now (mid-glide if a tab was
    // tapped before the last one landed).
    stop();
    Object.assign(g, { from: g.cx, to: cx, dir: cx > g.cx ? 1 : -1, start: null, elapsed: 0 });
    const tick = (now: number) => {
      // While a Shift is in flight the page's clock drives the glide (held
      // at the start until the page starts moving); otherwise this trip
      // keeps its own. Never backwards, so a handover can't jitter.
      const shift = navShiftElapsedMs();
      if (shift != null) {
        g.elapsed = Math.max(g.elapsed, shift);
        g.start = null;
      } else {
        g.start ??= now - g.elapsed;
        g.elapsed = Math.max(g.elapsed, now - g.start);
      }
      const t = g.elapsed / GLIDE_MS;
      if (t >= 1) {
        g.dir = 0;
        draw(1);
        g.frame = null;
        return;
      }
      draw(motionEaseOut(t));
      g.frame = requestAnimationFrame(tick);
    };
    g.frame = requestAnimationFrame(tick);
  }, [cx, cy]);

  useEffect(() => {
    const g = glide.current;
    return () => {
      if (g.frame != null) cancelAnimationFrame(g.frame);
    };
  }, []);

  return (
    <svg
      aria-hidden
      data-hue={hue}
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
    >
      <path
        ref={pathRef}
        style={{ opacity: 0 }}
        className="fill-[var(--hue-tile)] transition-[fill] duration-[var(--motion-slow)] ease-[var(--motion-ease-out)]"
      />
    </svg>
  );
}
