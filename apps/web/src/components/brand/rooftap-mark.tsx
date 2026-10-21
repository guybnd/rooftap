// The Rooftap mark in one colour, drawn in currentColor (core ROOFTAP_MARK).
// Native twin: apps/mobile/src/components/brand/rooftap-mark.tsx.
import { ROOFTAP_MARK } from "@homeup/core";

export function RooftapMark({ className }: { className?: string }) {
  return (
    <svg viewBox={ROOFTAP_MARK.viewBox} aria-hidden className={className}>
      <path d={ROOFTAP_MARK.roof} fill="none" stroke="currentColor" strokeWidth={ROOFTAP_MARK.roofStroke} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={ROOFTAP_MARK.dot.cx} cy={ROOFTAP_MARK.dot.cy} r={ROOFTAP_MARK.dot.r} fill="currentColor" />
    </svg>
  );
}
