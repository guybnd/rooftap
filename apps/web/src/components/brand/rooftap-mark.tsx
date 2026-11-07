// The Rooftap mark, drawn in currentColor (core ROOFTAP_MARK). `spectrum`
// paints the app icon's colours instead: the roof in every room hue and the
// coral tap dot (public/icon.svg).
// Native twin: apps/mobile/src/components/brand/rooftap-mark.tsx.
import { useId, type CSSProperties } from "react";
import { ROOFTAP_MARK, ROOFTAP_SPECTRUM, ROOFTAP_TILE } from "@homeup/core";
import { cn } from "@/lib/utils";

const SPECTRUM = ROOFTAP_SPECTRUM;

export function RooftapMark({ className, spectrum = false }: { className?: string; spectrum?: boolean }) {
  const id = `rooftap-spectrum-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg viewBox={ROOFTAP_MARK.viewBox} aria-hidden className={spectrum ? `rooftap-spectrum ${className ?? ""}` : className}>
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

/**
 * The mark as a section glyph, shaped like a lucide icon (className sets
 * its size and colour), so the top bar, sidebar and leading tiles draw it
 * wherever they draw a section's icon (section-icons.ts `rooftap`).
 */
export function RooftapGlyph({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox={ROOFTAP_MARK.viewBox} width={24} height={24} aria-hidden className={className} style={style}>
      <path d={ROOFTAP_MARK.roof} fill="none" stroke="currentColor" strokeWidth={ROOFTAP_MARK.roofStroke * 0.85} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={ROOFTAP_MARK.dot.cx} cy={ROOFTAP_MARK.dot.cy} r={ROOFTAP_MARK.dot.r} fill="currentColor" />
    </svg>
  );
}

const TILE = { sm: "h-7 w-7 rounded-[9px] [&_svg]:h-5 [&_svg]:w-5", md: "h-9 w-9 rounded-[11px] [&_svg]:h-[26px] [&_svg]:w-[26px]" } as const;

/**
 * Rooftap's avatar: the app icon in small, the spectrum roof and coral tap
 * dot on the icon's dark tile. `working` makes the dot hop over the roof
 * while Rooftap is thinking (.rooftap-working in globals.css; reduced motion
 * keeps it still). Native twin: RooftapTile in apps/mobile.
 */
export function RooftapTile({ size = "md", working = false, className }: { size?: keyof typeof TILE; working?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center", TILE[size], working && "rooftap-working", className)}
      style={{ backgroundColor: ROOFTAP_TILE }}
    >
      <RooftapMark spectrum />
    </span>
  );
}
