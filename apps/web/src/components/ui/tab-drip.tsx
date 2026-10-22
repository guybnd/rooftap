"use client";

// Hearth §13.7 "Desktop shell" (Guy, 2026-10-22): the top bar's hover name.
// One shape drips out of the hovered tab: a faint wash over the tab itself,
// a soft neck from its foot, and a pool below that holds the name, all one
// outline so the name reads as poured out of the tab. Corners stay squarish
// like the tab highlights. It shows at once and pours down fast, so a quick
// pass along the bar still reads every name; moving to the next tab slides
// it along instead of pouring again. Styles: globals.css `.tab-drip`.

import { useLayoutEffect, useRef, useState } from "react";

export interface TabDripState {
  label: string;
  /** The hovered tab's box, in the header's coordinates. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** The tab's section hue id (`data-hue`). */
  hue: string;
  on: boolean;
  /** Counts each fresh show, so the pour replays only when it starts from nothing. */
  seq: number;
  /** Already showing for a neighbour: slide across instead of jumping. */
  slide: boolean;
}

/** The neck's length from the tab's foot to the pool (px). */
const NECK = 10;
/** The pool's height and the corner radii (px). */
const POOL_H = 26;
const TAB_R = 14;
const POOL_R = 9;
/** Half the neck at its narrowest, and how far its flare reaches (px). */
const NECK_HALF = 8;
const FLARE = 16;

/**
 * The tab, neck and pool as one outline, centred on x = 0 with the tab's top
 * at y = 0. The neck flares into both shapes with curves, like a drop that
 * hasn't let go.
 */
export function tabDripPath(tabW: number, tabH: number, poolW: number): string {
  const tw = tabW / 2;
  const pw = Math.max(poolW / 2, NECK_HALF + FLARE + POOL_R);
  // Control points a third of the way along: a slow, liquid flare, not a stem.
  const c = FLARE * 0.45;
  const d = NECK * 0.3;
  const top = tabH + NECK;
  const bottom = top + POOL_H;
  const n = NECK_HALF;
  const mid = tabH + NECK / 2;
  return [
    `M ${-tw + TAB_R} 0`,
    `H ${tw - TAB_R}`,
    `Q ${tw} 0 ${tw} ${TAB_R}`,
    `V ${tabH - TAB_R}`,
    // The tab's foot melts straight into the neck, like a drop gathering.
    `C ${tw} ${tabH + 2} ${n + 3} ${tabH - 1} ${n} ${mid}`,
    `C ${n} ${top - d} ${n + c} ${top} ${n + FLARE} ${top}`,
    `H ${pw - POOL_R}`,
    `Q ${pw} ${top} ${pw} ${top + POOL_R}`,
    `V ${bottom - POOL_R}`,
    `Q ${pw} ${bottom} ${pw - POOL_R} ${bottom}`,
    `H ${-pw + POOL_R}`,
    `Q ${-pw} ${bottom} ${-pw} ${bottom - POOL_R}`,
    `V ${top + POOL_R}`,
    `Q ${-pw} ${top} ${-pw + POOL_R} ${top}`,
    `H ${-n - FLARE}`,
    `C ${-n - c} ${top} ${-n} ${top - d} ${-n} ${mid}`,
    `C ${-n - 3} ${tabH - 1} ${-tw} ${tabH + 2} ${-tw} ${tabH - TAB_R}`,
    `V ${TAB_R}`,
    `Q ${-tw} 0 ${-tw + TAB_R} 0`,
    "Z",
  ].join(" ");
}

export function TabDrip({ state }: { state: TabDripState }) {
  const { label, x, y, w, h, hue, on, seq, slide } = state;
  const nameRef = useRef<HTMLSpanElement>(null);
  const [poolW, setPoolW] = useState(0);
  useLayoutEffect(() => {
    if (nameRef.current) setPoolW(nameRef.current.offsetWidth);
  }, [label]);

  const half = Math.max(w, poolW) / 2 + 2;
  const height = h + NECK + POOL_H + 2;
  const id = `tab-drip-fill-${hue || "none"}`;
  return (
    <div
      aria-hidden
      data-hue={hue}
      data-on={on || undefined}
      className="tab-drip pointer-events-none absolute left-0 top-0 z-40"
      style={{ translate: `${x + w / 2}px ${y}px`, transitionProperty: slide ? "translate, opacity" : "opacity" }}
    >
      <div key={seq} className="tab-drip-pour">
        {w > 0 && poolW > 0 && (
          <svg
            className="tab-drip-shape"
            width={half * 2}
            height={height}
            viewBox={`${-half} -1 ${half * 2} ${height}`}
            style={{ left: -half, top: -1 }}
          >
            <defs>
              {/* A faint wash over the tab, full colour from the neck down. */}
              <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={h + NECK}>
                <stop offset="0" className="tab-drip-stop-tab" />
                <stop offset={(h - 6) / (h + NECK)} className="tab-drip-stop-tab" />
                <stop offset="1" className="tab-drip-stop-pool" />
              </linearGradient>
            </defs>
            <path d={tabDripPath(w, h, poolW)} fill={`url(#${id})`} />
          </svg>
        )}
      </div>
      <span ref={nameRef} key={`n${seq}`} className="tab-drip-name" style={{ top: h + NECK }}>
        {label}
      </span>
    </div>
  );
}
