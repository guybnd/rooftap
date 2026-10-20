'use client';

// Hearth v2 (Pulse): slide-to-finish — web twin of packages/ui's
// SlideToComplete, the Now card's M3 gesture. Drag the coral thumb to the
// end of the track to finish; let go short and it slides back. tick() marks
// the threshold and success() lands the finish (HA). The thumb is a real
// button, so a keyboard or screen-reader user finishes with Enter or Space.
//
// Finishing celebrates once: as the thumb lands its check pops and a small
// coral burst (a ring and a few sparks) leaves it, over slow. One shot,
// transform and opacity only (MO), and none of it under reduced motion,
// where the check simply shows. The haptic is the same success() either way.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowRight, Check } from "lucide-react";
import { MOTION_DURATIONS_MS, MOTION_EASE } from "@homeup/core";
import { cn } from "@/lib/utils";
import { success, tick } from "@/lib/haptics";

const THUMB = 48;
const INSET = 4;
const TRACK = 56;
/** Fraction of the travel past which a release finishes the item. */
const FINISH_AT = 0.82;
/** Sparks around the landed thumb: angle (deg) and size (px), alternating so the burst doesn't read as a stamp. */
const SPARKS = [0, 45, 90, 135, 180, 225, 270, 315].map((deg, i) => ({ deg: deg + 22.5, size: i % 2 ? 5 : 7 }));
const SPARK_FROM = THUMB / 2 - 2;
const SPARK_TO = THUMB / 2 + 26;

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function SlideToComplete({
  onComplete,
  label = "Slide to finish",
  disabled,
  className,
}: {
  onComplete: () => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLButtonElement>(null);
  const burstRef = useRef<HTMLSpanElement>(null);
  const drag = useRef<{ startX: number; pointerId: number; armed: boolean } | null>(null);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [finished, setFinished] = useState(false);
  const [burstAt, setBurstAt] = useState<number | null>(null);

  // The thumb lands over base (its own transition), then the check pops and
  // the burst leaves it.
  useEffect(() => {
    if (burstAt === null) return;
    const thumb = thumbRef.current;
    const burst = burstRef.current;
    if (!thumb?.animate || !burst) return;
    const delay = MOTION_DURATIONS_MS.base;
    const animations = [
      thumb.animate([{ scale: "1" }, { scale: "1.16", offset: 0.4 }, { scale: "1" }], {
        duration: MOTION_DURATIONS_MS.fast + MOTION_DURATIONS_MS.base,
        delay,
        easing: MOTION_EASE.out,
      }),
    ];
    const ring = burst.querySelector<HTMLElement>("[data-burst-ring]");
    if (ring) {
      animations.push(
        ring.animate(
          [
            { opacity: 0, transform: "scale(1)" },
            { opacity: 0.7, transform: "scale(1.1)", offset: 0.15 },
            { opacity: 0, transform: "scale(1.7)" },
          ],
          { duration: MOTION_DURATIONS_MS.slow, delay, easing: MOTION_EASE.out, fill: "both" }
        )
      );
    }
    burst.querySelectorAll<HTMLElement>("[data-burst-spark]").forEach((spark) => {
      const rad = (Number(spark.dataset.burstSpark) * Math.PI) / 180;
      const at = (r: number, scale: number) => `translate(${Math.cos(rad) * r}px, ${Math.sin(rad) * r}px) scale(${scale})`;
      animations.push(
        spark.animate([{ transform: at(SPARK_FROM, 1) }, { transform: at(SPARK_TO, 0.4) }], {
          duration: MOTION_DURATIONS_MS.slow,
          delay,
          easing: MOTION_EASE.out,
          fill: "both",
        }),
        spark.animate([{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.55 }, { opacity: 0 }], {
          duration: MOTION_DURATIONS_MS.slow,
          delay,
          fill: "both",
        })
      );
    });
    return () => animations.forEach((a) => a.cancel());
  }, [burstAt]);

  const travel = () => Math.max(0, (trackRef.current?.clientWidth ?? 0) - THUMB - INSET * 2);

  const finish = () => {
    const max = travel();
    setFinished(true);
    setOffset(max);
    success();
    if (!prefersReducedMotion()) setBurstAt(INSET + max + THUMB / 2);
    onComplete();
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled || finished) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX - offset, pointerId: e.pointerId, armed: false };
    setDragging(true);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const max = travel();
    const next = Math.max(0, Math.min(max, e.clientX - d.startX));
    const armed = next >= max * FINISH_AT;
    if (armed && !d.armed) tick();
    d.armed = armed;
    setOffset(next);
  };

  const onPointerEnd = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (offset >= travel() * FINISH_AT) finish();
    else setOffset(0);
  };

  const max = travel();
  const labelOpacity = max > 0 ? Math.max(0, 1 - offset / (max * 0.5)) : 1;

  return (
    <div className={cn("relative", className)}>
      <div
        ref={trackRef}
        className={cn("relative flex h-14 select-none items-center overflow-hidden rounded-full bg-muted", disabled && "opacity-50")}
      >
        <span
          aria-hidden
          className={cn("absolute inset-y-0 left-0 rounded-full bg-primary/15", !dragging && "transition-[width] duration-[var(--motion-base)] ease-[var(--motion-ease-out)]")}
          style={{ width: offset + THUMB + INSET }}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center pl-10 text-sm font-semibold text-muted-foreground"
          style={{ opacity: finished ? 1 : labelOpacity }}
        >
          {finished ? "Done" : label}
        </span>
        <button
          ref={thumbRef}
          type="button"
          aria-label={`${label}, or press to finish`}
          disabled={disabled || finished}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              finish();
            }
          }}
          className={cn(
            "relative z-10 flex touch-none items-center justify-center rounded-full bg-primary text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-muted",
            !dragging && "transition-transform duration-[var(--motion-base)] ease-[var(--motion-ease-out)]"
          )}
          style={{ width: THUMB, height: THUMB, marginLeft: INSET, transform: `translateX(${offset}px)` }}
        >
          {finished ? <Check className="size-[22px]" strokeWidth={2.6} /> : <ArrowRight className="size-[22px]" strokeWidth={2.4} />}
        </button>
      </div>
      {/* Outside the track so its rounded clip doesn't cut the burst off;
          centred where the thumb lands. */}
      {burstAt !== null && (
        <span ref={burstRef} aria-hidden className="pointer-events-none absolute size-0" style={{ left: burstAt, top: TRACK / 2 }}>
          <span
            data-burst-ring
            className="absolute rounded-full border-2 border-primary opacity-0"
            style={{ left: -THUMB / 2, top: -THUMB / 2, width: THUMB, height: THUMB }}
          />
          {SPARKS.map((spark) => (
            <span
              key={spark.deg}
              data-burst-spark={spark.deg}
              className="absolute rounded-full bg-primary opacity-0"
              style={{ left: -spark.size / 2, top: -spark.size / 2, width: spark.size, height: spark.size }}
            />
          ))}
        </span>
      )}
    </div>
  );
}
