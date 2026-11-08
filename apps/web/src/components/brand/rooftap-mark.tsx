// The Rooftap mark, drawn in currentColor (core ROOFTAP_MARK). `spectrum`
// paints the app icon's colours instead: the roof in every room hue and the
// coral tap dot (public/icon.svg).
// Native twin: apps/mobile/src/components/brand/rooftap-mark.tsx.
import { useId, type ComponentType, type CSSProperties } from "react";
import { HELPER_MARK, ROOFTAP_MARK, ROOFTAP_SPECTRUM, ROOFTAP_TILE, sectionHue } from "@homeup/core";
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

const TILE = { sm: "h-7 w-7 rounded-[9px] [&_svg]:h-5 [&_svg]:w-5", md: "h-9 w-9 rounded-[11px] [&_svg]:h-[26px] [&_svg]:w-[26px]", xl: "h-14 w-14 rounded-[17px] [&_svg]:h-10 [&_svg]:w-10" } as const;

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

/**
 * The first-run lede (Hearth §13.12): the app icon at full tile size over a
 * soft wash of the roof's spectrum, for the sign-in and first-user screens.
 * Still: no motion of its own. Native twin: RooftapHero in apps/mobile.
 */
export function RooftapHero({ className }: { className?: string }) {
  const [a, , , b, c] = SPECTRUM;
  return (
    <div aria-hidden className={cn("relative mx-auto flex h-[120px] w-[200px] items-center justify-center", className)}>
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(32% 48% at 30% 50%, ${a}52, transparent), radial-gradient(32% 48% at 50% 50%, ${b}52, transparent), radial-gradient(32% 48% at 70% 50%, ${c}52, transparent)`,
        }}
      />
      <RooftapTile size="xl" className="relative" />
    </div>
  );
}

/**
 * A module helper's avatar ("Under the roof", core HELPER_MARK): the
 * spectrum roof over the helper's module icon in its module's colour
 * (data-hue), with no tile. `working` makes the icon hop under the roof.
 * Native twin: HelperMark in apps/mobile.
 */
export function HelperMark({
  helper,
  Icon,
  working = false,
  className,
}: {
  helper: string;
  Icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  working?: boolean;
  className?: string;
}) {
  const id = `helper-roof-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const { x, y, size } = HELPER_MARK.icon;
  return (
    <span aria-hidden data-hue={sectionHue(helper)} className={cn("relative inline-block size-9 shrink-0", working && "helper-working", className)}>
      <svg viewBox={HELPER_MARK.viewBox} className="absolute inset-0 size-full">
        <defs>
          <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={HELPER_MARK.roofX[0]} y1="0" x2={HELPER_MARK.roofX[1]} y2="0">
            {SPECTRUM.map((c, i) => (
              <stop key={c} offset={i / (SPECTRUM.length - 1)} stopColor={c} />
            ))}
          </linearGradient>
        </defs>
        <path d={HELPER_MARK.roof} fill="none" stroke={`url(#${id})`} strokeWidth={HELPER_MARK.roofStroke} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="helper-mark-icon absolute" style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${size * 100}%`, height: `${size * 100}%`, color: "var(--hue-glyph)" }}>
        <Icon className="size-full" strokeWidth={2.4} />
      </span>
    </span>
  );
}
