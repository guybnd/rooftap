"use client";

// Hearth §8 "Hop": a small squash and hop when something is done in one tap
// (the bins going out). Wrap the thing; it hops each time `when` turns true,
// never on mount, and holds still under reduced motion. Keys from core's
// touches.ts. Native twin: packages/ui/src/components/hop.tsx.

import { useEffect, useRef, type ReactNode } from "react";
import { HOP_KEYS, HOP_MS } from "@homeup/core";
import { cn } from "@/lib/utils";
import { prefersStillMotion } from "@/lib/still-motion";

const FRAMES = HOP_KEYS.at.map((offset, i) => ({
  offset,
  transform: `translateY(${HOP_KEYS.y[i]}px) scale(${HOP_KEYS.scaleX[i]}, ${HOP_KEYS.scaleY[i]})`,
}));

export function Hop({ when, className, children }: { when: boolean; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const was = useRef(when);
  useEffect(() => {
    if (when && !was.current && !prefersStillMotion()) ref.current?.animate?.(FRAMES, { duration: HOP_MS, easing: "linear" });
    was.current = when;
  }, [when]);
  return (
    <span ref={ref} className={cn("inline-flex origin-bottom", className)}>
      {children}
    </span>
  );
}
