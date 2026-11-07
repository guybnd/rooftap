"use client";

// Hearth §8 "Spectrum sweep": a soft band of the roof colours passes down
// the screen once, when a whole list is done (the last grocery got). Each
// new `play` value sweeps once. It never takes a click and draws nothing
// under still motion. Numbers from core's touches.ts. Native twin:
// packages/ui/src/components/spectrum-sweep.tsx.

import { useEffect, useRef, useState } from "react";
import { ROOFTAP_SPECTRUM, SPECTRUM_SWEEP_ALPHA, SPECTRUM_SWEEP_BAND, SPECTRUM_SWEEP_MS } from "@homeup/core";
import { prefersStillMotion } from "@/lib/still-motion";

const alpha = (hex: string, a: number) => `${hex}${Math.round(a * 255).toString(16).padStart(2, "0")}`;
const BAND = `linear-gradient(180deg, transparent, ${ROOFTAP_SPECTRUM.map((c) => alpha(c, SPECTRUM_SWEEP_ALPHA)).join(", ")}, transparent)`;

/** Sweeps once each time `play` changes (0 never sweeps). */
export function SpectrumSweep({ play }: { play: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!play || prefersStillMotion()) return;
    setOn(true);
    const t = setTimeout(() => setOn(false), SPECTRUM_SWEEP_MS + 50);
    return () => clearTimeout(t);
  }, [play]);
  useEffect(() => {
    if (!on) return;
    const a = ref.current?.animate?.(
      [{ transform: "translateY(-100%)" }, { transform: `translateY(${100 / SPECTRUM_SWEEP_BAND}%)` }],
      { duration: SPECTRUM_SWEEP_MS, easing: "cubic-bezier(0.45, 0, 0.55, 1)", fill: "both" }
    );
    return () => a?.cancel();
  }, [on]);
  if (!on) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      <div ref={ref} style={{ height: `${SPECTRUM_SWEEP_BAND * 100}%`, background: BAND }} />
    </div>
  );
}
