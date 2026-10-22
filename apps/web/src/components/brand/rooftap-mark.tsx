// The Rooftap mark, drawn in currentColor (core ROOFTAP_MARK). `spectrum`
// paints the app icon's colours instead: the roof in every room hue and the
// coral tap dot (public/icon.svg).
// Native twin: apps/mobile/src/components/brand/rooftap-mark.tsx.
import { useId } from "react";
import { ROOFTAP_MARK } from "@homeup/core";

const SPECTRUM = ["#FF7A5C", "#FFC93D", "#5FE0B0", "#7CB8FF", "#9C8BFF", "#FF7AB8"];

export function RooftapMark({ className, spectrum = false }: { className?: string; spectrum?: boolean }) {
  const id = `rooftap-spectrum-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg viewBox={ROOFTAP_MARK.viewBox} aria-hidden className={className}>
      {spectrum && (
        <defs>
          <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="232" y1="0" x2="792" y2="0">
            {SPECTRUM.map((c, i) => (
              <stop key={c} offset={i / (SPECTRUM.length - 1)} stopColor={c} />
            ))}
          </linearGradient>
        </defs>
      )}
      <path d={ROOFTAP_MARK.roof} fill="none" stroke={spectrum ? `url(#${id})` : "currentColor"} strokeWidth={ROOFTAP_MARK.roofStroke} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={ROOFTAP_MARK.dot.cx} cy={ROOFTAP_MARK.dot.cy} r={ROOFTAP_MARK.dot.r} fill={spectrum ? SPECTRUM[0] : "currentColor"} />
    </svg>
  );
}
