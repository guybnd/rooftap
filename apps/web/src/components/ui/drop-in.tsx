"use client";

// Hearth §8 "Drop in": a row just added from the item sheet arrives with a
// coral dot that falls into its leading slot, then the row pops in where it
// landed. Wrap the row and pass its id; it plays once per id (core
// takeDropIn), only while `when` holds, and never under still motion.
// Numbers come from core's touches.ts. Native twin:
// packages/ui/src/components/drop-in.tsx.

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { DROP_IN_DOT, DROP_IN_DOT_MS, DROP_IN_FALL, DROP_IN_KEYS, DROP_IN_LAND_X, DROP_IN_POP_MS, takeDropIn } from "@homeup/core";
import { prefersStillMotion } from "@/lib/still-motion";

export function DropIn({ id, when, children }: { id: string; when: boolean; children: ReactNode }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const row = rowRef.current;
    const dot = dotRef.current;
    if (!when || !row?.animate || !dot || prefersStillMotion() || !takeDropIn(id)) return;
    const fall = dot.animate(
      [
        { transform: `translateY(${-DROP_IN_FALL}px)`, opacity: 0 },
        { opacity: 1, offset: 0.15 },
        { transform: "translateY(0)", opacity: 1 },
      ],
      { duration: DROP_IN_DOT_MS, easing: "cubic-bezier(0.5, 0, 0.75, 0)" }
    );
    const pop = row.animate(
      DROP_IN_KEYS.at.map((offset, i) => ({ offset, transform: `scale(${DROP_IN_KEYS.scale[i]})`, opacity: DROP_IN_KEYS.opacity[i] })),
      { duration: DROP_IN_POP_MS, delay: DROP_IN_DOT_MS, fill: "backwards" }
    );
    return () => {
      fall.cancel();
      pop.cancel();
    };
  }, [id, when]);
  return (
    <div className="relative">
      <div ref={rowRef}>{children}</div>
      <span
        ref={dotRef}
        aria-hidden
        className="pointer-events-none absolute top-1/2 rounded-full bg-primary opacity-0"
        style={{ left: DROP_IN_LAND_X - DROP_IN_DOT / 2, width: DROP_IN_DOT, height: DROP_IN_DOT, marginTop: -DROP_IN_DOT / 2 }}
      />
    </div>
  );
}
