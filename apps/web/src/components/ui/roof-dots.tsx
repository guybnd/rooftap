"use client";

// Hearth §8 "Roof dots": six dots fly out of a thing's centre into the
// Rooftap roof over it, hold, then drift up and fade. One shot. Place it as
// the last child of a positioned thing (it centres itself there); it draws
// nothing under still motion. Geometry and timing come from core's
// touches.ts. Native twin: packages/ui/src/components/roof-dots.tsx.

import { useEffect, useRef, useState } from "react";
import { ROOF_DOTS_DRIFT, ROOF_DOTS_FLY, ROOF_DOTS_MS, ROOFTAP_SPECTRUM, MOTION_EASE, roofDots } from "@homeup/core";
import { cn } from "@/lib/utils";
import { prefersStillMotion } from "@/lib/still-motion";

export function RoofDots({
  width,
  height,
  delay = 0,
  dotClassName,
}: {
  /** The thing's box, in px. */
  width: number;
  height: number;
  /** Wait this long before the dots leave, in ms. */
  delay?: number;
  /** One colour for every dot, as a class (`bg-primary-foreground` on a coral ground); the icon's spectrum otherwise. */
  dotClassName?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [still] = useState(prefersStillMotion);
  useEffect(() => {
    if (still) return;
    const dots = roofDots(width, height);
    const animations = Array.from(ref.current?.children ?? []).map((el, i) => {
      const { x, y } = dots[i];
      return (el as HTMLElement).animate?.(
        [
          { transform: "translate(0, 0) scale(0.6)", opacity: 0, easing: MOTION_EASE.out },
          { opacity: 1, offset: 0.05, easing: MOTION_EASE.out },
          { transform: `translate(${x}px, ${y}px) scale(1)`, opacity: 1, offset: ROOF_DOTS_FLY },
          { transform: `translate(${x}px, ${y - ROOF_DOTS_DRIFT}px) scale(0.5)`, opacity: 0 },
        ],
        { duration: ROOF_DOTS_MS, delay, fill: "both" }
      );
    });
    return () => animations.forEach((a) => a?.cancel());
  }, [still, width, height, delay]);
  if (still) return null;
  return (
    <span ref={ref} aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 size-0">
      {roofDots(width, height).map((d, i) => (
        <span
          key={i}
          className={cn("absolute rounded-full opacity-0", dotClassName)}
          style={{
            left: -d.size / 2,
            top: -d.size / 2,
            width: d.size,
            height: d.size,
            background: dotClassName ? undefined : ROOFTAP_SPECTRUM[i],
          }}
        />
      ))}
    </span>
  );
}
