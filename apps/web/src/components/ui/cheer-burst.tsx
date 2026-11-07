"use client";

// Hearth §8 "Cheer burst": the coral burst from slide-to-finish around a
// thing that earned it. A ring swells off its edge and fades while sparks,
// coral and roof colours in turn, fly out and shrink, and the thing swells
// to 1.08 and back. `Cheer` wraps the thing and plays each time `play` goes
// up (0 plays nothing); `CheerGlow` lays one soft mint glow over a meter.
// Nothing moves under still motion. Numbers come from core's touches.ts.
// Native twin: packages/ui/src/components/cheer-burst.tsx.

import { useEffect, useRef, type ReactNode } from "react";
import { CHEER_BURST_MS, CHEER_GLOW_ALPHA, CHEER_SWELL, MOTION_EASE, ROOFTAP_SPECTRUM, cheerSparks } from "@homeup/core";
import { cn } from "@/lib/utils";
import { prefersStillMotion } from "@/lib/still-motion";

/** Wraps a thing (a Hero number) so it swells and bursts when `play` goes up. */
export function Cheer({ play, children, className }: { play: number; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const burstRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const box = ref.current;
    const burst = burstRef.current;
    if (!play || !box?.animate || !burst || prefersStillMotion()) return;
    const width = box.offsetWidth;
    const height = box.offsetHeight;
    const timing = { duration: CHEER_BURST_MS, easing: MOTION_EASE.out };
    const ring = document.createElement("span");
    ring.className = "absolute rounded-[14px] border-2 border-primary opacity-0";
    Object.assign(ring.style, { left: "-6px", top: "-4px", width: `${width + 12}px`, height: `${height + 8}px` });
    burst.replaceChildren(ring);
    const animations = [
      box.animate([{ transform: "scale(1)" }, { transform: `scale(${CHEER_SWELL})`, offset: 0.4 }, { transform: "scale(1)" }], { duration: CHEER_BURST_MS }),
      ring.animate([{ opacity: 0, transform: "scale(1)" }, { opacity: 0.7, offset: 0.12 }, { opacity: 0, transform: "scale(1.3)" }], timing),
    ];
    for (const s of cheerSparks(width, height)) {
      const dot = document.createElement("span");
      dot.className = cn("absolute rounded-full opacity-0", s.coral && "bg-primary");
      Object.assign(dot.style, {
        left: `${width / 2 - s.size / 2}px`,
        top: `${height / 2 - s.size / 2}px`,
        width: `${s.size}px`,
        height: `${s.size}px`,
        background: s.coral ? "" : ROOFTAP_SPECTRUM[s.hue],
      });
      burst.appendChild(dot);
      animations.push(
        dot.animate([{ transform: "translate(0, 0) scale(1)" }, { transform: `translate(${s.x}px, ${s.y}px) scale(0.4)` }], { ...timing, fill: "both" }),
        dot.animate([{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.55 }, { opacity: 0 }], { duration: CHEER_BURST_MS, fill: "both" })
      );
    }
    return () => {
      animations.forEach((a) => a.cancel());
      burst.replaceChildren();
    };
  }, [play]);
  return (
    <span className={cn("relative inline-block", className)}>
      <span ref={ref} className="inline-block">
        {children}
      </span>
      <span ref={burstRef} aria-hidden className="pointer-events-none absolute inset-0" />
    </span>
  );
}

/** One soft mint glow over a meter when `play` goes up. Fills its positioned parent; give it the meter's rounding. */
export function CheerGlow({ play, className }: { play: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!play || !el?.animate || prefersStillMotion()) return;
    const a = el.animate([{ opacity: 0 }, { opacity: CHEER_GLOW_ALPHA, offset: 0.4 }, { opacity: 0 }], { duration: CHEER_BURST_MS * 2, easing: "ease-in-out" });
    return () => a.cancel();
  }, [play]);
  return <span ref={ref} aria-hidden className={cn("pointer-events-none absolute inset-0 bg-success opacity-0", className)} />;
}
